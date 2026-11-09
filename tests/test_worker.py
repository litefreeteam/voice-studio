import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import base64
import sys
import subprocess
import shutil
import uuid
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

spec = importlib.util.spec_from_file_location("worker", Path(__file__).parents[1] / "backend" / "worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class TextIntegrityTests(unittest.TestCase):
    def test_split_rows_survive_json_validation_and_utf8_encoding(self):
        root = Path(__file__).parents[1]
        script = """const {prepareGeneration} = require('./desktop/jobs.cjs');
const texts = ['甲'.repeat(599)+'𠮷野家很好。', '甲'.repeat(595)+'hello world，结尾保留。', 'hello world. '.repeat(100)];
console.log(JSON.stringify(texts.map(text => ({text, rows: prepareGeneration({text}).rows}))));"""
        cases = json.loads(subprocess.check_output(['node', '-e', script], cwd=root))
        for case in cases:
            actual = []
            for row in case['rows']:
                lines, *_ = worker.validate_request(row)
                self.assertEqual(lines, [row['text']])
                self.assertLessEqual(len(lines[0]), 600)
                self.assertEqual(lines[0].encode('utf-8').decode('utf-8'), lines[0])
                actual.extend(lines)
            self.assertEqual(''.join(actual), case['text'])

    def test_unpaired_surrogates_fail_before_model_or_protocol_encoding(self):
        for text in ['\ud842', '\udfb7', 'hello\ud842world']:
            with self.assertRaisesRegex(ValueError, 'Unicode'):
                worker.validate_request({'text': text})


def initialize_test_identity(root):
    # The desktop creates this identifier before starting the worker on development
    # platforms. Keep license verification real, including in isolated subprocesses.
    # macOS and Windows still use their native device identity in production code.
    (Path(root) / "installation-id").write_text(str(uuid.uuid4()), encoding="utf-8")


class ResourceVerificationTests(unittest.TestCase):
    def test_current_resource_status_requires_the_entire_pinned_file_list(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(worker, "require_license"):
            studio = worker.Studio(directory)
            folder, repo, _ = studio.model_info("character")
            folder.mkdir(parents=True)
            pinned = {"revision": "current", "weights": {"model.bin": "fixed"},
                      "files": {"model.bin": {"size": 10}, "config.json": {"size": 2}}}
            (folder / "model.bin").write_bytes(b"0" * 10)
            (folder / "config.json").write_bytes(b"{}")
            marker = {"repo": repo, "revision": "current", "weights": pinned["weights"], "files": {"model.bin": 10}}
            def status():
                (folder / ".complete.json").write_text(json.dumps(marker))
                return next(pack for pack in studio.status()["packages"] if pack["id"] == "character")
            with patch.dict(worker.MODEL_MANIFEST, {repo: pinned}):
                self.assertTrue(status()["ready"])
                self.assertFalse(status()["verified"], "a legacy partial marker cannot qualify as complete resources")
                marker["files"]["config.json"] = 2
                self.assertTrue(status()["verified"])
                marker["revision"] = "old"
                self.assertFalse(status()["verified"])
                marker["revision"] = "current"
                marker["files"] = []
                self.assertFalse(status()["verified"], "malformed metadata should report missing verification instead of crashing status")


class RequestTests(unittest.TestCase):
    def test_rejects_unsafe_names_and_oversized_inputs(self):
        for data in [{"prefix": "../escape"}, {"speaker": "bogus"}, {"text": "x" * 601},
                     {"sampleRate": 8000}, {"instruction": "x" * 501},
                     {"text": "a\n" * 101, "batch": True}]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                worker.validate_request({"text": "你好", **data})

    def test_batch_ignores_empty_lines_and_preserves_punctuation(self):
        result = worker.validate_request({"text": "救救我们！\n\n 我跟着你！ ", "batch": True})
        self.assertEqual(result[0], ["救救我们！", "我跟着你！"])


class LicenseBoundaryTests(unittest.TestCase):
    def setUp(self):
        edition = patch.object(worker, "ACTIVATION_REQUIRED", True)
        edition.start()
        self.addCleanup(edition.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        initialize_test_identity(self.root)
        self.studio = worker.Studio(self.root)
        self.key = Ed25519PrivateKey.generate()
        self.anchor = patch.object(worker, "PUBLIC_KEY_PEM", self.key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo))
        self.anchor.start()
        self.addCleanup(self.anchor.stop)

    def code(self, machine=None, key=None):
        message = f"shengyue:offline:pro:perpetual:v2:{machine or worker.machine_code(self.root)}".encode()
        return "SY2." + base64.urlsafe_b64encode((key or self.key).sign(message)).decode().rstrip("=")

    def test_all_paid_methods_reject_before_loading_models_or_reading_customer_files(self):
        self.studio.load = lambda *args: self.fail("unauthorized request must not load models")
        for action in (lambda: self.studio.generate({"text": "blocked"}),
                       lambda: self.studio.prepare_voice({}),
                       lambda: self.studio.import_reference({"path": "/missing.wav"}),
                       lambda: self.studio.capture_reference({"id": "unknown"}),
                       lambda: self.studio.export_zip({"ids": ["unknown"]}),
                       lambda: self.studio.synthesize("blocked", "Vivian", "")):
            with self.assertRaises(worker.LicenseRequiredError):
                action()

    def test_valid_signature_persists_but_wrong_machine_key_tampering_and_deletion_fail_closed(self):
        valid = self.code()
        file = self.root / "license.txt"
        for invalid in (self.code(machine="OTHER"), self.code(key=Ed25519PrivateKey.generate()),
                        "SY2." + "A" * 86, valid + "=", "SY1.old.old", "x" * 513):
            file.write_text(invalid)
            with self.assertRaises(worker.LicenseRequiredError):
                worker.require_license(self.root)
        file.write_text(" \n" + valid + "\t")
        worker.require_license(self.root)
        file.unlink()
        with self.assertRaises(worker.LicenseRequiredError):
            worker.require_license(self.root)

    def test_development_identity_change_or_loss_does_not_bypass_signature_verification(self):
        identity = self.root / "installation-id"
        original = identity.read_text(encoding="utf-8")
        # Exercise the development-only identity contract on every test host;
        # supported OS paths still use real native identities in the other tests.
        with patch.object(worker.sys, "platform", "linux"):
            (self.root / "license.txt").write_text(self.code(), encoding="utf-8")
            worker.require_license(self.root)
            identity.write_text(str(uuid.uuid4()), encoding="utf-8")
            with self.assertRaises(worker.LicenseRequiredError):
                worker.require_license(self.root)
            identity.unlink()
            with self.assertRaises(worker.LicenseRequiredError):
                worker.require_license(self.root)
            self.assertFalse(identity.exists(), "worker must not silently replace a missing identity")
            identity.write_text(original, encoding="utf-8")
            worker.require_license(self.root)

    def test_free_stdio_worker_reaches_operations_without_activation(self):
        requests = [{"id": index, "op": operation, "data": {"text": "blocked", "ids": ["a" * 32], "path": "/missing.wav"}}
                    for index, operation in enumerate(("generate", "zip", "reference", "capture"))]
        result = subprocess.run([sys.executable, "-I", str(Path(worker.__file__)), "--data-dir", str(self.root)],
                                input="".join(json.dumps(request) + "\n" for request in requests),
                                capture_output=True, text=True, timeout=20, check=True)
        errors = [json.loads(line) for line in result.stdout.splitlines() if json.loads(line)["type"] == "error"]
        self.assertEqual(len(errors), 4)
        self.assertTrue(all(error["code"] != "LICENSE_REQUIRED" for error in errors))
        self.assertFalse(self.studio.history_file.exists())
        self.assertEqual(list(self.studio.outputs.iterdir()), [])

    def test_license_removed_during_inference_prevents_saving_audio(self):
        (self.root / "license.txt").write_text(self.code())
        self.studio.load = lambda *args: None
        def removed(*args):
            (self.root / "license.txt").unlink()
            import numpy as np
            return np.ones(2400, dtype=np.float32), 24000
        self.studio.synthesize = removed
        with self.assertRaises(worker.LicenseRequiredError):
            self.studio.generate({"text": "must not be saved"})
        self.assertEqual(list(self.studio.outputs.iterdir()), [])


class ExportTests(unittest.TestCase):
    def test_reference_name_and_note_updates_preserve_audio_identity_and_transcript(self):
        reference_id = "a" * 32
        reference = {"id": reference_id, "name": "旧名字", "text": "不能被改名覆盖的原话", "duration": 4, "textUpdatedAt": 123}
        self.studio.list_references = lambda: [reference]
        updated = self.studio.update_reference({"id": reference_id, "name": " 房产介绍 ", "note": "温暖女声"})
        self.assertEqual(updated["name"], "房产介绍")
        self.assertEqual(updated["text"], reference["text"])
        self.assertEqual(updated["textUpdatedAt"], 123)
        self.assertEqual(updated["id"], reference_id)
        self.assertEqual(json.loads((self.studio.references / (reference_id + ".json")).read_text()), updated)
        for fields in ({"name": " "}, {"note": "长" * 241}, {"name": 3}, {"text": None}):
            with self.assertRaises(ValueError):
                self.studio.update_reference({"id": reference_id, **fields})

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        initialize_test_identity(self.temp.name)
        self.studio = worker.Studio(self.temp.name)
        self.key = Ed25519PrivateKey.generate()
        self.anchor = patch.object(worker, "PUBLIC_KEY_PEM", self.key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo))
        self.anchor.start()
        self.addCleanup(self.anchor.stop)
        message = f"shengyue:offline:pro:perpetual:v2:{worker.machine_code(self.temp.name)}".encode()
        code = "SY2." + base64.urlsafe_b64encode(self.key.sign(message)).decode().rstrip("=")
        (Path(self.temp.name) / "license.txt").write_text(code)

    def test_diagnostic_ignores_custom_text_and_preserves_history(self):
        import numpy as np
        calls = []
        self.studio.load = lambda key: calls.append(key)
        def synthesize(text, *args):
            calls.append(text)
            return np.ones(24000, dtype=np.float32) * .1, 24000
        self.studio._synthesize_with_fallback = synthesize
        result = self.studio.diagnose({"package": "light", "text": "cannot generate arbitrary text"})
        self.assertTrue(result["passed"])
        self.assertEqual(calls, ["light", "你好，欢迎使用声悦。"])
        self.assertFalse(self.studio.history_file.exists())
        self.assertTrue((self.studio.root / "preflight/light.mp3").is_file())
        with self.assertRaises(ValueError):
            self.studio.diagnose({"package": "../escape"})

    def test_asset_directory_keeps_models_separate_from_customer_works(self):
        assets = self.studio.root / "other-disk"
        studio = worker.Studio(self.temp.name, assets)
        self.assertEqual(studio.model_info("light")[0], assets / "models/voice-light")
        self.assertEqual(studio.outputs, self.studio.root / "outputs")

    def test_partial_model_download_is_not_ready(self):
        self.studio.model_dir.mkdir(parents=True)
        (self.studio.model_dir / "weights.safetensors").write_bytes(b"incomplete")
        self.assertFalse(self.studio.status()["modelReady"])
        marker = {"repo": self.studio.model_id, "files": {"weights.safetensors": 99}}
        (self.studio.model_dir / ".complete.json").write_text(json.dumps(marker))
        self.assertFalse(self.studio.status()["modelReady"])

    def test_real_wav_mp3_encoding_and_duplicate_zip_names(self):
        import numpy as np
        import soundfile as sf
        # Test the export pipeline without spending another model inference.
        self.studio.load = lambda *args: None
        samples = (0.2 * np.sin(2 * np.pi * 440 * np.arange(24000) / 24000)).astype(np.float32)
        self.studio.synthesize = lambda *args: (samples, 24000)
        first = self.studio.generate({"text": "你好", "sampleRate": 48000})["items"][0]
        second = self.studio.generate({"text": "谢谢", "sampleRate": 44100})["items"][0]
        for item in [first, second]:
            folder = self.studio.outputs / item["id"]
            info = sf.info(folder / item["wav"])
            self.assertEqual(info.channels, 1)
            self.assertEqual(info.subtype, "PCM_16")
            self.assertEqual(info.samplerate, item["sampleRate"])
            self.assertAlmostEqual(info.duration, 1, places=3)
            decoded, _ = sf.read(folder / item["wav"])
            self.assertLess(abs(float(np.max(decoded)) - .2), .005)
            self.assertGreater((folder / item["mp3"]).stat().st_size, 1000)
        exported = self.studio.export_zip({"ids": [first["id"], second["id"]]})
        with zipfile.ZipFile(exported["path"]) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(len(archive.namelist()), 3)
            self.assertEqual(len(set(archive.namelist())), 3)
            self.assertEqual(len(json.loads(archive.read("manifest.json"))), 2)
        self.assertEqual(len(self.studio.history()), 2)

    def test_mixed_script_routes_packages_and_preserves_names(self):
        import numpy as np
        calls = []
        self.studio.load = lambda key: calls.append(key)
        self.studio.synthesize = lambda *args: (np.ones(24000, dtype=np.float32) * .1, 24000)
        result = self.studio.generate({"rows": [
            {"text": "你好", "speaker": "Uncle_Fu", "filename": "help-male-1", "emotion": "afraid"},
            {"text": "我们在这里", "mode": "design", "character": "girl-clear", "lockVoice": False, "filename": "help-female-1"}]})
        self.assertEqual(calls, ["standard", "character"])
        self.assertEqual([i["wav"] for i in result["items"]], ["help-male-1.wav", "help-female-1.wav"])
        calls.clear()
        with self.assertRaises(ValueError):
            self.studio.generate({"rows": [{"text": "合法"}, {"text": "非法", "filename": "../escape"}]})
        self.assertEqual(calls, [])

    def test_preset_style_keeps_user_controls_and_stays_out_of_other_voices_and_modes(self):
        import numpy as np
        calls = []
        self.studio.load = lambda key: None
        self.studio.list_references = lambda: [{"id": "a" * 32, "text": "参考声音的原话"}]

        def synthesize(text, speaker, instruction, options):
            calls.append(instruction)
            return np.ones(2400, dtype=np.float32) * .1, 24000

        self.studio.synthesize = synthesize
        self.studio.generate({"rows": [
            {"text": "自然表达", "speaker": "Vivian"},
            {"text": "自定义表演", "speaker": "Vivian", "instruction": "像刚收到好消息一样。",
             "emotion": "happy", "scene": "ad", "pace": "fast", "intensity": 80},
            {"text": "另一个声音", "speaker": "Serena"},
            {"text": "轻量配音", "speaker": "Vivian", "engine": "light"},
            {"text": "人物设计", "mode": "design", "character": "girl-clear", "lockVoice": False},
            {"text": "参考声音", "mode": "clone", "referenceId": "a" * 32},
        ]})
        style = next(v for v in worker.CATALOG["voices"] if v["id"] == "Vivian")["stylePrompt"]
        self.assertEqual(style, calls[0], "neutral defaults must not stack redundant performance instructions")
        for expected in [style, "像刚收到好消息一样。", "开心、轻快", "像真诚推荐", "语速稍快", "情绪表达鲜明"]:
            self.assertIn(expected, calls[1])
        self.assertTrue(calls[1].endswith("像刚收到好消息一样。"), "explicit user direction refines the built-in style")
        self.assertTrue(all(style not in instruction for instruction in calls[2:]))
        self.assertEqual(calls[3], "")
        self.assertEqual(calls[5], "")

    def test_progress_marks_a_clip_complete_only_after_files_and_history_exist(self):
        import numpy as np
        self.studio.load = lambda key: None
        self.studio.synthesize = lambda *args: (np.ones(2400, dtype=np.float32) * .1, 24000)
        events = []

        def record(kind, **event):
            self.assertEqual(kind, "progress")
            events.append(event)
            if event["stage"] == "clip":
                item = event["item"]
                for name in [item["wav"], item["mp3"], "metadata.json"]:
                    self.assertTrue((self.studio.outputs / item["id"] / name).is_file())
                self.assertIn(item["id"], [saved["id"] for saved in self.studio.history()])

        with patch.object(worker, "emit", record):
            self.studio.generate({"text": "第一段\n第二段", "batch": True})
        self.assertEqual([event["stage"] for event in events], ["generating", "encoding", "clip"] * 2)
        self.assertEqual([(event["current"], event["total"]) for event in events if event["stage"] == "encoding"], [(1, 2), (2, 2)])

    def test_modes_reject_unsupported_controls_and_silent_reference(self):
        import numpy as np
        import soundfile as sf
        for request in [{"engine": "light", "emotion": "sad"}, {"mode": "design"},
                        {"mode": "clone", "referenceId": "unknown"}, {"language": "bogus"},
                        {"intensity": 101}, {"pace": "bogus"}]:
            with self.subTest(request=request), self.assertRaises(ValueError):
                self.studio.generate({"text": "你好", **request})
        silent = Path(self.temp.name) / "silent.wav"
        sf.write(silent, np.zeros(4 * 24000), 24000)
        with self.assertRaises(ValueError):
            self.studio.import_reference({"path": str(silent)})

    def test_zip_rejects_unknown_id_or_format(self):
        for data in [{"ids": ["../escape"]}, {"ids": []}, {"ids": ["abc"], "format": "exe"}]:
            with self.assertRaises(ValueError):
                self.studio.export_zip(data)

    def mock_locked_voice(self, studio=None):
        import numpy as np
        studio = studio or self.studio
        calls = []
        studio.model_ready = lambda key: True
        studio.load = lambda key: calls.append(("load", key))
        def synthesize(text, speaker, instruction, options):
            calls.append((options["mode"], text, instruction, dict(options)))
            return np.full(4 * 24000, .1, dtype=np.float32), 24000
        studio.synthesize = synthesize
        return calls

    def locked_options(self, **overrides):
        return {"mode": "design", "character": "meditation-female", "projectId": "meditation",
                "roleId": "jinghe", "voiceName": "静禾", "language": "Chinese", **overrides}

    def test_curated_voice_setup_copies_the_audition_and_clones_new_text_after_restart(self):
        import numpy as np
        import soundfile as sf
        for character in ("boy-clear", "girl-clear", "boy-soft", "girl-soft", "youth-male", "clear-female", "warm-female"):
            with self.subTest(character=character):
                calls = self.mock_locked_voice()
                voice = next(v for v in worker.CATALOG["characters"] if v["id"] == character)
                options = {"mode": "design", "character": character, "voiceScopeId": "curated-test"}
                prepared = self.studio.prepare_voice(options)
                self.assertEqual(calls, [], "curated voices must never be randomly redesigned")
                source, rate = sf.read(Path(worker.__file__).with_name(voice["reference"]["file"]), dtype="float32")
                anchor = self.studio.voice_anchors / (prepared["voiceAnchorId"] + ".wav")
                copied, anchor_rate = sf.read(anchor, dtype="float32")
                self.assertEqual(rate, anchor_rate)
                np.testing.assert_allclose(copied, source, atol=1 / 32768)
                self.assertEqual(prepared["text"], voice["reference"]["text"])
                restarted = worker.Studio(self.temp.name)
                calls = self.mock_locked_voice(restarted)
                item = restarted.generate({**options, "text": "新的文案也要保持这个声音。"})["items"][0]
                self.assertEqual(item["voiceAnchorId"], prepared["voiceAnchorId"])
                self.assertEqual([call[0] for call in calls], ["load", "clone"])
                self.assertEqual(calls[-1][3]["refText"], voice["reference"]["text"])

    def test_curated_voice_keeps_existing_anchors_and_allows_custom_descriptions(self):
        calls = self.mock_locked_voice()
        options = {"mode": "design", "character": "boy-clear", "voiceScopeId": "legacy"}
        with patch.object(self.studio, "bundled_voice_sample", return_value=None):
            old = self.studio.prepare_voice(options)
        calls.clear()
        with patch.object(self.studio, "bundled_voice_sample", side_effect=AssertionError("existing voice must win")):
            self.assertEqual(self.studio.prepare_voice(options)["voiceAnchorId"], old["voiceAnchorId"])
        self.assertEqual(calls, [])
        for override in ({"voiceDescription": "自定义成年男性声线"}, {"language": "English"}):
            calls.clear()
            self.studio.prepare_voice({**options, "voiceScopeId": str(override), **override})
            self.assertEqual([call[0] for call in calls], ["load", "design"])
        calls.clear()
        self.studio.generate({**options, "lockVoice": False, "text": "自由设计"})
        self.assertEqual([call[0] for call in calls], ["load", "design"])

    def test_corrupt_or_unsafe_curated_samples_never_fall_back_to_random_design(self):
        for change in ({"sha256": "0" * 64}, {"file": "../outside.mp3"}, {"file": "voice-missing.mp3"}):
            catalog = json.loads(json.dumps(worker.CATALOG))
            voice = next(v for v in catalog["characters"] if v["id"] == "boy-clear")
            voice["reference"].update(change)
            calls = self.mock_locked_voice()
            with self.subTest(change=change), patch.object(worker, "CATALOG", catalog):
                with self.assertRaisesRegex(RuntimeError, "样本缺失或损坏"):
                    self.studio.prepare_voice({"mode": "design", "character": "boy-clear"})
            self.assertEqual(calls, [])

    def test_role_setup_fixes_voice_before_any_lines_and_does_not_create_works(self):
        calls = self.mock_locked_voice()
        options = self.locked_options()
        prepared = self.studio.prepare_voice(options)
        self.assertGreater(len(base64.b64decode(prepared["audio"])), 1000)
        self.assertFalse(self.studio.history_file.exists())
        self.assertEqual(list(self.studio.outputs.iterdir()), [])
        self.assertEqual([call[0] for call in calls], ["load", "design"])
        calls.clear()
        self.assertEqual(self.studio.prepare_voice(options)["voiceAnchorId"], prepared["voiceAnchorId"])
        self.assertEqual(calls, [], "preview reuses the chosen voice without redesigning it")
        result = self.studio.generate({**options, "text": "第一句\n第二句\n第三句", "batch": True})
        self.assertEqual({item["voiceAnchorId"] for item in result["items"]}, {prepared["voiceAnchorId"]})
        self.assertTrue(all(item["synthesisMode"] == "clone" for item in result["items"]))
        self.assertEqual([call[0] for call in calls].count("design"), 0)
        self.assertTrue(all(call[2] == "" for call in calls if call[0] == "clone"))

    def test_first_successful_line_is_persistent_fallback_across_batches_restarts_and_deletion(self):
        calls = self.mock_locked_voice()
        first = self.studio.generate({**self.locked_options(), "text": "首句定声"})["items"][0]
        self.assertEqual(first["synthesisMode"], "design")
        shutil.rmtree(self.studio.outputs / first["id"])
        restarted = worker.Studio(self.temp.name)
        calls = self.mock_locked_voice(restarted)
        second = restarted.generate({**self.locked_options(voiceName="改名", project="改名项目"), "text": "下一批"})["items"][0]
        self.assertEqual(second["voiceAnchorId"], first["voiceAnchorId"])
        self.assertEqual([call[0] for call in calls], ["load", "clone"])
        self.assertEqual(second["synthesisMode"], "clone")

    def test_voice_identity_is_isolated_and_reset_or_description_changes_create_new_voice(self):
        self.mock_locked_voice()
        base = self.studio.prepare_voice(self.locked_options())["voiceAnchorId"]
        for change in ({"projectId": "other"}, {"roleId": "other"}, {"voiceRevision": "new"},
                       {"voiceDescription": "中年男性温暖的声音"}, {"emotion": "sad"}):
            with self.subTest(change=change):
                self.assertNotEqual(self.studio.prepare_voice(self.locked_options(**change))["voiceAnchorId"], base)
        calls = self.mock_locked_voice()
        self.studio.generate({**self.locked_options(lockVoice=False), "text": "第一句\n第二句", "batch": True})
        self.assertEqual([call[0] for call in calls].count("design"), 2)

    def test_short_or_long_first_line_uses_complete_reference_and_resynthesizes_the_line(self):
        import numpy as np
        for duration in (1, 31):
            with self.subTest(duration=duration):
                self.mock_locked_voice()
                calls = []
                def synthesize(text, speaker, instruction, options):
                    calls.append((text, options["mode"]))
                    seconds = duration if len(calls) == 1 else 4
                    return np.full(seconds * 24000, .1, dtype=np.float32), 24000
                self.studio.synthesize = synthesize
                result = self.studio.generate({**self.locked_options(roleId=str(duration)), "text": "好"})["items"][0]
                self.assertEqual(calls, [("好", "design"), (worker.ANCHOR_TEXT["Chinese"], "design"), ("好", "clone")])
                self.assertEqual(result["text"], "好")

    def test_missing_package_or_invalid_audio_does_not_silently_redesign_or_fix_bad_voice(self):
        import numpy as np
        calls = self.mock_locked_voice()
        self.studio.model_ready = lambda key: key != "reference"
        with self.assertRaisesRegex(RuntimeError, "我的专属声音"):
            self.studio.prepare_voice(self.locked_options())
        self.assertEqual(calls, [])
        self.mock_locked_voice()
        self.studio.synthesize = lambda *args: (np.zeros(4 * 24000, dtype=np.float32), 24000)
        with self.assertRaisesRegex(RuntimeError, "有效人声"):
            self.studio.prepare_voice(self.locked_options())
        self.assertFalse(self.studio.voice_anchors.exists())

    def test_damaged_anchor_requires_explicit_reset(self):
        self.mock_locked_voice()
        prepared = self.studio.prepare_voice(self.locked_options())
        recording = self.studio.voice_anchors / (prepared["voiceAnchorId"] + ".wav")
        recording.write_bytes(b"broken")
        with self.assertRaisesRegex(RuntimeError, "重新定声"):
            self.studio.generate({**self.locked_options(), "text": "继续"})

    def test_all_design_entry_points_fix_voice_before_customer_lines_and_redo(self):
        calls = self.mock_locked_voice()
        options = {"mode": "design", "character": "meditation-female", "voiceScopeId": "quick", "voiceId": "narrator"}
        result = self.studio.generate({**options, "rows": [
            {"text": "第一句", "emotion": "natural"}, {"text": "第二句", "emotion": "gentle"},
            {"text": "第三句", "instruction": "更加坚定"}]})
        spoken = [call for call in calls if call[0] != "load"]
        self.assertEqual([call[0] for call in spoken], ["design", "clone", "clone", "clone"])
        self.assertEqual(spoken[0][1], worker.ANCHOR_TEXT["Chinese"])
        self.assertEqual(len({call[3]["refPath"] for call in spoken[1:]}), 1)
        anchor = result["items"][0]["voiceAnchorId"]
        self.assertTrue(all(item["synthesisMode"] == "clone" and item["voiceAnchorId"] == anchor
                            and item["options"]["voiceAnchorId"] == anchor for item in result["items"]))
        restarted = worker.Studio(self.temp.name)
        calls = self.mock_locked_voice(restarted)
        redo = restarted.generate({**result["items"][1]["options"], "text": "修改了台词", "project": "改名作品", "filename": "重做"})["items"][0]
        self.assertEqual(redo["voiceAnchorId"], anchor)
        self.assertEqual([call[0] for call in calls], ["load", "clone"])

    def test_failed_line_and_failed_first_clone_resume_with_the_original_voice_after_restart(self):
        import numpy as np
        for failure in ("第一句", "第二句"):
            with self.subTest(failure=failure):
                options = {"mode": "design", "character": "meditation-female", "voiceScopeId": failure}
                calls = self.mock_locked_voice()
                original = self.studio.synthesize
                def fail_once(text, *args):
                    if text == failure:
                        raise RuntimeError("模拟生成中断")
                    return original(text, *args)
                self.studio.synthesize = fail_once
                with self.assertRaisesRegex(RuntimeError, "模拟生成中断"):
                    self.studio.generate({**options, "text": "第一句\n第二句\n第三句", "batch": True})
                design = next(call for call in calls if call[0] == "design")
                anchor = worker.voice_anchor_key(design[3], design[2])
                self.assertTrue((self.studio.voice_anchors / (anchor + ".wav")).is_file())
                restarted = worker.Studio(self.temp.name)
                calls = self.mock_locked_voice(restarted)
                items = restarted.generate({**options, "text": failure + "\n第三句", "batch": True})["items"]
                self.assertTrue(all(item["voiceAnchorId"] == anchor and item["synthesisMode"] == "clone" for item in items))
                self.assertNotIn("design", [call[0] for call in calls])

    def test_default_cli_voice_scope_is_persistent_and_explicit_identities_are_isolated(self):
        self.mock_locked_voice()
        options = {"mode": "design", "character": "meditation-female"}
        first = self.studio.prepare_voice(options)["voiceAnchorId"]
        self.assertEqual(self.studio.prepare_voice({**options, "emotion": "sad", "instruction": "不同的逐句指令", "project": "改名"})["voiceAnchorId"], first)
        for change in ({"voiceScopeId": "other"}, {"voiceId": "other"}, {"voiceRevision": "new"},
                       {"voiceDescription": "成年男性清晰温暖的声音"}):
            self.assertNotEqual(self.studio.prepare_voice({**options, **change})["voiceAnchorId"], first)
        restarted = worker.Studio(self.temp.name)
        calls = self.mock_locked_voice(restarted)
        self.assertEqual(restarted.prepare_voice(options)["voiceAnchorId"], first)
        self.assertEqual(calls, [])

    def test_fixed_voice_never_silently_redesigns_missing_or_mismatched_pinned_samples(self):
        calls = self.mock_locked_voice()
        options = {"mode": "design", "character": "meditation-female", "voiceScopeId": "pinned"}
        prepared = self.studio.prepare_voice(options)
        calls.clear()
        pinned = {**options, "voiceAnchorId": prepared["voiceAnchorId"], "text": "继续"}
        with self.assertRaisesRegex(ValueError, "不匹配"):
            self.studio.generate({**pinned, "voiceRevision": "changed"})
        (self.studio.voice_anchors / (prepared["voiceAnchorId"] + ".json")).unlink()
        with self.assertRaisesRegex(RuntimeError, "缺失"):
            self.studio.generate(pinned)
        with self.assertRaisesRegex(RuntimeError, "不完整"):
            self.studio.generate({**options, "text": "队列续做也不能静默换声"})
        self.assertEqual(calls, [])

    def test_design_defaults_require_reference_package_before_any_generation_and_validate_identity(self):
        calls = self.mock_locked_voice()
        self.studio.model_ready = lambda key: key != "reference"
        for options in ({}, {"voiceScopeId": "quick"}, {"voiceScopeId": "lab:work", "voiceId": "role"}):
            with self.assertRaisesRegex(RuntimeError, "我的专属声音"):
                self.studio.generate({"mode": "design", "character": "meditation-female", "text": "不能静默自由设计", **options})
        self.assertEqual(calls, [])
        self.mock_locked_voice()
        for field, invalid in (("voiceScopeId", "x" * 65), ("voiceId", []), ("voiceRevision", False), ("voiceAnchorId", "../escape")):
            with self.assertRaises(ValueError):
                self.studio.generate({"mode": "design", "character": "meditation-female", "text": "无效输入", field: invalid})

    def test_fixed_voice_reaches_the_mlx_and_torch_clone_apis_with_the_same_reference(self):
        import numpy as np
        from types import SimpleNamespace
        audio = np.full(4 * 24000, .1, dtype=np.float32)
        for is_mlx in (True, False):
            with self.subTest(is_mlx=is_mlx):
                calls = []
                def design(**kwargs):
                    calls.append(("design", kwargs))
                    return iter([SimpleNamespace(audio=audio, sample_rate=24000)]) if is_mlx else ([audio], 24000)
                def clone(**kwargs):
                    calls.append(("clone", kwargs))
                    return iter([SimpleNamespace(audio=audio, sample_rate=24000)]) if is_mlx else ([audio], 24000)
                self.studio.is_mlx = is_mlx
                self.studio.model = SimpleNamespace(generate_voice_design=design, generate=clone, generate_voice_clone=clone)
                self.studio.model_ready = lambda key: True
                self.studio.load = lambda key: None
                items = self.studio.generate({"mode": "design", "character": "meditation-female", "voiceScopeId": str(is_mlx),
                                              "text": "第一句\n第二句", "batch": True})["items"]
                self.assertEqual([mode for mode, _ in calls], ["design", "clone", "clone"])
                self.assertEqual(calls[1][1]["ref_audio"], calls[2][1]["ref_audio"])
                self.assertEqual(calls[1][1]["ref_text"], worker.ANCHOR_TEXT["Chinese"])
                self.assertEqual(items[0]["voiceAnchorId"], items[1]["voiceAnchorId"])


if __name__ == "__main__":
    unittest.main()
