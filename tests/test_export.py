"""Export/reference regression fixtures use private temp directories and a test key."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile
from unittest.mock import patch
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

spec = importlib.util.spec_from_file_location("export_worker", Path(__file__).parents[1] / "backend" / "worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class ExportRegressionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="shengyue-export-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "installation-id").write_text("isolated-export-fixture")
        self.studio = worker.Studio(self.root)
        key = Ed25519PrivateKey.generate()
        anchor = patch.object(worker, "PUBLIC_KEY_PEM", key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo))
        anchor.start()
        self.addCleanup(anchor.stop)
        message = f"shengyue:offline:pro:perpetual:v2:{worker.machine_code(self.root)}".encode()
        (self.root / "license.txt").write_text("SY2." + base64.urlsafe_b64encode(key.sign(message)).decode().rstrip("="))

    def fixtures(self, names, ids=None):
        items = []
        for index, name in enumerate(names):
            item = {"id": ids[index] if ids else f"{index + 1:032x}", "wav": name + ".wav", "mp3": name + ".mp3", "text": f"content-{index}",
                    "options": {"projectId": "original-project", "lineOrder": index}}
            folder = self.studio.outputs / item["id"]
            folder.mkdir()
            for fmt in ("wav", "mp3"):
                (folder / item[fmt]).write_bytes(f"{fmt}-{index}".encode())
            items.append(item)
        self.studio.history_file.write_text(json.dumps(items), "utf-8")
        return items

    def test_secondary_collisions_casefold_and_manifest_never_overwrite(self):
        items = self.fixtures(["12345678-voice", "voice", "voice", "voice-2", "Voice", "CON"],
            ids=["1" * 32, "2" * 32, "12345678" + "3" * 24, "4" * 32, "5" * 32, "6" * 32])
        with warnings.catch_warnings(record=True) as caught:
            result = self.studio.export_zip({"ids": [item["id"] for item in items]})
        self.assertFalse(caught)
        self.assertEqual(result["count"], 6)
        with zipfile.ZipFile(result["path"]) as archive:
            self.assertIsNone(archive.testzip())
            manifest = json.loads(archive.read("manifest.json"))
            names = [entry["exportFile"] for entry in manifest]
            self.assertEqual(len(set(name.casefold() for name in names)), 6)
            self.assertEqual(names[-1], "voice-CON.wav")
            archive.extractall(self.root / "extract")
        for index, entry in enumerate(manifest):
            expected = f"wav-{index}".encode()
            self.assertEqual((self.root / "extract" / entry["exportFile"]).read_bytes(), expected)
            self.assertEqual(entry["sha256"], hashlib.sha256(expected).hexdigest())
        self.assertEqual(list(self.root.glob("voice-export-*.zip")), [])
        marker = json.loads((Path(result["path"]).parent / "owner.json").read_text())
        self.assertEqual(marker["schema"], "shengyue-export-v1")

    def test_current_project_names_order_and_metadata_do_not_change_history(self):
        items = self.fixtures(["001-old-first", "002-old-second"])
        before = self.studio.history_file.read_bytes()
        ordered = [items[1], items[0]]
        current = [{"id": item["id"], "exportFilename": "新的文件名" if index == 0 else "001-00002-旁白",
                    "projectId": "current-project", "chapterId": "chapter", "lineId": f"line-{index}",
                    "chapterOrder": 0, "lineOrder": index, "partIndex": 0} for index, item in enumerate(ordered)]
        result = self.studio.export_zip({"ids": [item["id"] for item in ordered], "items": current, "format": "mp3"})
        with zipfile.ZipFile(result["path"]) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(archive.namelist(), ["新的文件名.mp3", "001-00002-旁白.mp3", "manifest.json"])
            self.assertEqual(archive.read("新的文件名.mp3"), b"mp3-1")
        for index, entry in enumerate(manifest):
            self.assertEqual(entry["projectId"], "current-project")
            self.assertEqual(entry["lineOrder"], index)
            self.assertEqual(entry["options"]["projectId"], "original-project")
        self.assertEqual(self.studio.history_file.read_bytes(), before)
        self.assertTrue((self.studio.outputs / items[0]["id"] / items[0]["wav"]).is_file())

    def test_preoccupied_suffixes_and_multibyte_names_are_extraction_safe(self):
        items = self.fixtures(["voice-2", "voice", "voice", "normal", "another"])
        astral_name = "𐐀" * 80
        names = ["voice-2", "voice", "voice", astral_name, astral_name]
        result = self.studio.export_zip({"ids": [item["id"] for item in items],
            "items": [{"id": item["id"], "exportFilename": name} for item, name in zip(items, names)]})
        with zipfile.ZipFile(result["path"]) as archive:
            exported = archive.namelist()[:-1]
            self.assertEqual(exported[:3], ["voice-2.wav", "voice.wav", "voice-3.wav"])
            self.assertTrue(all(len(name.encode("utf-8")) <= 255 for name in exported))
            archive.extractall(self.root / "long-names")

    def test_invalid_requests_do_not_create_temporary_archives(self):
        item = self.fixtures(["voice"])[0]
        data = {"ids": [item["id"]]}
        invalid = [ {"ids": [[]]}, {"ids": ["../escape"]}, {"format": "zip"}, {"items": []},
                    {"items": [{"id": item["id"], "exportFilename": "../escape"}]},
                    {"items": [{"id": [], "exportFilename": "valid"}]},
                    {"items": [{"id": item["id"], "exportFilename": "valid", "lineOrder": True}]} ]
        for change in invalid:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.studio.export_zip({**data, **change})
        self.assertFalse((self.root / ".export-tmp").exists())

    def test_archive_failure_or_cancellation_removes_only_owned_temporary_files(self):
        item = self.fixtures(["voice"])[0]
        sentinel = self.root / "voice-export-user.zip"
        sentinel.write_bytes(b"keep")
        for error in (OSError("disk full"), KeyboardInterrupt("cancelled")):
            with patch.object(zipfile.ZipFile, "write", side_effect=error):
                with self.assertRaises(type(error)):
                    self.studio.export_zip({"ids": [item["id"]]})
            self.assertEqual(list((self.root / ".export-tmp").iterdir()), [])
            self.assertEqual(sentinel.read_bytes(), b"keep")
            self.assertEqual(len(self.studio.history()), 1)

    def test_reference_transcript_is_atomic_persistent_and_free_without_license(self):
        reference_id = "a" * 32
        item = {"id": reference_id, "name": "我的声音", "text": "", "duration": 5}
        metadata = self.studio.references / (reference_id + ".json")
        metadata.write_text(json.dumps(item))
        (self.studio.references / (reference_id + ".wav")).write_bytes(b"audio-kept")
        updated = self.studio.update_reference({"id": reference_id, "text": "  准确的参考原话。  "})
        self.assertEqual(updated["text"], "准确的参考原话。")
        self.assertGreater(updated["textUpdatedAt"], 0)
        self.assertEqual(worker.Studio(self.root).list_references(), [updated])
        before = metadata.read_bytes()
        with patch.object(Path, "replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.studio.update_reference({"id": reference_id, "text": "失败写入"})
        self.assertEqual(metadata.read_bytes(), before)
        self.assertEqual(list(self.studio.references.glob("*.tmp")), [])
        for data in [{"id": "../escape", "text": "x"}, {"id": reference_id, "text": "x" * 1001}, {"id": "b" * 32, "text": "x"}]:
            with self.assertRaises(ValueError):
                self.studio.update_reference(data)
        (self.root / "license.txt").unlink()
        self.assertEqual(self.studio.update_reference({"id": reference_id, "text": "free edition"})["text"], "free edition")

    def test_explicit_empty_reference_text_never_falls_back_to_old_transcript(self):
        reference_id = "a" * 32
        item = {"id": reference_id, "text": "旧原话", "name": "reference", "duration": 5}
        (self.studio.references / (reference_id + ".json")).write_text(json.dumps(item))
        (self.studio.references / (reference_id + ".wav")).write_bytes(b"reference-bytes")
        self.studio.load = lambda *args: self.fail("empty transcript must fail before loading a model")
        with self.assertRaisesRegex(ValueError, "填写准确的参考台词"):
            self.studio.generate({"text": "new voice line", "mode": "clone", "referenceId": reference_id, "referenceText": ""})
        saved = self.studio.update_reference({"id": reference_id, "text": ""})
        self.assertEqual(saved["text"], "")
        self.assertGreater(saved["textUpdatedAt"], 0)

    def test_fixed_character_diagnostic_reuses_one_sample_and_no_customer_artifacts(self):
        import numpy as np
        calls, loaded = [], []
        self.studio.load = loaded.append
        def synthesize(text, speaker, instruction, options):
            calls.append((text, dict(options)))
            if options["mode"] == "clone":
                self.assertTrue(Path(options["refPath"]).is_file())
            return np.full(4 * 24000, .1, dtype=np.float32), 24000
        self.studio._synthesize_with_fallback = synthesize
        (self.root / "license.txt").unlink()  # The fixed diagnostic is available before purchase.
        result = self.studio.diagnose({"package": "character", "text": "must-not-be-read", "refPath": "/user-recording"})
        self.assertEqual(loaded, ["character", "reference"])
        self.assertEqual([options["mode"] for _, options in calls], ["design", "clone", "clone"])
        self.assertEqual(calls[1][1]["refPath"], calls[2][1]["refPath"])
        self.assertEqual(calls[1][1]["refText"], calls[0][0])
        self.assertNotIn("must-not-be-read", result["text"])
        self.assertEqual(result["workflow"], "fixed-character-v1")
        self.assertEqual(result["reuseCount"], 2)
        self.assertFalse(Path(calls[1][1]["refPath"]).exists())
        self.assertFalse(self.studio.history_file.exists())
        self.assertFalse(self.studio.voice_anchors.exists())
        self.assertEqual(list(self.studio.outputs.iterdir()), [])
        self.assertEqual(list(self.studio.references.iterdir()), [])
        self.assertTrue((self.root / "preflight/character.mp3").is_file())

    def test_character_diagnostic_failure_cleans_private_reference_sample(self):
        import numpy as np
        calls = []
        self.studio.load = lambda key: None
        def synthesize(text, speaker, instruction, options):
            if options["mode"] == "clone":
                calls.append(options["refPath"])
                raise RuntimeError("clone failed")
            return np.full(4 * 24000, .1, dtype=np.float32), 24000
        self.studio._synthesize_with_fallback = synthesize
        with self.assertRaisesRegex(RuntimeError, "clone failed"):
            self.studio.diagnose({"package": "character"})
        self.assertEqual(len(calls), 1)
        self.assertFalse(Path(calls[0]).exists())
        self.assertEqual(list((self.root / "preflight").iterdir()), [])
        self.assertFalse(self.studio.history_file.exists())


if __name__ == "__main__":
    unittest.main()
