import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location('retired_worker', ROOT / 'backend/worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class RetiredMarkupTests(unittest.TestCase):
    def test_controls_are_rejected_before_inference(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(worker, 'require_license'), patch.object(worker, 'emit'):
            studio = worker.Studio(directory)
            studio.load = lambda *args: self.fail('withdrawn markers must not load a model')
            for text in ['正文<#0.5#>结尾', '[[emotion:happy]]词语[[/emotion]]', '正文[[cue:laugh]]', '正文<#0.5']:
                with self.subTest(text=text), self.assertRaisesRegex(ValueError, '已撤回'):
                    studio.generate({'text': text})

    def test_short_plain_paragraph_and_global_emotion_use_one_inference(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(worker, 'require_license'), patch.object(worker, 'emit'):
            studio, calls = worker.Studio(directory), []
            studio.load = lambda *args: None
            def synthesize(text, speaker, instruction, options):
                calls.append((text, instruction))
                return np.sin(np.arange(24000) / 12).astype('float32') * .2, 24000
            studio.synthesize = synthesize
            text = '今天我们一起出发。路上的风景一定很美，真让人期待。'
            item = studio.generate({'text': text, 'emotion': 'happy'})['items'][0]
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0], text)
            self.assertIn('开心', calls[0][1])
            self.assertEqual(item['text'], text)
            self.assertNotIn('sourceText', item)
            self.assertNotIn('inlinePauses', item)


if __name__ == '__main__':
    unittest.main()
