"""Fixed-workload A/B throughput check with the installed Apple Silicon model.

Generate the same number of codec frames per lane, alternating old single-row
and bounded pair inference. No downloads, application history or audio files.
Run separately from other inference benchmarks to avoid competing for the GPU.
"""
import argparse
import gc
import importlib.util
import json
from pathlib import Path
import time

import mlx.core as mx
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True, help='The original rows JSON')
parser.add_argument('--output', required=True, help='A new report directory')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=False)


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


worker = load('throughput_worker', root / 'backend/worker.py')
batch = load('throughput_batch', root / 'backend/mlx_batch.py')
installed = Path.home() / 'Library/Application Support/Voice Studio'
worker.require_license(installed)
studio = worker.Studio(output / 'scratch', installed)
studio.load('standard')
model = studio.model
request = json.loads(Path(args.input).read_text())
text = request['rows'][0]['text'][:180]
speaker = request.get('speaker', 'Vivian')
language = request.get('language', 'Chinese')
# Plain neutral preset for the fixed-compute microbenchmark, not a timing of the
# complete user-facing export path. Precision and sampling defaults match both.
frames = 400  # Divisible by both the old 25-frame and new 8-frame chunks.
results = []
for name in ['single', 'pair', 'pair', 'single']:
    mx.synchronize()
    gc.collect()
    mx.clear_cache()
    mx.reset_peak_memory()
    mx.random.seed(42)
    lanes = 2 if name == 'pair' else 1
    counts = [0] * lanes
    expected = frames * model.speech_tokenizer.decode_upsample_rate
    started = time.perf_counter()
    stream = (batch.generate(model, [text] * 2, speaker, '', language) if lanes == 2 else
              model.generate_custom_voice(text=text, speaker=speaker, language=language,
                  instruct=None, max_tokens=4096, stream=True, streaming_interval=2.0, verbose=False))
    try:
        for chunk in stream:
            row = chunk.sequence_idx if lanes == 2 else 0
            pcm = np.array(chunk.audio, dtype=np.float32, copy=True)
            counts[row] += pcm.size
            del chunk, pcm
            if all(count >= expected for count in counts):
                break
        mx.synchronize()
        seconds = time.perf_counter() - started
        if counts != [expected] * lanes:
            raise RuntimeError(f'Not a fixed-workload comparison: {counts} != {[expected] * lanes}')
        result = {'case': name, 'lanes': lanes, 'framesPerLane': frames, 'seconds': seconds,
                  'audioSeconds': sum(counts) / model.sample_rate,
                  'audioPerSecond': sum(counts) / model.sample_rate / seconds,
                  'peakMlxBytes': mx.get_peak_memory()}
        results.append(result)
        print(json.dumps(result), flush=True)
    finally:
        stream.close()
        model.speech_tokenizer.decoder.reset_streaming_state()
        mx.synchronize()
        mx.clear_cache()
report = {'results': results, 'seed': 42, 'charactersPerLane': len(text),
          'pairThroughputRatio': np.mean([r['audioPerSecond'] for r in results if r['case'] == 'pair']) /
                                 np.mean([r['audioPerSecond'] for r in results if r['case'] == 'single'])}
(output / 'report.json').write_text(json.dumps(report, indent=2))
