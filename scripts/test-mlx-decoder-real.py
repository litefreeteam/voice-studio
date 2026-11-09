"""Local decoder conformance: float32 streaming vs bounded full-window reference.

Needs the installed standard model. No downloads or application data writes.
Checks single and paired lanes with synthetic codes; not a speech quality score.
"""
import argparse
import importlib.util
import json
from pathlib import Path

import mlx.core as mx
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=False)
root = Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


worker = load('decoder_worker', root / 'backend/worker.py')
module = load('decoder_conformance', root / 'backend/mlx_decoder.py')
installed = Path.home() / 'Library/Application Support/Voice Studio'
worker.require_license(installed)
studio = worker.Studio(output / 'scratch', installed)
studio.load('standard')
original = studio.model.speech_tokenizer.decoder
fixed = module.StreamingDecoder(original)
mx.random.seed(42)
codes = mx.random.randint(0, 2048, (2, 16, 24))
mx.eval(codes)
# Each full reference is just 24 frames in one lane, within the original
# production 25-frame memory budget. Never decode a long utterance at once.
reference = []
for row in range(2):
    original.reset_streaming_state()
    reference.append(np.array(original(codes[row:row + 1]), copy=True))
    mx.synchronize()
    mx.clear_cache()
reference = np.concatenate(reference, axis=0)
results = []
for name, decoder, lanes in [('original-single', original, 1), ('fixed-single', fixed, 1), ('fixed-pair', fixed, 2)]:
    decoder.reset_streaming_state()
    chunks = [np.array(decoder.streaming_step(codes[:lanes, :, start:start + 8]), copy=True) for start in range(0, 24, 8)]
    actual = np.concatenate(chunks, axis=2)
    expected = reference[:lanes]
    error = actual - expected
    snr = float(10 * np.log10(np.sum(expected ** 2) / np.sum(error ** 2)))
    results.append({'case': name, 'snrDb': snr, 'maxAbsoluteError': float(np.max(np.abs(error))),
                    'sameShape': actual.shape == expected.shape, 'finite': bool(np.isfinite(actual).all())})
    if name.startswith('fixed'):
        assert snr > 40 and np.isfinite(actual).all(), results[-1]
    decoder.reset_streaming_state()
    mx.synchronize()
    mx.clear_cache()
(output / 'report.json').write_text(json.dumps(results, indent=2))
print(json.dumps(results), flush=True)
