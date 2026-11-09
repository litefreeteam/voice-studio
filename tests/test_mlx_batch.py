"""Batch scheduling, EOS isolation and bounded streaming without model downloads."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


worker = load('batch_worker', ROOT / 'backend/worker.py')


class CodecBatchTests(unittest.TestCase):
    def setUp(self):
        self.cleaned = []
        fake_mx = SimpleNamespace(**{name: getattr(np, name) for name in (
            'concatenate', 'broadcast_to', 'zeros', 'zeros_like', 'where', 'stack', 'transpose', 'bool_')},
            eval=lambda *args: None, synchronize=lambda: self.cleaned.append('sync'),
            clear_cache=lambda: self.cleaned.append('clear'))
        with patch.dict(sys.modules, {'mlx': SimpleNamespace(core=fake_mx), 'mlx.core': fake_mx}):
            self.batch = load('codec_batch', ROOT / 'backend/mlx_batch.py')
        self.steps, self.inputs, self.chunks = 0, [], []
        self.ends = [3, 15]
        self.decoder = SimpleNamespace(reset_streaming_state=lambda: self.cleaned.append('reset'),
                                       streaming_step=self.decode)
        self.batch.streaming_decoder = lambda model: self.decoder
        class Talker:
            make_cache = lambda self: []
            code_predictor = SimpleNamespace(make_cache=lambda: [])
            def __call__(_, inputs, cache):
                self.inputs.append(inputs.copy())
                return np.zeros((len(self.ends), 1, 1)), np.zeros((len(self.ends), 1, 1))
        def prepare(text, **kwargs):
            length = int(text)
            return np.zeros((1, 1, 1)), np.arange(1, length + 1).reshape(1, length, 1), np.array([[[-1]]])
        self.model = SimpleNamespace(
            _prepare_generation_inputs=prepare, talker=Talker(),
            config=SimpleNamespace(talker_config=SimpleNamespace(codec_eos_token_id=99)),
            _suppress_codec_tokens=lambda eos: [], _sample_token_batch=self.sample,
            _predict_code_tokens=lambda token, hidden, **kw: ([token], np.repeat(token, 16, axis=1)),
            _codec_embeds_for_tokens=lambda tokens: np.zeros((len(self.ends), 1, 1)),
            speech_tokenizer=SimpleNamespace(decoder=self.decoder, decode_upsample_rate=3), sample_rate=24000)

    def sample(self, logits, **kwargs):
        tokens = np.array([[99 if self.steps >= end else row + 1] for row, end in enumerate(self.ends)])
        self.steps += 1
        return tokens

    def decode(self, codes):
        self.chunks.append(codes.copy())
        self.assertLessEqual(codes.shape[2], 8)
        self.assertTrue((codes < 99).all(), 'EOS must never reach the codec decoder')
        return np.repeat(codes[:, :1, :], 3, axis=2).astype(np.float32)

    def stream(self):
        return self.batch.generate(self.model, ['2', '5'], 'Vivian', '')

    def test_early_eos_keeps_rows_separate_and_flushes_only_valid_samples(self):
        audio = [[], []]
        for chunk in self.stream():
            audio[chunk.sequence_idx].extend(chunk.audio.tolist())
        self.assertEqual(audio, [[1.] * 9, [2.] * 45])
        self.assertEqual([c.shape[2] for c in self.chunks], [8, 7])
        # Final text embedding is consumed, then padding; shorter row never
        # borrows the longer row's text or drops its own final embedding.
        self.assertEqual([a[0, 0, 0] for a in self.inputs[1:5]], [1, 2, -1, -1])
        self.assertEqual([a[1, 0, 0] for a in self.inputs[1:7]], [1, 2, 3, 4, 5, -1])
        self.assertEqual(self.cleaned[-3:], ['reset', 'sync', 'clear'])

    def test_exact_chunk_boundary_does_not_duplicate_tail(self):
        self.ends = [8, 8]
        chunks = list(self.stream())
        self.assertEqual([len(c.audio) for c in chunks], [24, 24])
        self.assertEqual(len(self.chunks), 1)

    def test_single_lane_stops_at_eos_without_padding_or_duplicating_samples(self):
        self.ends = [15]
        chunks = list(self.batch.generate(self.model, ['5'], 'Vivian', '轻松自然'))
        self.assertEqual([chunk.sequence_idx for chunk in chunks], [0, 0])
        self.assertEqual([len(chunk.audio) for chunk in chunks], [24, 21])
        self.assertEqual(self.cleaned[-3:], ['reset', 'sync', 'clear'])

    def test_cancel_and_decoder_error_both_release_streaming_state(self):
        stream = self.stream()
        next(stream)
        stream.close()
        self.assertEqual(self.cleaned[-3:], ['reset', 'sync', 'clear'])
        self.steps = 0
        self.decoder.streaming_step = lambda codes: (_ for _ in ()).throw(RuntimeError('decoder failed'))
        with self.assertRaisesRegex(RuntimeError, 'decoder failed'):
            list(self.stream())
        self.assertEqual(self.cleaned[-3:], ['reset', 'sync', 'clear'])

    def test_token_limit_is_an_error_instead_of_a_successful_truncated_clip(self):
        self.batch.MAX_TOKENS = 2
        with self.assertRaisesRegex(RuntimeError, '生成上限'):
            list(self.stream())
        self.assertEqual(self.cleaned[-3:], ['reset', 'sync', 'clear'])

    def test_more_than_two_lanes_are_rejected(self):
        with self.assertRaises(ValueError):
            list(self.batch.generate(self.model, ['2'] * 3, 'Vivian', ''))


class SchedulingTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.studio = worker.Studio(temp.name)
        self.studio.is_mlx = True
        self.studio.load = lambda key: None
        self.studio.device = 'test'
        self.single, self.pairs = [], []
        self.studio.synthesize = self.synthesize
        self.studio.synthesize_pair = self.pair
        self.license = patch.object(worker, 'require_license')
        self.license.start()
        self.addCleanup(self.license.stop)
        self.emitter = patch.object(worker, 'emit')
        self.emitter.start()
        self.addCleanup(self.emitter.stop)

    def synthesize(self, text, *args):
        self.single.append(text)
        return np.ones(2400, np.float32) * .1, 24000

    def pair(self, texts, *args):
        self.pairs.append(texts)
        return [(np.ones(2400, np.float32) * (i + 1) / 10, 24000) for i in range(len(texts))]

    def test_pairs_preserve_order_settings_audio_and_odd_last_row(self):
        import soundfile as sf
        rows = [{'text': char * 100, 'filename': char, 'sampleRate': rate}
                for char, rate in zip('abcde', [24000, 48000, 44100, 24000, 48000])]
        result = self.studio.generate({'rows': rows})['items']
        self.assertEqual(self.pairs, [[r['text'] for r in rows[:2]], [r['text'] for r in rows[2:4]]])
        self.assertEqual(self.single, [rows[-1]['text']])
        self.assertEqual([i['text'] for i in result], [r['text'] for r in rows])
        self.assertEqual([i['sampleRate'] for i in result], [r['sampleRate'] for r in rows])
        for index, item in enumerate(result):
            pcm, _ = sf.read(self.studio.outputs / item['id'] / item['wav'])
            self.assertAlmostEqual(float(np.median(pcm)), .2 if index in (1, 3) else .1, places=3)

    def test_incompatible_and_short_rows_use_single_path(self):
        for override in ({'speaker': 'Uncle_Fu'}, {'instruction': '不同语气'}, {'language': 'English'},
                         {'engine': 'light'}, {'text': '短句'}, {'text': '长' * 250}):
            self.single.clear()
            self.pairs.clear()
            self.studio.generate({'rows': [{'text': '前' * 100}, {'text': '后' * 100, **override}]})
            self.assertEqual(len(self.single), 2)
            self.assertEqual(self.pairs, [])
        self.studio.is_mlx = False
        self.studio.generate({'rows': [{'text': '甲' * 100}, {'text': '乙' * 100}]})
        self.assertEqual(self.pairs, [])

    def test_failed_pair_saves_neither_partial_clip(self):
        def fail(*args):
            raise RuntimeError('pair failed')
        self.studio.synthesize_pair = fail
        with self.assertRaisesRegex(RuntimeError, 'pair failed'):
            self.studio.generate({'rows': [{'text': '甲' * 100}, {'text': '乙' * 100}]})
        self.assertFalse(self.studio.history_file.exists())
        self.assertEqual(list(self.studio.outputs.iterdir()), [])

    def test_long_text_splits_on_sentence_boundaries_without_losing_any_character(self):
        for text in ['句子完整保留。' * 70, 'A full sentence stays together. ' * 18,
                     '保留逗号，' * 80, 'word ' * 100]:
            parts = self.studio.split_for_pair(text)
            self.assertEqual(len(parts), 2)
            self.assertEqual(''.join(parts), text)
            self.assertGreaterEqual(min(map(len, parts)), 80)
        self.assertEqual(self.studio.split_for_pair('短句。'), ['短句。'])
        # Do not cut through an unbroken word or invent punctuation.
        self.assertEqual(self.studio.split_for_pair('a' * 400), ['a' * 400])

    def test_long_row_joins_both_lanes_into_one_audio_in_original_order(self):
        self.studio.loaded_key = 'standard'
        text = '原来的句子和标点全部保留。' * 35
        audio, rate = self.studio._synthesize(text, 'Vivian', '自然', {'mode': 'preset'})
        self.assertEqual(len(self.pairs), 1)
        self.assertEqual(''.join(self.pairs[0]), text)
        self.assertEqual(rate, 24000)
        np.testing.assert_allclose(audio, [.1] * 2400 + [.2] * 2400)

    def test_short_standard_preset_also_uses_the_corrected_decoder(self):
        self.studio.loaded_key = 'standard'
        audio, rate = self.studio._synthesize('短句也应当连贯自然。', 'Vivian', '轻松自然', {'mode': 'preset'})
        self.assertEqual(self.pairs, [['短句也应当连贯自然。']])
        self.assertEqual(rate, 24000)
        np.testing.assert_allclose(audio, [.1] * 2400)


class DecoderSeamTests(unittest.TestCase):
    def test_overlap_carries_contributions_without_adding_bias_twice(self):
        fake_mx = SimpleNamespace(**{name: getattr(np, name) for name in (
            'transpose', 'arange', 'where', 'array', 'concatenate', 'clip')})
        with patch.dict(sys.modules, {'mlx': SimpleNamespace(core=fake_mx), 'mlx.core': fake_mx}):
            decoder_module = load('bounded_decoder_test', ROOT / 'backend/mlx_decoder.py')
        class Conv(dict):
            bias = np.array([.03], dtype=np.float32)
            def __init__(self):
                super().__init__(bias=self.bias)
            def __call__(self, x):
                y = np.zeros((x.shape[0], x.shape[1] * 2 + 2, 1), np.float32) + self.bias
                for i in range(x.shape[1]):
                    y[:, i * 2:i * 2 + 4, :] += x[:, i:i + 1, :]
                return y
        class Transformer:
            masks = []
            def make_cache(self):
                return [SimpleNamespace(offset=0)]
            def __call__(self, hidden, mask, cache):
                self.masks.append(mask.copy())
                cache[0].offset += hidden.shape[1]
                return hidden
        class Base:
            def streaming_step(self, codes):
                raise AssertionError('unfixed streaming path must not run')
            def reset_streaming_state(self):
                self._transformer_cache = None
                self.decoder[1].block[1]._overflow = None
        base = Base()
        identity = lambda x: x
        step = SimpleNamespace(step=identity)
        upsample = SimpleNamespace(conv=Conv(), trim_right=2, _overflow=None)
        base.pre_conv = step
        base.pre_transformer = Transformer()
        base.quantizer = SimpleNamespace(decode=identity)
        base.upsample = []
        base.decoder = [step, SimpleNamespace(block=[identity, upsample]), identity, step]
        decoder = decoder_module.StreamingDecoder(base)
        codes = np.arange(8, dtype=np.float32).reshape(1, 1, 8) / 100
        reference = upsample.conv(codes.transpose(0, 2, 1))[:, :-2].transpose(0, 2, 1)
        decoder.reset_streaming_state()
        chunks = [decoder.streaming_step(codes[:, :, i:i + 2]) for i in range(0, 8, 2)]
        np.testing.assert_allclose(np.concatenate(chunks, axis=2), reference, atol=1e-7)
        self.assertEqual([mask.shape for mask in base.pre_transformer.masks], [(2, 2), (2, 4), (2, 6), (2, 8)])
        np.testing.assert_array_equal(base.pre_transformer.masks[-1][0], [0] * 7 + [-np.inf])
        decoder.reset_streaming_state()
        self.assertIsNone(upsample._overflow)


if __name__ == '__main__':
    unittest.main()
