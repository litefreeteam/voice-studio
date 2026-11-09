import errno
import hashlib
import http.server
import importlib.util
import itertools
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("downloads", Path(__file__).parents[1] / "backend/downloads.py")
downloads = importlib.util.module_from_spec(spec)
spec.loader.exec_module(downloads)
CONTENT = b"verified-model-weights" * 20


class ModelDownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.calls = []
        self.behavior = {}
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                source = self.path.split("/")[1]
                start = int(self.headers.get("Range", "bytes=0-").split("=")[1].split("-")[0])
                owner.calls.append((source, self.headers.get("Range"), self.path))
                behavior = owner.behavior.get(source, "good")
                if behavior == "fail" or behavior == "interrupt" and start:
                    self.send_error(503)
                    return
                if behavior == "missing":
                    self.send_error(404)
                    return
                content = b"x" * len(CONTENT) if behavior == "corrupt" else CONTENT
                if behavior == "ignore-range":
                    start = 0
                self.send_response(206 if start else 200)
                if start:
                    self.send_header("Content-Range", f"bytes {0 if behavior == 'wrong-range' else start}-{len(content)-1}/{len(content)}")
                self.send_header("Content-Length", str(len(content) - start))
                self.end_headers()
                if behavior == "interrupt":
                    self.wfile.write(content[:24])
                    self.wfile.flush()
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                else:
                    try:
                        self.wfile.write(content[start:])
                    except (BrokenPipeError, ConnectionResetError):
                        pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        base = f"http://127.0.0.1:{self.server.server_port}"
        self.sources = [{"id": "modelscope", "label": "魔搭", "url": base + "/primary"},
                        {"id": "hf-mirror", "label": "备用", "url": base + "/backup"},
                        {"id": "huggingface", "label": "官方", "url": base + "/official"}]
        for name, value in [("SOURCES", self.sources), ("CHUNK", 8)]:
            p = patch.object(downloads, name, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(downloads.time, "sleep")
        p.start()
        self.addCleanup(p.stop)
        self.sha = hashlib.sha256(CONTENT).hexdigest()
        self.pinned = {"revision": "a" * 40, "weights": {"model.safetensors": self.sha},
                       "files": {"model.safetensors": {"size": len(CONTENT), "sha256": self.sha, "modelscopeRevision": "b" * 40}}}

    def partial(self, content):
        file = self.folder / ".cache/downloads" / ("model.safetensors." + self.sha + ".incomplete")
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(content)
        return file

    def download(self, emit=lambda *args, **kwargs: None):
        downloads.download_model(self.folder, "Qwen/Test", self.pinned, emit)

    def marker(self):
        return json.loads((self.folder / ".complete.json").read_text())

    def test_primary_is_anonymous_pinned_and_all_files_are_verified(self):
        self.download()
        self.assertEqual(self.marker()["sources"], {"model.safetensors": "modelscope"})
        self.assertIn("Revision=" + "b" * 40, self.calls[0][2])
        self.assertEqual((self.folder / "model.safetensors").read_bytes(), CONTENT)
        self.calls.clear()
        self.download()
        self.assertEqual(self.calls, [])
        self.assertEqual(self.marker()["sources"]["model.safetensors"], "local")

    def test_optional_package_uses_only_its_pinned_available_sources(self):
        self.pinned["sources"] = ["modelscope"]
        self.behavior["primary"] = "fail"
        with self.assertRaises(RuntimeError):
            self.download()
        self.assertTrue(self.calls)
        self.assertTrue(all(source == "primary" for source, _, _ in self.calls))
        self.calls.clear()
        self.pinned["sources"] = ["unavailable"]
        with self.assertRaisesRegex(ValueError, "下载源"):
            self.download()
        self.assertEqual(self.calls, [])

    def test_package_progress_counts_verified_files_and_resumed_bytes_once(self):
        entry = self.pinned["files"]["model.safetensors"]
        self.pinned["files"] = {"config.json": dict(entry), "model.safetensors": entry}
        (self.folder / "config.json").write_bytes(CONTENT)
        self.partial(CONTENT[:20])
        events = []
        self.download(lambda kind, **event: events.append(event))
        transfer = [event for event in events if event.get("unit") == "B"]
        self.assertEqual(transfer[0]["current"], 20)
        self.assertEqual(transfer[0]["aggregateCurrent"], len(CONTENT) + 20)
        self.assertEqual(transfer[0]["aggregateTotal"], len(CONTENT) * 2)
        self.assertEqual(transfer[0]["fileIndex"], 2)
        self.assertEqual(transfer[0]["fileCount"], 2)
        self.assertEqual(events[-1]["downloadPhase"], "complete")
        self.assertEqual(events[-1]["aggregateCurrent"], len(CONTENT) * 2)
        self.assertTrue(all(event["aggregateCurrent"] <= event["aggregateTotal"] for event in events))

    def test_corrupt_file_resets_package_progress_before_fallback(self):
        self.behavior["primary"] = "corrupt"
        events = []
        self.download(lambda kind, **event: events.append(event))
        backup = next(event for event in events if event.get("source") == "hf-mirror")
        self.assertEqual(backup["aggregateCurrent"], 0)
        self.assertEqual(events[-1]["aggregateCurrent"], len(CONTENT))

    def test_midstream_disconnect_continues_the_same_bytes_on_backup(self):
        self.behavior["primary"] = "interrupt"
        self.download()
        self.assertIn(("backup", "bytes=24-"), [(source, range_) for source, range_, _ in self.calls])
        self.assertEqual(self.marker()["sources"]["model.safetensors"], "hf-mirror")
        self.assertEqual((self.folder / "model.safetensors").read_bytes(), CONTENT)

    def test_cancel_and_retry_resumes_without_a_completion_marker(self):
        def cancel(kind, **event):
            if event.get("current", 0) >= 16:
                raise KeyboardInterrupt()
        with patch.object(downloads.time, "monotonic", side_effect=itertools.count()), self.assertRaises(KeyboardInterrupt):
            self.download(cancel)
        self.assertFalse((self.folder / ".complete.json").exists())
        self.download()
        self.assertTrue(any(range_ for _, range_, _ in self.calls))
        self.assertEqual((self.folder / "model.safetensors").read_bytes(), CONTENT)

    def test_corruption_is_removed_and_never_marked_complete(self):
        self.behavior.update(primary="corrupt", backup="corrupt", official="corrupt")
        with self.assertRaisesRegex(RuntimeError, "校验失败"):
            self.download()
        self.assertFalse((self.folder / ".complete.json").exists())
        self.assertFalse((self.folder / "model.safetensors").exists())
        self.assertEqual(list(self.folder.rglob("*.incomplete")), [])

    def test_corrupt_primary_switches_to_clean_backup(self):
        self.behavior["primary"] = "corrupt"
        self.download()
        self.assertEqual(self.marker()["sources"]["model.safetensors"], "hf-mirror")
        self.assertEqual([range_ for source, range_, _ in self.calls if source == "backup"], [None])

    def test_range_ignored_by_server_restarts_safely(self):
        self.partial(CONTENT[:20])
        self.behavior["primary"] = "ignore-range"
        self.download()
        self.assertEqual((self.folder / "model.safetensors").read_bytes(), CONTENT)

    def test_bad_content_range_is_rejected_and_official_is_last(self):
        self.partial(CONTENT[:20])
        self.behavior.update(primary="wrong-range", backup="missing")
        self.download()
        self.assertEqual(self.marker()["sources"]["model.safetensors"], "huggingface")
        self.assertEqual([source for source, _, _ in self.calls], ["primary", "backup", "official"])

    def test_all_sources_offline_preserves_partial_and_removes_stale_marker(self):
        partial = self.partial(CONTENT[:20])
        (self.folder / ".complete.json").write_text('{}')
        self.behavior.update(primary="fail", backup="fail", official="fail")
        with self.assertRaises(RuntimeError):
            self.download()
        self.assertEqual(partial.read_bytes(), CONTENT[:20])
        self.assertFalse((self.folder / ".complete.json").exists())

    def test_legacy_huggingface_partial_can_resume_from_modelscope(self):
        old = self.folder / ".cache/huggingface/download" / ("model.safetensors." + self.sha + ".incomplete")
        old.parent.mkdir(parents=True)
        old.write_bytes(CONTENT[:20])
        self.download()
        self.assertEqual(self.calls[0][1], "bytes=20-")
        self.assertFalse(old.exists())

    def test_disk_errors_never_trigger_network_fallback(self):
        with patch.object(downloads, "_transfer", side_effect=OSError(errno.ENOSPC, "full")) as transfer:
            with self.assertRaisesRegex(RuntimeError, "磁盘空间"):
                self.download()
        self.assertEqual(transfer.call_count, 1)


class ManifestTests(unittest.TestCase):
    def test_all_models_have_pinned_sources_and_consistent_weight_hashes(self):
        manifest = json.loads((Path(__file__).parents[1] / "shared/model-manifest.json").read_text())["repositories"]
        self.assertEqual(len(manifest), 10)
        for repo, pinned in manifest.items():
            self.assertIn("config.json", pinned["files"], repo)
            self.assertIn("README.md", pinned["files"], repo)
            for name, entry in pinned["files"].items():
                self.assertRegex(entry["modelscopeRevision"], r"^[a-f0-9]{40}$", repo + name)
                self.assertGreater(entry["size"], 0)
                self.assertRegex(entry["sha256"], r"^[a-f0-9]{64}$")
            for name, sha in pinned["weights"].items():
                self.assertEqual(pinned["files"][name]["sha256"], sha)
