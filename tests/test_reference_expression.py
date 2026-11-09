import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import numpy as np

ROOT = Path(__file__).parents[1]
def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'backend' / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

worker = module('worker')
expression = module('reference_expression')


class ReferenceExpressionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.license = patch.object(worker, 'require_license')
        self.license.start()
        self.addCleanup(self.license.stop)
        self.studio = worker.Studio(self.temp.name)
        self.reference = 'a' * 32
        self.studio.list_references = lambda: [{'id': self.reference, 'text': '原录音的准确原话'}]
        self.request = {'text': '欢迎回家。', 'mode': 'clone', 'referenceId': self.reference, 'sampleRate': 48000}

    def test_opt_in_routes_controls_to_voxcpm_and_keeps_identity_in_history(self):
        calls = []
        self.studio.load = lambda key: calls.append(('load', key))
        def synthesize(text, speaker, instruction, options):
            calls.append(('synthesize', text, instruction, dict(options)))
            return np.sin(np.arange(4800) / 12).astype('float32') * .2, 48000
        self.studio.synthesize = synthesize
        original = self.studio.generate(self.request)['items'][0]
        expressive = self.studio.generate({**self.request, 'referenceStyle': 'expressive', 'emotion': 'happy',
                                          'intensity': 80, 'pace': 'fast', 'instruction': '像和朋友聊天。'})['items'][0]
        self.assertEqual([call[1] for call in calls if call[0] == 'load'], ['reference', 'expressive'])
        spoken = [call for call in calls if call[0] == 'synthesize']
        self.assertEqual(spoken[0][2], '')
        for prompt in ['开心', '语速稍快', '情绪表达鲜明', '像和朋友聊天。']:
            self.assertIn(prompt, spoken[1][2])
        self.assertEqual(spoken[0][3]['refPath'], spoken[1][3]['refPath'])
        self.assertEqual(expressive['options']['referenceId'], original['options']['referenceId'])
        self.assertEqual(expressive['options']['referenceStyle'], 'expressive')
        self.assertEqual(expressive['nativeSampleRate'], 48000)
        self.assertIn('VoxCPM2', expressive['model'])
        reopened = worker.Studio(self.temp.name)
        self.assertEqual(reopened.history()[0]['options']['referenceStyle'], 'expressive')

    def test_missing_optional_model_fails_without_downloading_or_using_another_voice(self):
        self.studio.download = lambda *args: self.fail('generation must never download')
        self.studio.synthesize = lambda *args: self.fail('missing model must not synthesize with a fallback voice')
        with self.assertRaisesRegex(RuntimeError, '我的声音·情绪表达'):
            self.studio.generate({**self.request, 'referenceStyle': 'expressive', 'emotion': 'happy'})
        self.assertEqual(self.studio.history(), [])

    def test_invalid_performance_is_rejected_before_any_model_load(self):
        self.studio.load = lambda *args: self.fail('invalid requests cannot load models')
        for controls in [{'referenceStyle': 'invalid'}, {'emotion': 'sad'},
                         {'referenceStyle': 'expressive', 'intensity': 101},
                         {'referenceStyle': 'expressive', 'pace': 'invalid'},
                         {'referenceStyle': 'expressive', 'emotion': 'invalid'}]:
            with self.subTest(controls=controls), self.assertRaises(ValueError):
                self.studio.generate({**self.request, **controls})

    def test_fixed_design_voices_do_not_inherit_a_recording_only_expression_setting(self):
        calls = []
        self.studio.model_ready = lambda key: True
        self.studio.load = lambda key: calls.append(('load', key))
        def synthesize(text, speaker, instruction, options):
            calls.append(('synthesize', dict(options)))
            return np.sin(np.arange(4 * 24000) / 12).astype('float32') * .2, 24000
        self.studio.synthesize = synthesize
        options = {'mode': 'design', 'voiceDescription': '清晰自然的成年女性声音',
                   'referenceStyle': 'expressive', 'voiceScopeId': 'mixed-script', 'voiceId': 'narrator'}
        self.studio.generate({**options, 'text': '第一句。'})
        self.studio.generate({**options, 'text': '第二句。'})
        clones = [call[1] for call in calls if call[0] == 'synthesize' and call[1]['mode'] == 'clone']
        self.assertTrue(clones)
        self.assertTrue(all(options['referenceStyle'] == 'original' for options in clones))
        self.assertNotIn(('load', 'expressive'), calls)

    def test_both_inference_adapters_receive_reference_identity_and_instruction_separately(self):
        text = ('今天一起散步，看看河边的风景。' * 12) + ' hello world. 𠮷野家很好。'
        for mlx in [True, False]:
            calls = []
            def generate(**values):
                calls.append(values)
                if mlx:
                    return iter([SimpleNamespace(audio=np.ones(100, dtype='float32') * .1, sample_rate=48000)])
                class Tensor:
                    def detach(self): return self
                    def float(self): return self
                    def cpu(self): return self
                    def numpy(self): return np.ones(100, dtype='float32') * .1
                return Tensor()
            studio = SimpleNamespace(is_mlx=mlx, model=SimpleNamespace(generate=generate, sample_rate=48000), _mlx=None)
            audio, rate = expression.synthesize(studio, text, '开心（不要夸张）\n语速稍快。', {'refPath': '/private/reference.wav'})
            self.assertEqual(rate, 48000)
            self.assertEqual(len(audio), len(calls) * 100)
            self.assertGreater(len(calls), 1)
            if mlx:
                self.assertEqual(''.join(call['text'] for call in calls), text)
                self.assertTrue(all(call['ref_audio'] == '/private/reference.wav' for call in calls))
                self.assertTrue(all('开心' in call['instruct'] and '语速稍快' in call['instruct'] for call in calls))
            else:
                self.assertEqual(''.join(call['target_text'].split(')', 1)[1] for call in calls), text)
                self.assertTrue(all(call['reference_wav_path'] == '/private/reference.wav' for call in calls))
            self.assertTrue(all('prompt_text' not in call and 'prompt_audio' not in call and 'prompt_wav_path' not in call for call in calls))

    def test_vendor_source_integrity_and_pinned_model_sizes(self):
        import hashlib
        vendor = ROOT / 'backend/vendor/voxcpm'
        upstream = json.loads((vendor / 'UPSTREAM.json').read_text())
        for filename, digest in upstream['files'].items():
            local = vendor / ('LICENSE' if filename == 'LICENSE' else filename.removeprefix('src/voxcpm/'))
            self.assertEqual(hashlib.sha256(local.read_bytes()).hexdigest(), digest)
        for repo, total in [('mlx-community/VoxCPM2-4bit', 2300906223), ('openbmb/VoxCPM2', 4960727452)]:
            spec = worker.MODEL_MANIFEST[repo]
            self.assertEqual(sum(entry['size'] for entry in spec['files'].values()), total)
            self.assertTrue(all(len(entry['sha256']) == 64 and entry['modelscopeRevision'] for entry in spec['files'].values()))

if __name__ == '__main__':
    unittest.main()
