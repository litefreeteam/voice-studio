"""Real DSP/ZIP regressions. All samples and outputs are private synthetic fixtures."""
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import struct
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

spec = importlib.util.spec_from_file_location("delivery", Path(__file__).parents[1] / "backend" / "delivery.py")
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)


class DeliveryTests(unittest.TestCase):
    def test_subtitle_tabs_preserve_word_boundaries_without_empty_cue_lines(self):
        self.assertEqual(delivery._srt_text('请读hello\tworld。'), '请读hello world。')
        self.assertEqual(delivery._srt_text(' a\t\tb\r\n\r\n c\rd\x00\x01\x1f '), 'a  b\nc\nd')
        self.assertEqual(delivery._srt_text('\t\r\n\x00 '), '（无原文）')

    def test_exported_subtitle_retains_tab_separators_and_safe_cue_structure(self):
        items = [self.add(), self.add()]
        self.history[0]['text'] = 'hello\tworld\r\n\r\n继续。'
        self.history[1]['text'] = 'second\tline'
        _, _, _, _, srt = self.read(self.build(items))
        cues = srt.strip().split('\n\n')
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0].splitlines()[2:], ['hello world', '继续。'])
        self.assertEqual(cues[1].splitlines()[2:], ['second line'])

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="shengyue-delivery-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.outputs = self.root / "outputs"
        self.outputs.mkdir()
        self.history = []
        self.studio = types.SimpleNamespace(root=self.root, outputs=self.outputs, history=lambda: self.history)

    def add(self, values=None, rate=24000, subtype="PCM_16", **options):
        item_id = f"{len(self.history) + 1:032x}"
        folder = self.outputs / item_id
        folder.mkdir()
        if values is None:
            values = self.tone(rate)
        sf.write(folder / "voice.wav", values, rate, subtype=subtype)
        item = {"id": item_id, "wav": "voice.wav", "text": f"第{len(self.history) + 1}段。", "options": options}
        self.history.append(item)
        return {"id": item_id}

    @staticmethod
    def tone(rate, seconds=1, amplitude=.1, frequency=440):
        return amplitude * np.sin(np.arange(round(rate * seconds)) * (2 * np.pi * frequency / rate))

    def build(self, items, settings=None, **extra):
        data = {"items": items, **extra}
        if settings is not None:
            data["settings"] = settings
        return delivery.build_delivery(self.studio, data, lambda *a, **kw: None)

    def read(self, result):
        with zipfile.ZipFile(result["path"]) as archive:
            self.assertIsNone(archive.testzip())
            report = json.loads(archive.read("report.json"))
            manifest = json.loads(archive.read("manifest.json"))
            audio, rate = sf.read(io.BytesIO(archive.read("merged.wav")))
            srt = archive.read("subtitles.srt").decode()
            return report, manifest, audio, rate, srt

    def assert_clean(self):
        for name in (".export-work", ".export-tmp"):
            if (self.root / name).exists():
                self.assertEqual(list((self.root / name).iterdir()), [])

    def test_defaults_real_wav_mp3_srt_manifest_and_original_bytes(self):
        item = self.add()
        source = self.outputs / item["id"] / "voice.wav"
        before = source.read_bytes()
        result = self.build([item])
        report, manifest, audio, rate, srt = self.read(result)
        self.assertEqual(rate, 48000)
        self.assertEqual(len(audio), 48000)
        self.assertAlmostEqual(np.sqrt(np.mean(audio ** 2)), .1, delta=2e-5)
        self.assertIn("00:00:00,000 --> 00:00:01,000", srt)
        self.assertIn("第1段。", srt)
        self.assertEqual(report["settings"]["pauseMs"], 350)
        self.assertEqual(report["durationFrames"], len(audio))
        self.assertAlmostEqual(report["quality"]["outputPeak"], np.max(np.abs(audio)), places=9)
        with zipfile.ZipFile(result["path"]) as z:
            self.assertEqual(len(z.namelist()), 7)
            self.assertEqual(z.read(manifest["segments"][0]["originalWav"]), before)
            self.assertEqual(manifest["segments"][0]["sourceSha256"], hashlib.sha256(before).hexdigest())
            mp3 = sf.info(io.BytesIO(z.read("merged.mp3")))
            self.assertEqual(mp3.samplerate, rate)
            self.assertLess(abs(mp3.duration - result["durationSeconds"]), .1)
        self.assertEqual(source.read_bytes(), before)
        owner = json.loads(Path(result["path"]).with_name("owner.json").read_text())
        self.assertEqual(owner["schema"], "shengyue-export-v1")
        with zipfile.ZipFile(result["path"]) as z:
            self.assertIn("不是逐字ASR", z.read("README.txt").decode())
        self.assertEqual(sorted(p.name for p in Path(result["path"]).parent.iterdir()), ["archive.zip", "owner.json"])
        self.assertEqual(list((self.root / ".export-work").iterdir()), [])

    def test_items_order_wins_over_ids_and_history_and_parts_have_no_pause(self):
        a = self.add(self.tone(24000, .5), lineId="a", partIndex=0, partCount=2)
        b = self.add(self.tone(44100, .5, frequency=880), rate=44100, lineId="a", partIndex=1, partCount=2)
        c = self.add(self.tone(48000, .25, frequency=220), rate=48000, lineId="b", partIndex=0, partCount=1)
        result = self.build([a, b, c], ids=[c["id"], a["id"], b["id"], a["id"]])
        report, _, audio, _, srt = self.read(result)
        segments = report["segments"]
        self.assertEqual([r["id"] for r in segments], [a["id"], b["id"], c["id"]])
        self.assertEqual([r["startFrame"] for r in segments], [0, 24000, 64800])
        self.assertEqual([r["pauseBeforeFrames"] for r in segments], [0, 0, 16800])
        self.assertEqual(len(audio), 76800)
        np.testing.assert_array_equal(audio[48000:64800], 0)
        self.assertIn("00:00:00,500 --> 00:00:01,000", srt)
        self.assertIn("00:00:01,350 --> 00:00:01,600", srt)

    def test_uniform_rates_24_441_48_and_mp3_encoder(self):
        item = self.add(self.tone(32000, .15), rate=32000)
        for rate in (24000, 44100, 48000):
            with self.subTest(rate=rate):
                result = self.build([item], {"sampleRate": rate, "includeSegments": False})
                report, manifest, audio, got_rate, _ = self.read(result)
                self.assertEqual(got_rate, rate)
                self.assertEqual(len(audio), round(.15 * rate))
                self.assertIsNone(manifest["segments"][0]["originalWav"])
                with zipfile.ZipFile(result["path"]) as z:
                    self.assertEqual(len(z.namelist()), 6)
                    self.assertEqual(sf.info(io.BytesIO(z.read("merged.mp3"))).samplerate, rate)
                self.assertEqual(report["settings"]["mp3BitRateKbps"], 160 if rate == 24000 else 192)

    def test_resampling_matches_whole_signal_across_block_boundaries(self):
        rng = np.random.default_rng(42)
        for original, target in ((8000, 48000), (44100, 48000), (48000, 44100), (192000, 24000), (11025, 48000)):
            with self.subTest(original=original, target=target):
                frames = 2 * delivery.BLOCK_FRAMES + 513
                samples = rng.normal(0, .02, frames) + self.tone(original, frames / original, .1, 1234)
                item = self.add(samples, rate=original, subtype="FLOAT")
                entries, _ = delivery._entries(self.studio, {"items": [item]})
                rendered = np.concatenate(list(delivery._resample_blocks(entries[0], target)))
                source, _ = sf.read(entries[0]["path"])
                divisor = math.gcd(original, target)
                expected = resample_poly(source, target // divisor, original // divisor)
                self.assertEqual(len(rendered), len(expected))
                np.testing.assert_allclose(rendered, expected, atol=1e-12, rtol=1e-12)

    def test_reads_are_bounded_and_never_whole_segment(self):
        item = self.add(self.tone(8000, 20), rate=8000)
        reads = []
        original = sf.SoundFile.read
        def checked(file, frames=-1, *args, **kwargs):
            reads.append(frames)
            self.assertGreater(frames, 0)
            self.assertLessEqual(frames, delivery.BLOCK_FRAMES * 2)
            return original(file, frames, *args, **kwargs)
        with patch.object(sf.SoundFile, "read", checked):
            self.build([item], {"includeSegments": False})
        self.assertGreater(len(reads), 15)

    def test_fixed_gain_normalization_does_not_flatten_waveform(self):
        source = self.tone(48000, .5, .06)
        source[12000:] *= 2
        item = self.add(source, rate=48000, subtype="FLOAT")
        result = self.build([item])
        report, _, output, _, _ = self.read(result)
        rms = np.sqrt(np.mean(source ** 2))
        gain = .1 / rms
        np.testing.assert_allclose(output, source * gain, atol=1.6 / 32768)
        self.assertAlmostEqual(report["segments"][0]["gainDb"], 20 * math.log10(gain), places=5)

    def test_gain_is_bounded_for_quiet_audio(self):
        item = self.add(self.tone(48000, .5, .01), rate=48000)
        report, _, audio, _, _ = self.read(self.build([item]))
        self.assertEqual(report["segments"][0]["gainDb"], 12.0)
        self.assertIn("GAIN_LIMITED", report["segments"][0]["warnings"])
        self.assertLess(np.max(np.abs(audio)), .041)

    def test_peak_limit_handles_resample_overshoot_and_original_clipping(self):
        signal = np.zeros(24000)
        signal[200:23900] = self.tone(24000, 23700/24000, .04)
        signal[5000:5003] = 1.2  # PCM writing clips; export cannot recover this.
        signal[8000:8003] = -1.2
        item = self.add(signal)
        before = (self.outputs / item["id"] / "voice.wav").read_bytes()
        report, _, audio, _, _ = self.read(self.build([item]))
        segment = report["segments"][0]
        self.assertGreaterEqual(segment["originalClippedSamples"], 6)
        self.assertIn("ORIGINAL_CLIPPING", segment["warnings"])
        self.assertIn("PEAK_LIMITED", segment["warnings"])
        self.assertLessEqual(np.max(np.abs(audio)), 10 ** (-1/20))
        self.assertIn("不能", report["notes"])
        self.assertEqual(before, (self.outputs / item["id"] / "voice.wav").read_bytes())

    def test_normalization_off_preserves_level_but_still_caps_peak(self):
        item = self.add(self.tone(48000, .2, .03), rate=48000)
        report, _, audio, _, _ = self.read(self.build([item], {"normalize": False}))
        self.assertEqual(report["segments"][0]["gainDb"], 0.0)
        self.assertAlmostEqual(np.max(np.abs(audio)), .03, delta=1 / 32768)
        loud = self.add(np.ones(9600), rate=48000)
        report, _, audio, _, _ = self.read(self.build([loud], {"normalize": False}))
        self.assertLessEqual(np.max(np.abs(audio)), 10 ** (-1/20))
        self.assertIn("PEAK_LIMITED", report["segments"][0]["warnings"])

    def test_conservative_trim_has_padding_cap_and_correct_srt_time(self):
        values = np.concatenate([np.zeros(24000), self.tone(24000, .5), np.zeros(24000)])
        a = self.add(values, lineId="a")
        b = self.add(values, lineId="b")
        result = self.build([a, b], {"trimSilence": True})
        report, _, audio, rate, srt = self.read(result)
        first, second = report["segments"]
        self.assertEqual(first["trimStartMs"], 880)
        self.assertEqual(first["trimEndMs"], 880)
        self.assertAlmostEqual(first["durationSeconds"], .74)
        self.assertAlmostEqual(second["startSeconds"], 1.09)
        self.assertIn("00:00:00,000 --> 00:00:00,740", srt)
        self.assertIn("00:00:01,090 --> 00:00:01,830", srt)
        self.assertEqual(len(audio), round(1.83 * rate))
        long_silence = self.add(np.concatenate([np.zeros(3*24000), self.tone(24000), np.zeros(3*24000)]))
        report, *_ = self.read(self.build([long_silence], {"trimSilence": True}))
        self.assertEqual(report["segments"][0]["trimStartMs"], 1500)
        self.assertEqual(report["segments"][0]["trimEndMs"], 1500)

    def test_silent_and_below_gate_are_not_amplified_or_deleted(self):
        a = self.add(np.zeros(24000))
        b = self.add(self.tone(24000, 1, .00001), subtype="FLOAT")
        report, _, audio, _, _ = self.read(self.build([a, b], {"trimSilence": True, "pauseMs": 0}))
        self.assertEqual(len(audio), 96000)
        first, second = report["segments"]
        self.assertIn("SILENT_AUDIO", first["warnings"])
        self.assertIn("NO_ACTIVE_AUDIO", second["warnings"])
        for segment in (first, second):
            self.assertEqual(segment["gainDb"], 0)
            self.assertEqual(segment["trimStartFrames"], 0)
            self.assertEqual(segment["trimEndFrames"], 0)

    def test_stereo_downmix_is_disclosed_including_phase_cancellation(self):
        tone = self.tone(24000)
        a = self.add(np.column_stack([tone, -tone]), subtype="FLOAT")
        report, _, audio, _, _ = self.read(self.build([a]))
        self.assertIn("STEREO_DOWNMIX", report["segments"][0]["warnings"])
        self.assertIn("SILENT_AUDIO", report["segments"][0]["warnings"])
        np.testing.assert_array_equal(audio, 0)

    def test_partial_scope_and_source_transcript_preserved(self):
        item = self.add(lineId="a", partIndex=0, partCount=1)
        self.history[0]["text"] = "真实音频\n\n原文。"
        item["text"] = "不能替换真实字幕"
        report, manifest, _, _, srt = self.read(self.build([item], partial=True, totalLines=3, exportedLines=1, skippedLines=2, scopeLabel="第二章"))
        self.assertTrue(report["scope"]["partial"])
        self.assertEqual(manifest["scope"]["skippedLines"], 2)
        self.assertIn("真实音频\n原文。", srt)
        self.assertNotIn(item["text"], srt)

    def test_duplicate_references_missing_parts_and_noncontiguous_parts_fail(self):
        a = self.add(lineId="line-a", partIndex=0, partCount=2)
        b = self.add(lineId="line-a", partIndex=1, partCount=2)
        c = self.add(lineId="line-b", partIndex=0, partCount=1)
        for items in ([a, a], [a], [b, a], [a, c, b], [dict(a, partCount=1)]):
            with self.subTest(items=items), self.assertRaises(ValueError):
                self.build(items)
            self.assert_clean()

    def test_invalid_settings_metadata_scope_and_token_fail_before_artifacts(self):
        item = self.add()
        changes = [{"settings": {"sampleRate": True}}, {"settings": {"sampleRate": 96000}}, {"settings": {"normalize": 1}},
                   {"settings": {"pauseMs": -1}}, {"settings": {"pauseMs": 3001}}, {"settings": {"includeOriginals": True}},
                   {"items": [dict(item, partIndex=True)]}, {"ids": ["b"*32]}, {"exportToken": "../escape"},
                   {"partial": True}, {"totalLines": True}, {"exportedLines": 2}, {"projectName": []}, {"projectId": "x"*129}]
        for changeset in changes:
            with self.subTest(changeset=changeset), self.assertRaises(ValueError):
                delivery.build_delivery(self.studio, {"items": [item], **changeset}, lambda *a, **kw: None)
            self.assert_clean()

    def test_path_traversal_missing_file_and_symlink_rejected(self):
        item = self.add()
        path = self.outputs / item["id"] / "voice.wav"
        original = path.read_bytes()
        self.history[0]["wav"] = "../voice.wav"
        with self.assertRaises(ValueError): self.build([item])
        self.history[0]["wav"] = "voice.wav"
        path.unlink()
        with self.assertRaises(ValueError): self.build([item])
        target = self.root / "outside.wav"
        target.write_bytes(original)
        path.symlink_to(target)
        with self.assertRaises(ValueError): self.build([item])
        path.unlink()
        self.assertEqual(target.read_bytes(), original)
        self.assert_clean()

    def test_truncated_wav_and_frame_remainder_rejected(self):
        item = self.add()
        path = self.outputs / item["id"] / "voice.wav"
        original = path.read_bytes()
        path.write_bytes(original[:-2])
        with self.assertRaisesRegex(ValueError, "不完整|无效"): self.build([item])
        broken = bytearray(original[:-1])
        struct.pack_into("<I", broken, 4, len(broken)-8)
        path.write_bytes(broken)
        with self.assertRaises(ValueError): self.build([item])
        self.assert_clean()

    def test_nonfinite_float_samples_are_rejected(self):
        signal = self.tone(24000)
        signal[1] = np.nan
        item = self.add(signal, subtype="FLOAT")
        with self.assertRaisesRegex(ValueError, "无效样本"):
            self.build([item])
        self.assert_clean()

    def test_oversized_segment_project_sources_count_and_disk_budget(self):
        item = self.add()
        for limit, value in (("MAX_SEGMENTS", 0), ("MAX_SEGMENT_SECONDS", .1), ("MAX_TOTAL_SECONDS", .1), ("MAX_SOURCE_BYTES", 1), ("MAX_WORKING_BYTES", 1)):
            with self.subTest(limit=limit), patch.object(delivery, limit, value), self.assertRaises(ValueError):
                self.build([item])
            self.assert_clean()
        with patch.object(delivery.shutil, "disk_usage", return_value=types.SimpleNamespace(free=1)), self.assertRaises(OSError):
            self.build([item])
        self.assert_clean()

    def test_sparse_huge_file_rejected_before_decoder_or_read(self):
        item = self.add()
        path = self.outputs / item["id"] / "voice.wav"
        with path.open("r+b") as output:
            output.truncate(delivery.MAX_SOURCE_BYTES + 1)
        with patch.object(sf, "SoundFile", side_effect=AssertionError("must not decode")), self.assertRaisesRegex(ValueError, "4GiB"):
            self.build([item])
        self.assert_clean()

    def test_disk_failure_and_cancellation_clean_only_owned_files(self):
        item = self.add()
        source = self.outputs / item["id"] / "voice.wav"
        before = source.read_bytes()
        sentinel = self.root / "user.zip"
        sentinel.write_bytes(b"keep")
        for error in (OSError("disk full"), KeyboardInterrupt("cancelled")):
            with self.subTest(error=type(error).__name__), patch.object(zipfile.ZipFile, "write", side_effect=error), self.assertRaises(type(error)):
                self.build([item])
            self.assert_clean()
            self.assertEqual(source.read_bytes(), before)
            self.assertEqual(sentinel.read_bytes(), b"keep")
        def cancel(*args, **kwargs):
            raise KeyboardInterrupt("cancelled")
        with self.assertRaises(KeyboardInterrupt):
            delivery.build_delivery(self.studio, {"items": [item]}, cancel)
        self.assert_clean()

    def test_scratch_write_failure_cleans_and_does_not_mutate_sources(self):
        item = self.add()
        path = self.outputs / item["id"] / "voice.wav"
        before = path.read_bytes()
        with patch.object(sf.SoundFile, "write", side_effect=OSError("disk full")), self.assertRaises(OSError):
            self.build([item])
        self.assert_clean()
        self.assertEqual(path.read_bytes(), before)

    def test_existing_token_directories_and_unrelated_files_never_removed(self):
        item = self.add()
        token = "f"*32
        for directory in (".export-work", ".export-tmp"):
            folder = self.root / directory / ("voice-export-" + token)
            folder.mkdir(parents=True)
            (folder / "owner.json").write_bytes(b"existing")
            with self.assertRaises(FileExistsError):
                self.build([item], exportToken=token)
            self.assertEqual((folder / "owner.json").read_bytes(), b"existing")
            (folder / "owner.json").unlink()
            folder.rmdir()
        self.assert_clean()

    def test_symlink_temporary_root_rejected(self):
        item = self.add()
        other = self.root / "other"
        other.mkdir()
        (self.root / ".export-work").symlink_to(other, target_is_directory=True)
        with self.assertRaises(ValueError): self.build([item])
        self.assertEqual(list(other.iterdir()), [])

    def test_source_changed_during_render_aborts_instead_of_exporting_mismatch(self):
        item = self.add()
        path = self.outputs / item["id"] / "voice.wav"
        def change(*args, **kwargs):
            if kwargs.get("phase") == "render":
                path.touch()
        with self.assertRaisesRegex(ValueError, "已变化"):
            delivery.build_delivery(self.studio, {"items": [item]}, change)
        self.assert_clean()


if __name__ == "__main__":
    unittest.main()
