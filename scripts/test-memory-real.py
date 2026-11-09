"""Optional local-model benchmark: isolated outputs, no downloads or user-history writes.

Run with the prepared Python environment and --input pointing to a CLI rows JSON.
The installed models/license are reused on this machine; no license is retained.
"""
import argparse
import ctypes
import importlib.util
import json
import os
from pathlib import Path
import resource
import shutil
import subprocess
import sys
import threading
import time

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--rows', type=int)
parser.add_argument('--seed', type=int, default=42)
parser.add_argument('--worker-source', help='Optional saved worker source for a controlled before/after comparison')
parser.add_argument('--max-footprint-gib', type=float, default=8, help='Stop this benchmark if sampled process memory exceeds this budget')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
folder = Path(args.output).resolve()
folder.mkdir(parents=True, exist_ok=False)
data = folder / 'data'
data.mkdir()
installed = Path.home() / 'Library/Application Support/Voice Studio'
request = json.loads(Path(args.input).read_text())
if args.rows:
    request['rows'] = request['rows'][:args.rows]
(folder / 'request.json').write_text(json.dumps(request, ensure_ascii=False, indent=2))
spec = importlib.util.spec_from_file_location('memory_benchmark_worker', root / 'backend/worker.py')
worker = importlib.util.module_from_spec(spec)
if args.worker_source:
    exec(compile(Path(args.worker_source).read_text(), str(root / 'backend/worker.py'), 'exec'), worker.__dict__)
else:
    spec.loader.exec_module(worker)
import mlx.core as mx
mx.random.seed(args.seed)
mx.reset_peak_memory()

# macOS physical footprint includes compressed/driver-accounted memory that RSS
# alone misses. The system-wide swap measurement is context, not process usage.
class Usage(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_uint8 * 16)] + [(name, ctypes.c_uint64) for name in (
        'user', 'system', 'wakeups', 'interrupts', 'pageins', 'wired', 'resident', 'footprint', 'start', 'exit')]
libproc = ctypes.CDLL('/usr/lib/libproc.dylib')
libproc.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
libproc.proc_pid_rusage.restype = ctypes.c_int
samples = []
stopped = threading.Event()
started = time.monotonic()

def sample():
    usage = Usage()
    if libproc.proc_pid_rusage(os.getpid(), 0, ctypes.byref(usage)) != 0:
        raise RuntimeError('Cannot read process memory footprint')
    return {'seconds': round(time.monotonic()-started, 3), 'footprintBytes': usage.footprint,
            'residentBytes': usage.resident, 'mlxActiveBytes': mx.get_active_memory(),
            'mlxCacheBytes': mx.get_cache_memory(), 'mlxPeakBytes': mx.get_peak_memory()}

def monitor():
    while not stopped.wait(.2):
        snapshot = sample()
        samples.append(snapshot)
        if snapshot['footprintBytes'] > args.max_footprint_gib * 1024**3:
            # Kill only this disposable benchmark, including a native GPU call
            # that might defer Python exceptions. No daily data is written here.
            report.update(error='Benchmark process memory budget exceeded', memoryGuard=snapshot, events=events)
            (folder / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
            (folder / 'memory-samples.json').write_text(json.dumps(samples, indent=2))
            (data / 'license.txt').unlink(missing_ok=True)
            print(json.dumps({'error': report['error'], **snapshot}), flush=True)
            os._exit(70)

events = []
def progress(kind, **values):
    if kind == 'progress' and values.get('stage') in ('generating', 'loading', 'clip'):
        snapshot = sample()
        event = {'stage': values['stage'], **snapshot}
        if 'item' in values:
            item = values['item']
            event.update(id=item['id'], characters=len(item['text']), elapsed=item['elapsed'], audioSeconds=item['duration'])
        events.append(event)
        print(json.dumps(event), flush=True)
worker.emit = progress
report = {'seed': args.seed, 'source': args.worker_source or str(root / 'backend/worker.py'),
          'characters': sum(len(row['text']) for row in request['rows']), 'plannedSegments': len(request['rows']),
          'systemSwapBefore': subprocess.check_output(['sysctl', 'vm.swapusage'], text=True).strip()}
thread = threading.Thread(target=monitor, daemon=True)
shutil.copyfile(installed / 'license.txt', data / 'license.txt')
try:
    studio = worker.Studio(data, installed)
    started = time.monotonic()
    thread.start()
    result = studio.generate(request)
    report['totalSeconds'] = time.monotonic()-started
    report['items'] = result['items']
    report['audioSeconds'] = sum(item['duration'] for item in result['items'])
    report['allInputPreserved'] = ''.join(item['text'] for item in result['items']) == ''.join(row['text'] for row in request['rows'])
    assert len(result['items']) == len(request['rows']) and report['allInputPreserved']
except BaseException as error:
    report['error'] = repr(error)
    raise
finally:
    stopped.set()
    if thread.is_alive():
        thread.join()
    samples.append(sample())
    report.update(peakFootprintBytes=max(s['footprintBytes'] for s in samples),
                  peakResidentBytes=max(s['residentBytes'] for s in samples),
                  peakMlxBytes=mx.get_peak_memory(), peakCacheBytes=max(s['mlxCacheBytes'] for s in samples),
                  finalMemory=samples[-1], events=events,
                  systemSwapAfter=subprocess.check_output(['sysctl', 'vm.swapusage'], text=True).strip())
    (folder / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    (folder / 'memory-samples.json').write_text(json.dumps(samples, indent=2))
    (data / 'license.txt').unlink(missing_ok=True)
print(json.dumps({k: v for k, v in report.items() if k not in ('items', 'events')}, ensure_ascii=False), flush=True)
