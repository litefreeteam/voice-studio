"""Actual DSP, persistence, reference staging and delivery; no TTS model downloads."""
import base64
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
import uuid
import zipfile

import numpy as np
import soundfile as sf

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("audio_worker", ROOT / "backend/worker.py")
worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
tools = worker.local_module("audio_tools")
refs = worker.local_module("reference_tools")
delivery = worker.local_module("delivery")


class AudioToolsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.studio = worker.Studio(self.temp.name); self.studio.is_mlx = False
        self.licence = patch.object(worker, "require_license", return_value={}); self.licence.start(); self.addCleanup(self.licence.stop)

    def tone(self, seconds=4, rate=24000, amplitude=.1, frequency=440):
        return (np.sin(np.arange(round(seconds * rate)) / rate * 2 * np.pi * frequency) * amplitude).astype(np.float32)

    def item(self, audio=None, rate=24000, **options):
        identifier = uuid.uuid4().hex; folder = self.studio.outputs / identifier; folder.mkdir()
        audio = self.tone() if audio is None else audio
        tools.encode(folder / "voice", audio, rate)
        item = {"id": identifier, "wav": "voice.wav", "mp3": "voice.mp3", "text": "这是本地音频测试。", "duration": len(audio) / rate,
                "createdAt": 100, "options": options}
        tools.atomic_json(folder / "metadata.json", item); self.studio.save_item(item)
        return item

    def asset(self, seconds=2, rate=44100):
        file = Path(self.temp.name) / "背景音乐.wav"; sf.write(file, self.tone(seconds, rate, .1, 220), rate)
        return tools.import_background(self.studio, {"path": str(file)})

    def test_edits_preserve_source_and_history_order_and_restore(self):
        first = self.item(); second = self.item()
        original = (self.studio.outputs / first["id"] / first["wav"]).read_bytes()
        edited = tools.save_edit(self.studio, {"id": first["id"], "edit": {"trimStartMs": 500, "trimEndMs": 500, "gainDb": -6, "fadeInMs": 100, "fadeOutMs": 100}})
        self.assertEqual(edited["editedDuration"], 3)
        file = self.studio.outputs / first["id"] / edited["editedWav"]
        audio, rate = sf.read(file); self.assertLess(np.max(np.abs(audio)), .051)
        self.assertEqual(audio[0], 0); self.assertEqual(audio[-1], 0)
        self.assertEqual((self.studio.outputs / first["id"] / first["wav"]).read_bytes(), original)
        self.assertEqual([row["id"] for row in self.studio.history()], [second["id"], first["id"]])
        restored = tools.save_edit(self.studio, {"id": first["id"], "edit": {}})
        np.testing.assert_array_equal(sf.read(self.studio.outputs / first["id"] / restored["editedWav"])[0], sf.read(io.BytesIO(original))[0])

    def test_edit_rejects_empty_nan_out_of_range_and_unknown_fields(self):
        for invalid in ({"trimStartMs": 4000}, {"gainDb": float('nan')}, {"gainDb": 13}, {"trimEndMs": -1}, {"fadeInMs": 3000, "fadeOutMs": 2000}, {"path": "/tmp/a"}, {"gainDb": True}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError): tools.edit_settings(invalid, 4)
        with self.assertRaises(ValueError): tools.item_for(self.studio, '../outside')

    def test_quality_flags_signal_problems_without_claiming_reading_accuracy(self):
        report = tools.quality(np.concatenate([self.tone(1), np.zeros(3 * 24000), self.tone(1)]), 24000)
        self.assertIn('LONG_INTERNAL_SILENCE', report['flags']); self.assertFalse(report['semanticCheck'])
        self.assertIn('SILENT_AUDIO', tools.quality(np.zeros(24000), 24000)['flags'])
        self.assertIn('LOW_LEVEL', tools.quality(self.tone(2, amplitude=.005), 24000)['flags'])
        self.assertIn('CLIPPING', tools.quality(np.ones(24000), 24000)['flags'])
        self.assertFalse(tools.quality(self.tone(), 24000)['review'])

    def test_generation_retries_a_silent_segment_and_reports_recovery(self):
        with patch.object(self.studio, 'model_ready', return_value=True), patch.object(self.studio, 'load'), patch.object(self.studio, 'synthesize', side_effect=[(np.zeros(24000), 24000), (self.tone(), 24000)]) as synth, patch.object(worker, 'emit'):
            result = self.studio.generate({'text': '这是一句测试。', 'mode': 'preset', 'speaker': 'Vivian'})
        self.assertEqual(synth.call_count, 2); self.assertEqual(result['items'][0]['quality']['retries'], 1)
        self.assertFalse(result['items'][0]['quality']['review'])

    def test_generation_does_not_publish_all_silent_output_after_two_retries(self):
        with patch.object(self.studio, 'model_ready', return_value=True), patch.object(self.studio, 'load'), patch.object(self.studio, 'synthesize', return_value=(np.zeros(24000), 24000)) as synth, patch.object(worker, 'emit'), self.assertRaises(RuntimeError):
            self.studio.generate({'text': '测试。', 'mode': 'preset', 'speaker': 'Vivian'})
        self.assertEqual(synth.call_count, 3); self.assertEqual(self.studio.history(), [])

    def test_failed_quality_retry_keeps_audible_original_for_manual_review(self):
        audio = np.concatenate([self.tone(1), np.zeros(3 * 24000), self.tone(1)])
        with patch.object(self.studio, 'model_ready', return_value=True), patch.object(self.studio, 'load'), patch.object(self.studio, 'synthesize', side_effect=[(audio, 24000), RuntimeError('retry engine failed')]), patch.object(worker, 'emit'):
            result = self.studio.generate({'text': '这是有较长停顿的一句测试。', 'mode': 'preset', 'speaker': 'Vivian'})
        self.assertTrue(result['items'][0]['quality']['review']); self.assertIn('retryError', result['items'][0]['quality'])
        self.assertEqual(len(self.studio.history()), 1)

    def test_mix_resamples_loops_offsets_and_ducks(self):
        asset = self.asset(seconds=.4, rate=44100)
        settings = {'backgroundId': asset['id'], 'gainDb': -6, 'loop': True, 'ducking': False, 'offsetMs': 500}
        mixer = tools.BackgroundMixer(self.studio, settings, 24000)
        mixed = mixer.process(np.zeros(48000)); mixer.close()
        self.assertEqual(np.max(np.abs(mixed[:12000])), 0); self.assertGreater(np.max(np.abs(mixed[40000:])), .04)
        settings['offsetMs'] = 0; settings['loop'] = False
        mixer = tools.BackgroundMixer(self.studio, settings, 24000); short = mixer.process(np.zeros(48000)); mixer.close()
        self.assertEqual(np.max(np.abs(short[10000:])), 0)
        settings.update(loop=True, ducking=True)
        voice = np.ones(48000) * .1
        mixer = tools.BackgroundMixer(self.studio, settings, 24000); ducked = mixer.process(voice) - voice; mixer.close()
        self.assertLess(np.sqrt(np.mean(ducked[24000:] ** 2)), .012)

    def test_export_and_preview_use_identical_edits_mix_and_subtitle_timing(self):
        original = self.item(); asset = self.asset()
        edited = tools.save_edit(self.studio, {'id': original['id'], 'edit': {'trimStartMs': 500, 'trimEndMs': 500, 'gainDb': -6}})
        data = {'items': [{'id': original['id'], 'editRevision': edited['editedWav']}], 'settings': {'normalize': False},
                'mix': {'backgroundId': asset['id'], 'gainDb': -20, 'loop': True, 'ducking': True, 'offsetMs': 0}}
        result = delivery.build_delivery(self.studio, data, lambda *a, **kw: None)
        with zipfile.ZipFile(result['path']) as archive:
            wav = archive.read('merged.wav'); subtitles = archive.read('subtitles.srt').decode()
            report = json.loads(archive.read('report.json'))
        preview = delivery.build_delivery(self.studio, data, lambda *a, **kw: None, preview_seconds=30)
        self.assertEqual(wav, base64.b64decode(preview['audio'])); self.assertIn('00:00:03,000', subtitles)
        self.assertEqual(report['mix']['backgroundId'], asset['id']); self.assertEqual(result['durationSeconds'], 3)
        self.assertEqual(report['segments'][0]['audioEdit']['gainDb'], -6)
        self.assertFalse(list((self.studio.root / '.export-work').iterdir()))

    def test_export_refuses_changed_edits_or_missing_background(self):
        original = self.item(); tools.save_edit(self.studio, {'id': original['id'], 'edit': {'gainDb': -3}})
        with self.assertRaisesRegex(ValueError, '编辑已改变'):
            delivery.build_delivery(self.studio, {'items': [{'id': original['id'], 'editRevision': ''}]}, lambda *a, **kw: None)
        with self.assertRaises(ValueError): tools.BackgroundMixer(self.studio, {'backgroundId': uuid.uuid4().hex}, 24000)

    def test_mixed_peak_safety_reports_when_music_is_too_loud(self):
        item = self.item(self.tone(amplitude=.8)); asset = self.asset()
        file = self.studio.root / 'mix-assets' / asset['id'] / 'audio.wav'; sf.write(file, np.ones(48000) * .8, 24000)
        result = delivery.build_delivery(self.studio, {'items': [{'id': item['id']}], 'settings': {'normalize': False},
            'mix': {'backgroundId': asset['id'], 'gainDb': 0, 'loop': True, 'ducking': False, 'offsetMs': 0}}, lambda *a, **kw: None)
        with zipfile.ZipFile(result['path']) as archive:
            report = json.loads(archive.read('report.json')); audio, _ = sf.read(io.BytesIO(archive.read('merged.wav')))
        self.assertGreater(report['quality']['mixedPeakLimitedSamples'], 0)
        self.assertIn('MIX_PEAK_LIMITED', [warning['code'] for warning in report['warnings']])
        self.assertLessEqual(float(np.abs(audio).max()), 10 ** (-1 / 20))

    def test_preview_is_capped_at_thirty_seconds_and_cleans_intermediates(self):
        item = self.item(self.tone(45))
        result = delivery.build_delivery(self.studio, {'items': [{'id': item['id']}]}, lambda *a, **kw: None, preview_seconds=30)
        audio, rate = sf.read(io.BytesIO(base64.b64decode(result['audio'])))
        self.assertEqual(len(audio), 30 * rate); self.assertEqual(result['durationSeconds'], 30)
        self.assertFalse(list((self.studio.root / '.export-tmp').iterdir()))

    def test_reference_import_crops_long_recordings_commits_and_cleans(self):
        file = self.studio.root / '较长录音.wav'; sf.write(file, self.tone(45), 24000)
        staged = refs.open_reference(self.studio, {'path': str(file), 'consent': True})
        with self.assertRaises(ValueError): refs.selection(self.studio, {'token': staged['token'], 'startMs': 0, 'endMs': 31000})
        result = refs.commit(self.studio, {'token': staged['token'], 'startMs': 2000, 'endMs': 7000, 'consent': True, 'name': '熟悉的声音', 'text': '准确原话。'})
        self.assertEqual(result['duration'], 5); self.assertEqual(result['text'], '准确原话。')
        self.assertEqual(sf.info(self.studio.references / (result['id'] + '.wav')).duration, 5)
        self.assertFalse((self.studio.root / '.reference-imports' / staged['token']).exists())

    def test_reference_rejects_missing_consent_empty_transcript_and_silent_selection(self):
        file = self.studio.root / '静音.wav'; sf.write(file, np.zeros(24000 * 5), 24000)
        with self.assertRaises(ValueError): refs.open_reference(self.studio, {'path': str(file)})
        staged = refs.open_reference(self.studio, {'path': str(file), 'consent': True})
        data = {'token': staged['token'], 'startMs': 0, 'endMs': 5000, 'consent': True, 'name': '录音', 'text': '原话'}
        with self.assertRaises(ValueError): refs.commit(self.studio, data)
        with self.assertRaises(ValueError): refs.commit(self.studio, {**data, 'text': ''})
        refs.cancel(self.studio, data); self.assertFalse((self.studio.root / '.reference-imports' / staged['token']).exists())

    def test_transcription_is_offline_cpu_transcription_and_uses_only_selected_audio(self):
        file = self.studio.root / '录音.wav'; sf.write(file, self.tone(8), 24000)
        staged = refs.open_reference(self.studio, {'path': str(file), 'consent': True})
        calls = {}
        class Model:
            def __init__(self, path, **kwargs): calls['constructor'] = kwargs
            def transcribe(self, audio, **kwargs):
                calls['frames'] = len(audio); calls['args'] = kwargs
                return iter([types.SimpleNamespace(text='这是识别原话。')]), types.SimpleNamespace(language='zh')
        with patch.dict('sys.modules', {'faster_whisper': types.SimpleNamespace(WhisperModel=Model)}), patch.object(refs, 'model_status', return_value={'ready': True}):
            result = refs.transcribe(self.studio, {'token': staged['token'], 'startMs': 1000, 'endMs': 5000, 'language': 'zh'}, lambda *a, **kw: None)
        self.assertEqual(result['text'], '这是识别原话。'); self.assertEqual(calls['frames'], 64000)
        self.assertTrue(calls['constructor']['local_files_only']); self.assertEqual(calls['constructor']['device'], 'cpu')
        self.assertEqual(calls['args']['language'], 'zh'); self.assertNotIn('translate', calls['args'])

    def test_version_selection_cannot_select_an_unrelated_clip_and_persists(self):
        first, unrelated = self.item(), self.item()
        with self.assertRaises(ValueError): tools.select_version(self.studio, {'groupId': first['id'], 'id': unrelated['id']})
        self.assertEqual(tools.select_version(self.studio, {'groupId': first['id'], 'id': first['id']})[first['id']], first['id'])
        self.assertEqual(tools.selections(worker.Studio(self.temp.name))[first['id']], first['id'])


if __name__ == '__main__': unittest.main()
