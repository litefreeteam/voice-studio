"""Monitor an unmodified Mac release desktop and its inference subprocesses.

Use an isolated, prepared --data directory containing a queued test job. The
desktop runs normally, including its idle timer and subsequent UI submissions.
Create OUTPUT/stop to finish monitoring. No debugger or Python override is used.
"""
import argparse
import ctypes
import json
import os
from pathlib import Path
import signal
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--app', required=True)
parser.add_argument('--data', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--timeout', type=int, default=2400)
parser.add_argument('--max-footprint-gib', type=float, default=8)
args = parser.parse_args()
app = Path(args.app).resolve()
data = Path(args.data).resolve()
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=False)


class Usage(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_uint8 * 16)] + [(name, ctypes.c_uint64) for name in (
        'user', 'system', 'wakeups', 'interrupts', 'pageins', 'wired', 'resident', 'footprint', 'start', 'exit')]


libproc = ctypes.CDLL('/usr/lib/libproc.dylib')
libproc.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
libproc.proc_pid_rusage.restype = ctypes.c_int
env = dict(os.environ, VOICE_STUDIO_DATA=str(data))
for name in ('NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'VOICE_STUDIO_PYTHON', 'PYTHONHOME', 'PYTHONPATH'):
    env.pop(name, None)
report = {'app': str(app), 'data': str(data), 'samplingSeconds': .2,
          'processDiscoverySeconds': 1, 'events': [], 'workers': {},
          'systemSwapBefore': subprocess.check_output(['sysctl', 'vm.swapusage'], text=True).strip()}
started = time.monotonic()
samples = []
last_history = set()
seen = set()
processes = {}


def event(kind, **details):
    value = {'seconds': round(time.monotonic() - started, 3), 'kind': kind, **details}
    report['events'].append(value)
    print(json.dumps(value, ensure_ascii=False), flush=True)


def save():
    report['elapsedSeconds'] = round(time.monotonic() - started, 3)
    report['peakWorkerFootprintBytes'] = max((w['peakFootprintBytes'] for w in report['workers'].values()), default=0)
    report['peakProcessTreeFootprintSumBytes'] = max((s['footprintSumBytes'] for s in samples), default=0)
    temporary = output / 'report.tmp'
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    temporary.replace(output / 'report.json')


with (output / 'desktop.log').open('w') as log, (output / 'samples.jsonl').open('w') as sample_log:
    desktop = subprocess.Popen([str(app / 'Contents/MacOS/声悦')], env=env, stdout=log, stderr=log)
    report['desktopPid'] = desktop.pid
    event('desktop-start', pid=desktop.pid)
    next_scan = 0
    try:
        while time.monotonic() - started < args.timeout:
            seconds = time.monotonic() - started
            if (output / 'stop').exists():
                event('monitor-stop')
                break
            if desktop.poll() is not None:
                raise RuntimeError(f'Desktop exited unexpectedly: {desktop.returncode}')
            if seconds >= next_scan:
                next_scan = seconds + 1
                table = {}
                for line in subprocess.check_output(['ps', '-axo', 'pid=,ppid=,args='], text=True).splitlines():
                    fields = line.strip().split(None, 2)
                    if len(fields) == 3:
                        table[int(fields[0])] = (int(fields[1]), fields[2])
                owned = {desktop.pid}
                while True:
                    expanded = owned | {pid for pid, (parent, _) in table.items() if parent in owned}
                    if expanded == owned:
                        break
                    owned = expanded
                processes = {pid: table[pid][1] for pid in owned if pid in table}
                workers = {pid for pid, command in processes.items() if '/backend/worker.py' in command}
                for pid in workers - seen:
                    report['workers'][str(pid)] = {'startedSeconds': round(seconds, 3), 'peakFootprintBytes': 0,
                                                 'command': processes[pid]}
                    event('worker-start', pid=pid)
                for pid in seen - workers:
                    report['workers'][str(pid)]['exitedSeconds'] = round(seconds, 3)
                    event('worker-exit', pid=pid)
                seen = workers
                try:
                    history = json.loads((data / 'history.json').read_text())
                except FileNotFoundError:
                    history = []
                for item in reversed(history):
                    if item['id'] not in last_history:
                        event('clip', id=item['id'], characters=len(item['text']),
                              duration=item['duration'], elapsed=item['elapsed'])
                        last_history.add(item['id'])
                report['completedClips'] = len(last_history)
                save()
            footprints = {}
            for pid in processes:
                usage = Usage()
                if libproc.proc_pid_rusage(pid, 0, ctypes.byref(usage)) == 0:
                    footprints[str(pid)] = usage.footprint
                    worker = report['workers'].get(str(pid))
                    if worker is not None:
                        worker['peakFootprintBytes'] = max(worker['peakFootprintBytes'], usage.footprint)
                        worker['lastFootprintBytes'] = usage.footprint
                        if usage.footprint > args.max_footprint_gib * 1024 ** 3:
                            raise RuntimeError(f'Worker {pid} exceeded {args.max_footprint_gib} GiB safety budget')
            sample = {'seconds': round(seconds, 3), 'footprints': footprints,
                      'footprintSumBytes': sum(footprints.values())}
            samples.append(sample)
            sample_log.write(json.dumps(sample) + '\n')
            sample_log.flush()
            time.sleep(.2)
        else:
            raise TimeoutError('Packaged verification timed out')
    except BaseException as error:
        report['error'] = repr(error)
        raise
    finally:
        # Only stop the disposable desktop and workers owned by this monitor.
        for pid in seen:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        desktop.terminate()
        try:
            desktop.wait(timeout=10)
        except subprocess.TimeoutExpired:
            desktop.kill()
            desktop.wait()
        report['systemSwapAfter'] = subprocess.check_output(['sysctl', 'vm.swapusage'], text=True).strip()
        save()
