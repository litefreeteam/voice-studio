"""Bounded MLX decoding and exceptional cleanup; no model downloads required."""
import importlib.util
from pathlib import Path
import tempfile
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import numpy as np

spec = importlib.util.spec_from_file_location("memory_worker", Path(__file__).parents[1] / "backend/worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class StreamingMemoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.studio = worker.Studio(self.temp.name)
        self.studio.is_mlx = True
        self.cleaned = []
        self.studio._mlx = SimpleNamespace(
            synchronize=lambda: self.cleaned.append("sync"), clear_cache=lambda: self.cleaned.append("clear"))
        self.decoder = SimpleNamespace(reset_streaming_state=lambda: self.cleaned.append("reset"))

    def model(self, generate):
        self.studio.model = SimpleNamespace(
            generate_custom_voice=generate, generate_voice_design=generate, generate=generate,
            speech_tokenizer=SimpleNamespace(decoder=self.decoder))

    def test_cache_budget_is_applied_before_model_loading(self):
        calls = []
        mx = SimpleNamespace(set_cache_limit=lambda limit: calls.append(("limit", limit)),
                             clear_cache=lambda: calls.append(("clear", None)))
        model = object()
        def load_model(folder):
            calls.append(("load", folder))
            return model
        self.studio.model_ready = lambda key: True
        modules = {"mlx": SimpleNamespace(core=mx), "mlx.core": mx,
                   "mlx_audio.tts.utils": SimpleNamespace(load_model=load_model)}
        with patch.dict(sys.modules, modules):
            self.studio.load('standard')
            self.studio.load('standard')
        self.assertEqual(calls[:2], [("limit", 256 * 1024 * 1024), ("clear", None)])
        self.assertEqual(len(calls), 3, 'adjacent segments reuse the loaded model')
        self.assertIs(self.studio.model, model)

    def test_all_voice_modes_stream_without_shortening_text_or_token_budget(self):
        for mode in ("preset", "design", "clone"):
            calls = []
            source = np.array([.1, .2, .3], dtype=np.float32)
            def generate(**kwargs):
                calls.append(kwargs)
                yield SimpleNamespace(audio=source, sample_rate=24000)
                source[:] = .4
                yield SimpleNamespace(audio=source, sample_rate=24000)
                self.cleaned.append("exhausted")
            self.model(generate)
            text = "完整文案，不截掉后面的字。" * 20
            audio, rate = self.studio._synthesize(text, "Vivian", "自然", {
                "mode": mode, "refPath": "/sample.wav", "refText": "参考原话"})
            np.testing.assert_allclose(audio, [.1, .2, .3, .4, .4, .4])
            self.assertEqual(rate, 24000)
            self.assertEqual(calls[0]["text"], text)
            self.assertTrue(calls[0]["stream"])
            self.assertEqual(calls[0]["streaming_interval"], 2.0)
            self.assertEqual(calls[0]["max_tokens"], 4096)
            self.assertEqual(self.cleaned[-4:], ["exhausted", "reset", "sync", "clear"])

    def test_failed_generation_releases_decoder_state_and_does_not_return_partial_audio(self):
        def generate(**kwargs):
            try:
                yield SimpleNamespace(audio=np.ones(10), sample_rate=24000)
                raise RuntimeError("inference failed")
            finally:
                self.cleaned.append("closed")
        self.model(generate)
        with self.assertRaisesRegex(RuntimeError, "inference failed"):
            self.studio._synthesize("完整文本", "Vivian", "")
        self.assertEqual(self.cleaned, ["closed", "reset", "sync", "clear"])

    def test_invalid_chunk_closes_suspended_generator(self):
        def generate(**kwargs):
            try:
                yield SimpleNamespace(audio=object(), sample_rate=24000)
            finally:
                self.cleaned.append("closed")
        self.model(generate)
        with self.assertRaises((TypeError, ValueError)):
            self.studio._synthesize("转换失败", "Vivian", "")
        self.assertEqual(self.cleaned, ["closed", "reset", "sync", "clear"])


if __name__ == "__main__":
    unittest.main()
