import importlib.util
from pathlib import Path
import tempfile
import unittest
import numpy as np
import soundfile as sf

spec = importlib.util.spec_from_file_location("previews", Path(__file__).parents[1] / "scripts/build-previews.py")
previews = importlib.util.module_from_spec(spec)
spec.loader.exec_module(previews)


class PreviewMasteringTests(unittest.TestCase):
    def test_trim_and_level_match_leave_bounded_padding_and_preserve_peak_headroom(self):
        with tempfile.TemporaryDirectory() as folder:
            rate = 24000
            speech = .2 * np.sin(2 * np.pi * 220 * np.arange(rate) / rate)
            source, output = Path(folder) / "voice.wav", Path(folder) / "voice.mp3"
            sf.write(source, np.concatenate([np.zeros(rate), speech, np.zeros(rate * 2)]), rate)
            duration = previews.master_preview(source, output, {"targetRmsDb": -21, "paddingMs": 160, "peak": .9})
            audio, sample_rate = sf.read(output)
            self.assertEqual(sample_rate, rate)
            self.assertAlmostEqual(duration, 1.32, places=2)
            self.assertLess(float(np.max(np.abs(audio))), .95)
            self.assertAlmostEqual(20 * np.log10(np.sqrt(np.mean(audio * audio))), -21, delta=1)

    def test_silent_recording_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "silent.wav"
            sf.write(source, np.zeros(24000), 24000)
            with self.assertRaises(ValueError):
                previews.master_preview(source, Path(folder) / "silent.mp3", {"targetRmsDb": -21, "paddingMs": 160, "peak": .9})
