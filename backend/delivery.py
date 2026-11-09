"""Bounded-memory project delivery. No synthesis, external encoder or source edits.

The caller must check the licence before calling ``build_delivery``. All audio
paths are independently resolved from history; request paths are never used.
The RMS gate is an energy measurement, not speech recognition or LUFS metering.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import time
import uuid
import zipfile
import base64
import importlib.util

_audio_spec = importlib.util.spec_from_file_location("shengyue_audio_tools", Path(__file__).with_name("audio_tools.py"))
audio_tools = importlib.util.module_from_spec(_audio_spec)
_audio_spec.loader.exec_module(audio_tools)

MAX_SEGMENTS = 5000
MAX_SEGMENT_SECONDS = 30 * 60
MAX_TOTAL_SECONDS = 6 * 60 * 60
MAX_SOURCE_BYTES = 4 * 1024 ** 3
MAX_WORKING_BYTES = 8 * 1024 ** 3
MAX_TEXT_BYTES = 8 * 1024 ** 2
DISK_RESERVE_BYTES = 128 * 1024 ** 2
BLOCK_FRAMES = 65536
SOURCE_RATES = {8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 192000}
DEFAULTS = {"sampleRate": 48000, "normalize": True, "trimSilence": False,
            "pauseMs": 350, "includeSegments": True}
TARGET_RMS_DBFS = -20.0
ACTIVE_GATE_DBFS = -45.0
TRIM_GATE_DBFS = -50.0
MAX_GAIN_DB = 12.0
PEAK_CEILING_DBFS = -1.0
TRIM_PADDING_MS = 120
MAX_TRIM_MS = 1500
WORK_FILES = {"owner.json", "merged.wav", "merged.mp3", "segment.wav", "subtitles.srt", "report.json", "manifest.json"}
DISCLAIMER = (
    "有效声段按20毫秒能量门限选取，均衡使用有效声段RMS与固定增益，不是LUFS；"
    "峰值限制是编码前PCM样本峰值，不是true-peak；关闭RMS均衡时仍保留样本峰值保护，可能降低音量。原始削波不能由本处理恢复。"
    "字幕按处理后的WAV分段时间轴生成，不是逐字ASR对齐；MP3有损编码可能有编码延迟和解码峰值变化。"
)


def _settings(data):
    if not isinstance(data, dict):
        raise ValueError("成品导出参数无效")
    raw = data.get("settings", {})
    if not isinstance(raw, dict) or set(raw) - set(DEFAULTS):
        raise ValueError("成品导出设置无效")
    settings = {**DEFAULTS, **raw}
    if type(settings["sampleRate"]) is not int or settings["sampleRate"] not in (24000, 44100, 48000):
        raise ValueError("成品采样率只能是24000、44100或48000")
    for name in ("normalize", "trimSilence", "includeSegments"):
        if type(settings[name]) is not bool:
            raise ValueError("成品导出开关无效")
    if type(settings["pauseMs"]) is not int or not 0 <= settings["pauseMs"] <= 3000:
        raise ValueError("句间停顿必须是0–3000毫秒")
    return settings


def _stamp(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


@contextlib.contextmanager
def _source_open(entry):
    path = entry["path"]
    if path.parent.is_symlink() or path.parent.parent.is_symlink() or path.is_symlink():
        raise ValueError("音频路径不能是符号链接")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as source:
        current = os.fstat(source.fileno())
        if not stat.S_ISREG(current.st_mode) or _stamp(current) != entry["stamp"]:
            raise ValueError("音频文件已变化，请重新导出")
        yield source
        if _stamp(os.fstat(source.fileno())) != entry["stamp"]:
            raise ValueError("导出过程中音频文件已变化，请重新导出")


def _wav_header(source, size):
    """libsndfile accepts truncated WAVs; validate every RIFF boundary ourselves."""
    head = source.read(12)
    if len(head) != 12 or head[:4] != b"RIFF" or head[8:] != b"WAVE":
        raise ValueError("需要完整的RIFF WAV音频")
    end = struct.unpack_from("<I", head, 4)[0] + 8
    if end != size:
        raise ValueError("WAV音频不完整或文件长度无效")
    fmt, audio_bytes, chunks = None, None, 0
    while source.tell() < end:
        chunk = source.read(8)
        chunks += 1
        if len(chunk) != 8 or chunks > 4096:
            raise ValueError("WAV区块不完整或过多")
        name, length = chunk[:4], struct.unpack_from("<I", chunk, 4)[0]
        stop = source.tell() + length
        if stop > end or stop + length % 2 > end:
            raise ValueError("WAV音频数据不完整")
        if name == b"fmt ":
            if fmt is not None or not 16 <= length <= 65536:
                raise ValueError("WAV格式区块无效")
            fmt = struct.unpack("<HHIIHH", source.read(16))
        elif name == b"data":
            if audio_bytes is not None:
                raise ValueError("不支持多个WAV音频数据区块")
            audio_bytes = length
        source.seek(stop + length % 2)
    if fmt is None or audio_bytes is None:
        raise ValueError("WAV缺少音频或格式区块")
    codec, channels, rate, byte_rate, align, bits = fmt
    if (codec not in (1, 3, 0xFFFE) or channels not in (1, 2) or rate not in SOURCE_RATES
            or bits not in (16, 24, 32, 64) or align != channels * bits // 8
            or byte_rate != rate * align or not audio_bytes or audio_bytes % align):
        raise ValueError("不支持或不完整的WAV音频格式")
    return audio_bytes // align, channels, rate


def _entries(studio, data):
    items = data.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_SEGMENTS:
        raise ValueError(f"请选择1–{MAX_SEGMENTS}段完整音频")
    if studio.outputs.is_symlink() or studio.outputs.resolve() != studio.root.resolve() / "outputs":
        raise ValueError("音频目录无效")
    history = studio.history()
    known = {}
    for item in history:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            if item["id"] in known:
                raise ValueError("音频历史记录有重复标识")
            known[item["id"]] = item
    seen, entries, total_bytes, total_seconds = set(), [], 0, 0.0
    text_bytes = 0
    for current in items:
        if not isinstance(current, dict) or not isinstance(current.get("id"), str) or not re.fullmatch(r"[a-f0-9]{32}", current["id"]):
            raise ValueError("音频记录标识无效")
        item_id = current["id"]
        if item_id in seen:
            raise ValueError("成品条目重复引用同一音频，请检查项目")
        seen.add(item_id)
        if item_id not in known:
            raise ValueError("项目音频缺失，请补全后再导出")
        original_item = known[item_id]
        if "editRevision" in current and current["editRevision"] != original_item.get("editedWav", ""):
            raise ValueError("音频编辑已改变，请重新打开导出以使用最新设置")
        item = audio_tools.effective_item(original_item)
        name = item.get("wav")
        if not isinstance(name, str) or not re.fullmatch(r"[\w\-]{1,80}\.wav", name):
            raise ValueError("音频文件名无效")
        path = studio.outputs / item_id / name
        if path.parent.is_symlink() or path.is_symlink() or not path.is_file():
            raise ValueError("音频文件不存在或路径无效")
        source_stat = path.stat()
        total_bytes += source_stat.st_size
        if total_bytes > MAX_SOURCE_BYTES:
            raise ValueError("原音频总大小超出4GiB导出限制，请按章节导出")
        text = item.get("text", "")
        if not isinstance(text, str) or len(text) > 10000:
            raise ValueError("音频原文无效或过长")
        text_bytes += len(text.encode("utf-8"))
        if text_bytes > MAX_TEXT_BYTES:
            raise ValueError("项目字幕超出8MiB限制，请按章节导出")
        options = item.get("options", {})
        if not isinstance(options, dict):
            raise ValueError("音频项目元数据无效")
        meta = {}
        for field in ("projectId", "chapterId", "lineId", "chapterName", "exportFilename"):
            value = current.get(field, options.get(field))
            if value is not None:
                if not isinstance(value, str) or len(value) > (256 if field == "chapterName" else 128):
                    raise ValueError("项目分段标识无效")
                meta[field] = value
        for field in ("chapterOrder", "lineOrder", "partIndex", "partCount"):
            value = current.get(field, options.get(field))
            if value is not None:
                if type(value) is not int or not (1 if field == "partCount" else 0) <= value <= MAX_SEGMENTS:
                    raise ValueError("项目分段顺序无效")
                if field in ("partIndex", "partCount") and field in current and field in options and current[field] != options[field]:
                    raise ValueError("项目分段顺序与原始音频不一致")
                meta[field] = value
        if original_item.get("edit"): meta["audioEdit"] = original_item["edit"]
        inline_pauses = original_item.get("inlinePauses", {})
        if inline_pauses:
            if not isinstance(inline_pauses, dict) or any(type(inline_pauses.get(edge, 0)) is not int or not 0 <= inline_pauses.get(edge, 0) <= 60000 for edge in ("leadingMs", "trailingMs")):
                raise ValueError("段内停顿信息无效")
            meta["inlinePauses"] = inline_pauses
        review = original_item.get("editedQuality", original_item.get("quality", {}))
        if review.get("review"): meta["qualityReview"] = review
        entry = {"id": item_id, "path": path, "stamp": _stamp(source_stat), "text": text, "meta": meta}
        with _source_open(entry) as source:
            frames, channels, rate = _wav_header(source, entry["stamp"][2])
            if not .01 <= frames / rate <= MAX_SEGMENT_SECONDS:
                raise ValueError("单段音频必须在10毫秒至30分钟之间，请拆分长段后导出")
            source.seek(0)
            import soundfile as sf
            with sf.SoundFile(source) as audio:
                if (audio.frames, audio.channels, audio.samplerate) != (frames, channels, rate):
                    raise ValueError("WAV头与音频帧数不一致")
                if audio.subtype not in ("PCM_16", "PCM_24", "PCM_32", "FLOAT", "DOUBLE"):
                    raise ValueError("不支持此WAV编码")
                entry["subtype"] = audio.subtype
        entry.update(frames=frames, channels=channels, rate=rate)
        entries.append(entry)
        total_seconds += frames / rate
        if total_seconds > MAX_TOTAL_SECONDS:
            raise ValueError("项目原音频总时长超出6小时限制，请按章节导出")
    if "ids" in data:
        ids = data["ids"]
        if (not isinstance(ids, list) or len(ids) > MAX_SEGMENTS or any(not isinstance(v, str) for v in ids)
                or set(ids) != seen):
            raise ValueError("项目与导出音频列表不匹配")
    # Parts of a line must be contiguous, in order, and complete when the source
    # declares partCount. Reopening a line would introduce unintended pauses.
    groups, previous, parts = set(), None, []
    def finish_group():
        if not parts:
            return
        indexes = [entry["meta"].get("partIndex", 0) for entry in parts]
        counts = {entry["meta"].get("partCount") for entry in parts} - {None}
        if indexes != list(range(len(parts))) or len(counts) > 1 or (counts and counts != {len(parts)}):
            raise ValueError("同一句的自动拆分音频缺段或顺序不正确")
    for entry in entries:
        meta = entry["meta"]
        group = (meta.get("projectId", ""), meta.get("chapterId", ""), meta["lineId"]) if meta.get("lineId") else (entry["id"],)
        entry["group"] = group
        if group != previous:
            finish_group()
            if group in groups:
                raise ValueError("同一句的自动拆分音频必须连续")
            groups.add(group)
            parts = []
            previous = group
        parts.append(entry)
    finish_group()
    return entries, total_bytes


def _db(value):
    return round(20 * math.log10(value), 6) if value > 0 else None


def _scan_source(entry):
    import numpy as np
    import soundfile as sf
    frames, peak, clips = 0, 0.0, 0
    bits = int(entry["subtype"][4:]) if entry["subtype"].startswith("PCM_") else None
    clipping = 1 - 2 ** (1 - bits) if bits else 1.0
    with _source_open(entry) as source, sf.SoundFile(source) as audio:
        while True:
            block = audio.read(BLOCK_FRAMES, dtype="float64", always_2d=True)
            if not len(block):
                break
            if not np.isfinite(block).all():
                raise ValueError("原音频包含无效样本")
            absolute = np.abs(block)
            peak = max(peak, float(absolute.max()))
            if peak > 16:
                raise ValueError("原音频样本数值异常，无法安全处理")
            clips += int(np.count_nonzero(absolute >= clipping))
            frames += len(block)
    if frames != entry["frames"]:
        raise ValueError("WAV音频读取不完整")
    return peak, clips


def _resample_blocks(entry, target):
    """Polyphase blocks with aligned rational phase and FIR overlap.

    Each independent block includes the full filter support. Boundaries are
    multiples of down, so discarding overlaps exactly matches a single call
    (including the final ceil frame). Memory never depends on project length.
    """
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly
    divisor = math.gcd(entry["rate"], target)
    up, down = target // divisor, entry["rate"] // divisor
    step = max(down, BLOCK_FRAMES // down * down)
    halo = math.ceil((10 * max(up, down) / up + 2) / down) * down
    with _source_open(entry) as source, sf.SoundFile(source) as audio:
        for start in range(0, entry["frames"], step):
            end = min(start + step, entry["frames"])
            left, right = max(0, start - halo), min(entry["frames"], end + halo)
            audio.seek(left)
            block = audio.read(right - left, dtype="float64", always_2d=True)
            if len(block) != right - left or not np.isfinite(block).all():
                raise ValueError("原音频不完整或包含无效样本")
            mono = block.mean(axis=1)
            if up != down:
                mono = resample_poly(mono, up, down)
            offset = (start - left) * up // down
            count = (end * up + down - 1) // down - start * up // down
            output = mono[offset:offset + count]
            if len(output) != count or not np.isfinite(output).all():
                raise ValueError("重采样结果无效")
            yield output


def _prepare_segment(entry, target, scratch):
    import numpy as np
    import soundfile as sf
    original_peak, clips = _scan_source(entry)
    file = scratch / "segment.wav"
    with sf.SoundFile(file, "w", samplerate=target, channels=1, subtype="FLOAT", format="WAV") as output:
        for block in _resample_blocks(entry, target):
            output.write(block)
    # Read back the FLOAT scratch actually used for rendering, using a fixed
    # 20ms gate. One frame/block is sufficient and bounds memory even for hours.
    gate = 10 ** (ACTIVE_GATE_DBFS / 20)
    trim_gate = 10 ** (TRIM_GATE_DBFS / 20)
    window = target // 50
    active_energy, active_samples, peak, first, last, offset = 0.0, 0, 0.0, None, None, 0
    with sf.SoundFile(file) as audio:
        total = audio.frames
        while True:
            block = audio.read(window * 128, dtype="float64")
            if not len(block):
                break
            peak = max(peak, float(np.abs(block).max()))
            for start in range(0, len(block), window):
                frame = block[start:start + window]
                energy = float(np.dot(frame, frame))
                rms = math.sqrt(energy / len(frame))
                if rms >= gate:
                    active_energy += energy
                    active_samples += len(frame)
                if rms >= trim_gate:
                    first = offset + start if first is None else first
                    last = offset + start + len(frame)
            offset += len(block)
    expected = (entry["frames"] * target + entry["rate"] - 1) // entry["rate"]
    if total != expected or offset != total:
        raise ValueError("处理后音频帧数不完整")
    return {"file": file, "frames": total, "peak": peak, "originalPeak": original_peak,
            "originalClippedSamples": clips, "activeRms": math.sqrt(active_energy / active_samples) if active_samples else 0.0,
            "activeSamples": active_samples, "first": first, "last": last}


def _srt_time(frame, rate):
    milliseconds = (frame * 1000 + rate // 2) // rate
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}"


def _srt_text(text):
    text = text.replace("\t", " ").replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(c for c in text if c == "\n" or ord(c) >= 32)
    return "\n".join(line.strip() for line in text.splitlines() if line.strip()) or "（无原文）"


def _check_disk(root, needed):
    if needed > MAX_WORKING_BYTES:
        raise ValueError("导出临时空间预算超出8GiB限制，请缩短项目")
    if shutil.disk_usage(root).free < needed + DISK_RESERVE_BYTES:
        raise OSError("磁盘空间不足，无法安全生成成品ZIP")


def _write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), "utf-8")


def _owned_cleanup(folder, allowed):
    # Never recursively delete; only our unique files, with no directory links.
    if folder is None or not folder.exists() or folder.is_symlink():
        return
    children = list(folder.iterdir())
    if any(p.name not in allowed or p.is_symlink() or not p.is_file() for p in children):
        return
    for child in children:
        child.unlink(missing_ok=True)
    folder.rmdir()


def build_delivery(studio, data, emit, preview_seconds=0):
    """Create a private owned archive; caller persists it with existing exports API.

    ``items`` is the authoritative order. Duplicate source IDs are rejected, not
    silently dropped. ``ids`` may repeat but, when present, must name the same set.
    The source history text is the subtitle text; current project metadata supplies
    chapter/line relationships. Exceptions (including cancellation) clean artifacts.
    """
    import numpy as np
    import soundfile as sf
    import lameenc
    settings = _settings(data)
    mix = audio_tools.mix_settings(data.get("mix", {}))
    if preview_seconds: settings["includeSegments"] = False
    entries, source_bytes = _entries(studio, data)
    rate = settings["sampleRate"]
    exported_lines = len({e["group"] for e in entries})
    scope = {"partial": data.get("partial", False), "scopeLabel": data.get("scopeLabel", "所选范围"),
             "totalLines": data.get("totalLines", exported_lines), "exportedLines": data.get("exportedLines", exported_lines),
             "skippedLines": data.get("skippedLines", 0)}
    for key, default in (("projectId", ""), ("projectName", "未命名项目")):
        value = data.get(key, default)
        if not isinstance(value, str) or len(value) > (128 if key == "projectId" else 256):
            raise ValueError("成品项目名称或标识无效")
        scope[key] = value
    if type(scope["partial"]) is not bool or not isinstance(scope["scopeLabel"], str) or len(scope["scopeLabel"]) > 256:
        raise ValueError("成品导出范围无效")
    if any(type(scope[k]) is not int or not 0 <= scope[k] <= 1000000 for k in ("totalLines", "exportedLines", "skippedLines")):
        raise ValueError("成品导出台词数量无效")
    if (scope["exportedLines"] != exported_lines or scope["totalLines"] != exported_lines + scope["skippedLines"]
            or scope["partial"] != (scope["skippedLines"] > 0)):
        raise ValueError("成品导出范围与完整音频不一致")
    token = data.get("exportToken", uuid.uuid4().hex)
    if not isinstance(token, str) or not re.fullmatch(r"[a-f0-9]{32}", token):
        raise ValueError("成品导出任务标识无效")
    pause_frames = (settings["pauseMs"] * rate + 500) // 1000
    output_frames = sum((e["frames"] * rate + e["rate"] - 1) // e["rate"] for e in entries)
    output_frames += pause_frames * sum(a["group"] != b["group"] for a, b in zip(entries, entries[1:]))
    if preview_seconds: output_frames = min(output_frames, round(preview_seconds * rate))
    if output_frames > MAX_TOTAL_SECONDS * rate:
        raise ValueError("包含句间停顿的成品总时长超出6小时限制，请按章节导出")
    bitrate = 160 if rate == 24000 else 192
    audio_budget = output_frames * 2 + math.ceil(output_frames / rate * bitrate * 125) + 1048576
    max_segment = max(math.ceil(e["frames"] / e["rate"] * rate) for e in entries) * 4 + 4096
    text_budget = 4 * sum(len(e["text"].encode("utf-8")) for e in entries)
    originals_budget = math.ceil(source_bytes * 1.002) if settings["includeSegments"] else 0
    budget = 2 * audio_budget + max_segment + originals_budget + len(entries) * 32768 + text_budget
    _check_disk(studio.root, budget)
    work_root, export_root = studio.root / ".export-work", studio.root / ".export-tmp"
    for root in (work_root, export_root):
        if root.is_symlink():
            raise ValueError("成品导出临时目录无效")
        root.mkdir(exist_ok=True)
    scratch = folder = None
    mixer = None
    success = False
    try:
        new_scratch = work_root / ("voice-export-" + token)
        new_scratch.mkdir()  # A caller-controlled collision never overwrites a prior run.
        scratch = new_scratch
        owner = {"token": token, "pid": os.getppid(), "createdAt": int(time.time() * 1000)}
        _write_json(scratch / "owner.json", {"schema": "shengyue-delivery-work-v1", **owner})
        new_folder = export_root / ("voice-export-" + token)
        new_folder.mkdir()
        folder = new_folder
        _write_json(folder / "owner.json", {"schema": "shengyue-export-v1", **owner})
        encoder = lameenc.Encoder()
        encoder.set_bit_rate(bitrate)
        encoder.set_in_sample_rate(rate)
        encoder.set_out_sample_rate(rate)
        encoder.set_channels(1)
        encoder.set_quality(2)
        records, warnings, frame_cursor, overall_peak, mixed_limited_samples = [], [], 0, 0.0, 0
        mixer = audio_tools.BackgroundMixer(studio, mix, rate)
        with sf.SoundFile(scratch / "merged.wav", "w", samplerate=rate, channels=1, subtype="PCM_16", format="WAV") as merged, (scratch / "merged.mp3").open("xb") as mp3:
            def write(block):
                nonlocal frame_cursor, overall_peak, mixed_limited_samples
                if preview_seconds: block = block[:max(0, output_frames - frame_cursor)]
                if not len(block):
                    return 0.0
                block = mixer.process(block)
                pcm_limit = math.floor(10 ** (PEAK_CEILING_DBFS / 20) * 32768)
                if mix["backgroundId"]: mixed_limited_samples += int(np.count_nonzero(np.abs(block) * 32768 > pcm_limit))
                pcm = np.clip(np.rint(block * 32768), -pcm_limit, pcm_limit).astype("<i2")
                pcm_peak = float(np.abs(pcm.astype("int32")).max()) / 32768
                overall_peak = max(overall_peak, pcm_peak)
                # Use exactly the same PCM samples for WAV and MP3 encoding.
                merged.write(pcm)
                mp3.write(encoder.encode(pcm.tobytes()))
                frame_cursor += len(block)
                return pcm_peak
            previous = None
            for index, entry in enumerate(entries):
                if preview_seconds and frame_cursor >= output_frames: break
                emit("progress", stage="delivery", phase="scan", current=index + 1, total=len(entries), unit="段", message=f"正在检测第{index + 1}/{len(entries)}段音频")
                prepared = _prepare_segment(entry, rate, scratch)
                local_warnings = []
                if prepared["originalClippedSamples"]:
                    local_warnings.append("ORIGINAL_CLIPPING")
                if entry["channels"] == 2:
                    local_warnings.append("STEREO_DOWNMIX")
                if prepared["peak"] == 0:
                    local_warnings.append("SILENT_AUDIO")
                elif not prepared["activeSamples"]:
                    local_warnings.append("NO_ACTIVE_AUDIO")
                gain_db = 0.0
                if settings["normalize"] and prepared["activeRms"]:
                    desired = TARGET_RMS_DBFS - 20 * math.log10(prepared["activeRms"])
                    gain_db = max(-MAX_GAIN_DB, min(MAX_GAIN_DB, desired))
                    if abs(gain_db - desired) > .000001:
                        local_warnings.append("GAIN_LIMITED")
                    gain_db += entry["meta"].get("audioEdit", {}).get("gainDb", 0)
                peak_limit = math.floor(10 ** (PEAK_CEILING_DBFS / 20) * 32768) / 32768
                if prepared["peak"] and prepared["peak"] * 10 ** (gain_db / 20) > peak_limit:
                    gain_db = 20 * math.log10(peak_limit / prepared["peak"])
                    local_warnings.append("PEAK_LIMITED")
                gain = 10 ** (gain_db / 20)
                start, end = 0, prepared["frames"]
                if settings["trimSilence"] and prepared["first"] is not None:
                    padding, cap = round(rate * TRIM_PADDING_MS / 1000), round(rate * MAX_TRIM_MS / 1000)
                    start = min(cap, max(0, prepared["first"] - padding))
                    end = max(prepared["frames"] - cap, min(prepared["frames"], prepared["last"] + padding))
                    protected = entry["meta"].get("inlinePauses", {})
                    if protected.get("leadingMs"):
                        start = 0
                    if protected.get("trailingMs"):
                        end = prepared["frames"]
                pause = pause_frames if previous is not None and previous != entry["group"] else 0
                for offset in range(0, pause, BLOCK_FRAMES):
                    write(np.zeros(min(BLOCK_FRAMES, pause - offset)))
                begin = frame_cursor
                emit("progress", stage="delivery", phase="render", current=index + 1, total=len(entries), unit="段", message=f"正在合成第{index + 1}/{len(entries)}段成品")
                rendered_peak = 0.0
                with sf.SoundFile(prepared["file"]) as source:
                    source.seek(start)
                    remaining = end - start
                    while remaining:
                        block = source.read(min(BLOCK_FRAMES, remaining), dtype="float64")
                        if not len(block):
                            raise ValueError("处理缓存读取不完整")
                        block *= gain
                        rendered_peak = max(rendered_peak, write(block))
                        remaining -= len(block)
                prepared["file"].unlink()
                record = {"id": entry["id"], **entry["meta"], "text": entry["text"], "sourceSampleRate": entry["rate"],
                          "sourceChannels": entry["channels"], "sourceFrames": entry["frames"], "sourceDurationSeconds": entry["frames"] / entry["rate"],
                          "originalPeak": prepared["originalPeak"], "originalPeakDbfs": _db(prepared["originalPeak"]),
                          "originalClippedSamples": prepared["originalClippedSamples"], "activeRmsDbfs": _db(prepared["activeRms"]),
                          "gainDb": round(gain_db, 6), "trimStartFrames": start, "trimEndFrames": prepared["frames"] - end,
                          "trimStartMs": start * 1000 / rate, "trimEndMs": (prepared["frames"] - end) * 1000 / rate,
                          "pauseBeforeFrames": pause, "startFrame": begin, "endFrame": frame_cursor,
                          "startSeconds": begin / rate, "endSeconds": frame_cursor / rate, "durationSeconds": (end - start) / rate,
                          "outputPeak": rendered_peak, "outputPeakDbfs": _db(rendered_peak), "warnings": local_warnings}
                records.append(record)
                warnings.extend({"id": entry["id"], "code": code} for code in local_warnings)
                previous = entry["group"]
            mp3.write(encoder.flush())
        if preview_seconds:
            return {"audio": base64.b64encode((scratch / "merged.wav").read_bytes()).decode("ascii"),
                    "durationSeconds": frame_cursor / rate, "previewSeconds": preview_seconds}
        if frame_cursor > output_frames:
            raise ValueError("成品时长超出预算")
        subtitles = "\n\n".join(f"{i + 1}\n{_srt_time(r['startFrame'], rate)} --> {_srt_time(r['endFrame'], rate)}\n{_srt_text(r['text'])}" for i, r in enumerate(records)) + "\n"
        (scratch / "subtitles.srt").write_text(subtitles, "utf-8")
        effective = {**settings, "channels": 1, "wavSubtype": "PCM_16", "mp3BitRateKbps": bitrate,
                     "targetActiveRmsDbfs": TARGET_RMS_DBFS, "activeGateDbfs": ACTIVE_GATE_DBFS,
                     "analysisWindowMs": 20, "maxNormalizationGainDb": MAX_GAIN_DB, "peakCeilingDbfs": PEAK_CEILING_DBFS,
                     "trimGateDbfs": TRIM_GATE_DBFS, "trimPaddingMs": TRIM_PADDING_MS, "maxTrimPerEdgeMs": MAX_TRIM_MS}
        if mixed_limited_samples: warnings.append({"code": "MIX_PEAK_LIMITED", "samples": mixed_limited_samples})
        quality = {"clippedSourceSegments": sum("ORIGINAL_CLIPPING" in r["warnings"] for r in records),
                   "silentSegments": sum("SILENT_AUDIO" in r["warnings"] for r in records),
                   "peakLimitedSegments": sum("PEAK_LIMITED" in r["warnings"] for r in records),
                   "outputPeak": overall_peak, "outputPeakDbfs": _db(overall_peak), "mixedPeakLimitedSamples": mixed_limited_samples}
        report = {"schema": "shengyue-delivery-v1", "settings": effective, "mix": mix, "scope": scope, "count": len(records), "durationFrames": frame_cursor,
                  "durationSeconds": frame_cursor / rate, "quality": quality, "warnings": warnings, "notes": DISCLAIMER,
                  "warningDescriptions": {"ORIGINAL_CLIPPING": "原音频样本到达满刻度，可能已有削波；处理不能恢复已丢失波形。",
                    "SILENT_AUDIO": "整段静音，保留原时长，不自动放大或删除。", "NO_ACTIVE_AUDIO": "未达到有效声段能量门限，未自动放大。",
                    "STEREO_DOWNMIX": "立体声按左右声道平均转为单声道，请试听相位抵消。", "GAIN_LIMITED": "RMS目标受正负12dB增益范围限制。",
                    "PEAK_LIMITED": "为满足PCM样本峰值上限降低固定增益，RMS目标可能未达到。",
                    "MIX_PEAK_LIMITED": "混音超过样本峰值上限，已执行峰值保护；建议降低音乐或人声音量后重新导出并试听。"}, "segments": records}
        manifest = {"schema": "shengyue-delivery-manifest-v1", "audio": ["merged.wav", "merged.mp3"], "subtitles": "subtitles.srt",
                    "report": "report.json", "scope": scope, "sampleRate": rate, "durationFrames": frame_cursor, "segments": []}
        archive_path = folder / "archive.zip"
        with zipfile.ZipFile(archive_path, "x", zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            for index, (entry, record) in enumerate(zip(entries, records)):
                emit("progress", stage="delivery", phase="zip", current=index + 1, total=len(entries), unit="段", message=f"正在整理第{index + 1}/{len(entries)}段交付清单")
                backup = f"segments/{index + 1:05d}-{entry['id']}.wav" if settings["includeSegments"] else None
                digest = hashlib.sha256()
                with _source_open(entry) as source:
                    with archive.open(backup, "w", force_zip64=True) if backup else contextlib.nullcontext() as output:
                        while True:
                            chunk = source.read(1024 * 1024)
                            if not chunk:
                                break
                            digest.update(chunk)
                            if output is not None:
                                output.write(chunk)
                manifest["segments"].append({"order": index, **record, "sourceSha256": digest.hexdigest(), "originalWav": backup})
            _write_json(scratch / "report.json", report)
            _write_json(scratch / "manifest.json", manifest)
            for name in ("merged.wav", "merged.mp3", "subtitles.srt", "report.json", "manifest.json"):
                archive.write(scratch / name, name)
            status = "节选成品：本包跳过了部分台词。" if scope["partial"] else "本包包含所选范围的全部台词。"
            readme = "\n".join([
                "声悦成品交付说明", "", scope["projectName"] + " · " + scope["scopeLabel"], status,
                f"范围共{scope['totalLines']}句；导出{scope['exportedLines']}句、{len(records)}段；跳过{scope['skippedLines']}句。",
                f"WAV实际时长：{frame_cursor / rate:.3f}秒；{rate}Hz，单声道16位PCM。",
                f"MP3：{bitrate}kbps，单声道。字幕以WAV时间轴为准。", "",
                "merged.wav / merged.mp3：处理后成品音频。", "subtitles.srt：按原始分段文本生成的字幕。",
                "report.json：处理设置、每段增益/裁剪/时间轴/峰值与质量警告。",
                "manifest.json：原文、章节与台词关系、原音频SHA-256和备份对应关系。",
                "segments/：未经处理、逐字节保留的原始WAV备份。" if settings["includeSegments"] else "本包未包含原始分段音频备份。",
                "", "处理设置：",
                ("开启RMS均衡。" if settings["normalize"] else "关闭RMS均衡，仍保留PCM样本峰值保护，可能降低音量。"),
                f"以20毫秒窗口、{ACTIVE_GATE_DBFS:g}dBFS能量门限选择有效声段，目标RMS {TARGET_RMS_DBFS:g}dBFS；均衡固定增益最多正负{MAX_GAIN_DB:g}dB。",
                f"PCM样本峰值上限{PEAK_CEILING_DBFS:g}dBFS；峰值保护可进一步降低增益。请以试听为准。",
                (f"开启保守首尾静音裁剪，保留{TRIM_PADDING_MS}毫秒余量，每端最多裁{MAX_TRIM_MS}毫秒；全静音保留原时长。"
                 if settings["trimSilence"] else "保留原始首尾静音。"),
                f"不同台词间额外加入{settings['pauseMs']}毫秒静音；同一句的自动拆分段之间不添加停顿。",
                "", DISCLAIMER, "",
                f"发现{quality['clippedSourceSegments']}段原音频接近/达到满刻度、{quality['silentSegments']}段全静音、{quality['peakLimitedSegments']}段触发峰值保护。",
                "请查看report.json中的逐段警告并试听；处理不能替代读音校对。", ""
            ])
            archive.writestr("README.txt", readme)
        result = {"path": str(archive_path), "count": len(records), "durationSeconds": frame_cursor / rate,
                  "warnings": warnings, "quality": quality, "sampleRate": rate}
        success = True
        return result
    finally:
        if mixer: mixer.close()
        # BaseException/KeyboardInterrupt follows this path. A hard-killed worker
        # is cleaned by the service using this token and these exact owner schemas.
        _owned_cleanup(scratch, WORK_FILES)
        if not success:
            _owned_cleanup(folder, {"owner.json", "archive.zip"})
