"""Pinned, resumable model files, shared across the desktop and CLI.

No SDK login or token is needed. All source URLs and file hashes come from the
bundled manifests; a mirror can never replace the expected content hash.
"""
import errno
import hashlib
import http.client
import json
from pathlib import Path, PurePosixPath
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SOURCES = json.loads((Path(__file__).parent.parent / "shared/download-sources.json").read_text("utf-8"))["models"]
TIMEOUT = 20
CHUNK = 256 * 1024


class IntegrityError(ValueError):
    pass


def digest(file):
    result = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def file_url(source, repo, pinned, filename):
    if source["id"] == "modelscope":
        revision = pinned["files"][filename]["modelscopeRevision"]
        return source["url"] + "/api/v1/models/" + repo + "/repo?" + urllib.parse.urlencode({"Revision": revision, "FilePath": filename})
    return source["url"] + "/" + repo + "/resolve/" + pinned["revision"] + "/" + urllib.parse.quote(filename, safe="/")


def _transfer(url, partial, spec, progress):
    size = spec["size"]
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > size:
        partial.unlink()
        offset = 0
    if offset < size:
        headers = {"User-Agent": "Shengyue/0.4 model-download", "Accept-Encoding": "identity"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            if response.status == 206:
                match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
                if not match or int(match[1]) != offset or int(match[3]) != size or int(match[2]) < offset or int(match[2]) >= size:
                    raise IntegrityError("下载源返回了错误的断点范围")
            elif response.status == 200:
                # Some mirrors ignore Range. Truncate instead of appending a full
                # response to a partial file and corrupting it.
                offset = 0
            else:
                raise IntegrityError(f"下载源返回 HTTP {response.status}")
            if response.headers.get("Content-Encoding", "identity") != "identity":
                raise IntegrityError("下载源返回了不支持的文件编码")
            with partial.open("ab" if offset else "wb") as output:
                progress(offset, size)
                while True:
                    chunk = response.read(CHUNK)
                    if not chunk:
                        break
                    if offset + len(chunk) > size:
                        raise IntegrityError("下载文件大小与固定版本不符")
                    output.write(chunk)
                    offset += len(chunk)
                    progress(offset, size)
    if partial.stat().st_size != size:
        raise ConnectionError("文件连接中断，已保留下载进度")
    if digest(partial) != spec["sha256"]:
        partial.unlink()
        raise IntegrityError("文件 SHA-256 校验失败，已清理损坏文件")


def download_model(folder, repo, pinned, emit, sources=None):
    sources = SOURCES if sources is None else sources
    if pinned.get("sources"):
        sources = [source for source in sources if source["id"] in pinned["sources"]]
    if not sources:
        raise ValueError("当前下载源不提供这个声音资源，请恢复默认下载源后重试")
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    # A previous completion marker must not survive a failed repair or update.
    (folder / ".complete.json").unlink(missing_ok=True)
    files, used_sources = {}, {}
    total_bytes = sum(entry["size"] for entry in pinned["files"].values())
    completed_bytes = 0
    file_count = len(pinned["files"])
    preferred = 0
    last_progress = [0.0]
    for file_index, (filename, spec) in enumerate(pinned["files"].items(), 1):
        def report(message, offset=0, **event):
            emit("progress", stage="download", message=message, file=filename,
                 aggregateCurrent=completed_bytes + min(max(offset, 0), spec["size"]),
                 aggregateTotal=total_bytes, fileIndex=file_index, fileCount=file_count, **event)

        name = PurePosixPath(filename)
        if name.is_absolute() or ".." in name.parts or "\\" in filename:
            raise ValueError("模型文件路径无效")
        target = folder / filename
        report("正在检查声悦定制资源，已有下载会继续使用…", downloadPhase="verifying")
        if target.is_file() and target.stat().st_size == spec["size"] and digest(target) == spec["sha256"]:
            files[filename] = target.stat().st_size
            used_sources[filename] = "local"
            report("已校验本地声悦定制资源，继续准备…", offset=spec["size"], downloadPhase="verifying")
            completed_bytes += spec["size"]
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        last_error = None
        for source_index in list(range(preferred, len(sources))) + list(range(preferred)):
            source = sources[source_index]
            expected = spec
            partial = folder / ".cache/downloads" / (filename + "." + expected["sha256"] + ".incomplete")
            partial.parent.mkdir(parents=True, exist_ok=True)
            # Preserve interrupted downloads from releases using huggingface_hub.
            if not partial.exists():
                legacy = folder / ".cache/huggingface/download" / name.parent
                for candidate in legacy.glob(name.name + ".*.incomplete"):
                    if expected["sha256"] in candidate.name and candidate.stat().st_size <= expected["size"]:
                        candidate.replace(partial)
                        break
            for attempt in range(2):
                report("正在重新下载声悦定制资源，已下载内容会继续使用…" if attempt else "正在连接声悦定制资源，已下载内容会继续使用…",
                       offset=partial.stat().st_size if partial.exists() else 0,
                       source=source["id"], downloadPhase="transferring")

                def progress(current, total):
                    now = time.monotonic()
                    if current == 0 or now - last_progress[0] > 0.8 or current == total:
                        last_progress[0] = now
                        report("下载完成，正在校验声悦定制资源…" if current == total else "正在下载声悦定制资源…",
                               offset=current, source=source["id"], current=current, total=total, unit="B",
                               downloadPhase="verifying" if current == total else "transferring")

                try:
                    _transfer(file_url(source, repo, pinned, filename), partial, expected, progress)
                    partial.replace(target)
                    files[filename] = target.stat().st_size
                    used_sources[filename] = source["id"]
                    completed_bytes += spec["size"]
                    preferred = source_index
                    break
                except OSError as error:
                    if error.errno in (errno.EACCES, errno.ENOSPC, errno.EROFS):
                        raise RuntimeError("声音保存失败，请检查磁盘空间、目录权限和安全软件；下载文件已保留") from error
                    if isinstance(error, urllib.error.HTTPError):
                        error.close()
                    last_error = error
                except (IntegrityError, http.client.HTTPException) as error:
                    last_error = error
                # Do not print signed redirect URLs, tokens or full request headers.
                print(f"Model download {source['id']} {filename}: {type(last_error).__name__}", file=sys.stderr, flush=True)
                if isinstance(last_error, IntegrityError) or getattr(last_error, "code", None) in (401, 403, 404):
                    break
                if attempt == 0:
                    time.sleep(1)
            if filename in files:
                break
            report("声悦定制资源连接中断，正在重新连接，已下载内容会保留…",
                   offset=partial.stat().st_size if partial.exists() else 0,
                   source=source["id"], downloadPhase="transferring")
        else:
            raise RuntimeError("声悦定制资源暂时无法下载或校验失败，请检查网络后重试；已下载内容会保留，准备成功前请勿购买") from last_error
    if not pinned["weights"] or any(files.get(name) != pinned["files"][name]["size"] or pinned["files"][name]["sha256"] != sha for name, sha in pinned["weights"].items()):
        raise IntegrityError("声音文件清单不完整")
    temporary = folder / ".complete.tmp"
    temporary.write_text(json.dumps({"repo": repo, "revision": pinned["revision"], "files": files,
                                     "weights": pinned["weights"], "sources": used_sources}), "utf-8")
    temporary.replace(folder / ".complete.json")
    emit("progress", stage="download", message="声悦定制资源下载及校验完成", downloadPhase="complete",
         aggregateCurrent=total_bytes, aggregateTotal=total_bytes, fileIndex=file_count, fileCount=file_count)
