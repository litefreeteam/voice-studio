"""Production audio tools and protocol with deterministic TTS only, for desktop QA."""
import importlib.util
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location('audio_production_worker', Path(__file__).with_name('studio_worker.py'))
worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
worker.PUBLIC_KEY_PEM = (Path(__file__).parent.parent / 'shared/license-public.pem').read_bytes()
original_status = worker.Studio.status

def status(self):
    value = original_status(self)
    value['modelReady'] = True
    value['packages'] = [{'id': key, 'ready': True, 'verified': True} for key in worker.MODEL_NAMES]
    return value

def load(self, key='standard'):
    self.loaded_key = key; self.device = 'deterministic desktop fixture'

def synthesize(self, text, speaker, instruction, options=None):
    self._test_take = getattr(self, '_test_take', 0) + 1
    rate = 24000
    audio = np.sin(np.arange(rate * 4) / rate * 2 * np.pi * (220 + self._test_take * 40)) * .1
    return audio.astype(np.float32), rate

worker.Studio.status = status
worker.Studio.load = load
worker.Studio.model_ready = lambda self, key: True
worker.Studio.synthesize = synthesize
worker.main()
