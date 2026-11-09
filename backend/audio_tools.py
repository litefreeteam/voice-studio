"""Local, non-destructive audio editing, quality checks and background mixing."""
from __future__ import annotations

import gc
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import time
import uuid

import numpy as np
import soundfile as sf

EDIT_DEFAULTS = {"trimStartMs": 0, "trimEndMs": 0, "gainDb": 0, "fadeInMs": 0, "fadeOutMs": 0}
MIX_DEFAULTS = {"backgroundId": "", "gainDb": -20, "loop": True, "ducking": True, "offsetMs": 0}
ID = re.compile(r"[a-f0-9]{32}")
QUALITY_LABELS = {"SILENT_AUDIO": "没有检测到有效声音", "LOW_LEVEL": "声音较轻，请试听",
                  "CLIPPING": "波形可能削波", "LONG_INTERNAL_SILENCE": "句中有较长静音，请核对",
                  "LONG_EDGE_SILENCE": "首尾静音较长", "DURATION_OUTLIER": "时长与文稿差异较大，请核对"}


def atomic_json(file, value):
    temporary = file.with_name(file.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False), "utf-8")
        os.replace(temporary, file)
    finally:
        temporary.unlink(missing_ok=True)


def valid_id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError("音频标识无效")
    return value


def checked_file(root, folder, identifier, name):
    valid_id(identifier)
    if not isinstance(name, str) or Path(name).name != name:
        raise ValueError("音频文件名无效")
    base = Path(root) / folder
    directory = base / identifier
    file = directory / name
    if base.is_symlink() or directory.is_symlink() or file.is_symlink() or not file.is_file():
        raise ValueError("音频文件不存在或路径无效")
    return file


def item_for(studio, identifier):
    valid_id(identifier)
    item = next((item for item in studio.history() if item["id"] == identifier), None)
    if item is None:
        raise ValueError("音频记录不存在")
    return item


def effective_item(item, original=False):
    result = dict(item)
    if not original and item.get("edit") and item.get("editedWav"):
        result.update(wav=item["editedWav"], mp3=item["editedMp3"], duration=item["editedDuration"])
    return result


def quality(audio, rate, text=""):
    """Signal heuristics, deliberately separate from semantic speech accuracy."""
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    if not len(audio) or not np.isfinite(audio).all() or rate <= 0:
        raise ValueError("音频为空或包含无效采样")
    peak = float(np.abs(audio).max())
    rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))
    window = max(1, int(rate * .02))
    count = math.ceil(len(audio) / window)
    energies = np.array([np.sqrt(np.mean(audio[i:i + window].astype(np.float64) ** 2)) for i in range(0, len(audio), window)])
    # Relative gate avoids classifying an entire quiet recording as silence.
    gate = max(10 ** (-55 / 20), min(10 ** (-40 / 20), float(energies.max()) * .06))
    active = np.flatnonzero(energies >= gate)
    leading = float(active[0] * .02) if len(active) else len(audio) / rate
    trailing = max(0, len(audio) / rate - (active[-1] + 1) * .02) if len(active) else 0
    longest = 0
    if len(active) > 1:
        longest = max(0, int(np.diff(active).max()) - 1) * .02
    clipped = int(np.count_nonzero(np.abs(audio) >= .999))
    flags = []
    if peak < .001 or not len(active): flags.append("SILENT_AUDIO")
    elif rms < .008: flags.append("LOW_LEVEL")
    if clipped >= max(3, int(len(audio) * .0005)): flags.append("CLIPPING")
    if longest >= 2.0: flags.append("LONG_INTERNAL_SILENCE")
    if leading >= 1.5 or trailing >= 2.0: flags.append("LONG_EDGE_SILENCE")
    units = len(re.findall(r"[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]", text))
    words = len(re.findall(r"[A-Za-z0-9]+", text))
    estimate = units / 4 + words / 2.5
    duration = len(audio) / rate
    if estimate >= 3 and (duration > estimate * 3 + 5 or duration < estimate * .3): flags.append("DURATION_OUTLIER")
    return {"schema": "shengyue-audio-quality-1", "flags": flags, "messages": [QUALITY_LABELS[key] for key in flags],
            "duration": duration, "peak": peak, "rmsDbfs": round(20 * math.log10(rms), 2) if rms else None,
            "clippedSamples": clipped, "leadingSilenceSeconds": round(leading, 3),
            "trailingSilenceSeconds": round(trailing, 3), "longestInternalSilenceSeconds": round(longest, 3),
            "review": bool(flags), "semanticCheck": False}


def edit_settings(raw, duration):
    if not isinstance(raw, dict) or set(raw) - set(EDIT_DEFAULTS):
        raise ValueError("波形编辑参数无效")
    result = {**EDIT_DEFAULTS, **raw}
    for key, value in result.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("波形编辑参数必须是有效数字")
        if key == "gainDb":
            if not -40 <= value <= 12: raise ValueError("人声音量应为 -40 至 12 dB")
        elif not 0 <= value <= duration * 1000:
            raise ValueError("裁剪和淡入淡出不能超过音频时长")
    remaining = duration * 1000 - result["trimStartMs"] - result["trimEndMs"]
    if remaining < 50: raise ValueError("裁剪后至少保留 0.05 秒音频")
    if result["fadeInMs"] + result["fadeOutMs"] > remaining:
        raise ValueError("淡入与淡出总时长不能超过保留片段")
    return result


def edited_audio(audio, rate, settings):
    settings = edit_settings(settings, len(audio) / rate)
    start = round(settings["trimStartMs"] * rate / 1000)
    end = len(audio) - round(settings["trimEndMs"] * rate / 1000)
    result = np.array(audio[start:end], dtype=np.float32, copy=True)
    result *= 10 ** (settings["gainDb"] / 20)
    for field, reverse in (("fadeInMs", False), ("fadeOutMs", True)):
        frames = min(len(result), round(settings[field] * rate / 1000))
        if frames:
            ramp = np.linspace(0, 1, frames, dtype=np.float32)
            if reverse: result[-frames:] *= ramp[::-1]
            else: result[:frames] *= ramp
    peak = float(np.abs(result).max())
    limited = peak > .98
    if limited: result *= .98 / peak
    return result, limited


def encode(file, audio, rate):
    import lameenc
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(192); encoder.set_in_sample_rate(rate); encoder.set_channels(1); encoder.set_quality(2)
    temporary = file.with_name(file.name + "-" + uuid.uuid4().hex)
    try:
        sf.write(temporary.with_suffix(".wav"), audio, rate, subtype="PCM_16", format="WAV")
        temporary.with_suffix(".mp3").write_bytes(encoder.encode((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()) + encoder.flush())
        os.replace(temporary.with_suffix(".wav"), file.with_suffix(".wav"))
        os.replace(temporary.with_suffix(".mp3"), file.with_suffix(".mp3"))
    finally:
        temporary.with_suffix(".wav").unlink(missing_ok=True); temporary.with_suffix(".mp3").unlink(missing_ok=True)


def save_edit(studio, data):
    item = item_for(studio, data.get("id"))
    source = checked_file(studio.root, "outputs", item["id"], item["wav"])
    audio, rate = sf.read(source, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    settings = edit_settings(data.get("edit", {}), len(audio) / rate)
    result, limited = edited_audio(audio, rate, settings)
    key = hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()[:16]
    name = "edit-" + key
    file = source.parent / name
    encode(file, result, rate)
    updated = {**item, "edit": settings, "editedWav": name + ".wav", "editedMp3": name + ".mp3",
               "editedDuration": len(result) / rate, "editPeakLimited": limited, "editedQuality": quality(result, rate, item.get("text", ""))}
    atomic_json(source.parent / "metadata.json", updated)
    atomic_json(studio.history_file, [updated if row["id"] == item["id"] else row for row in studio.history()])
    # Keep only the current render; the immutable source supports restoring any edit.
    for old in source.parent.glob("edit-*.*"):
        if old.name not in (updated["editedWav"], updated["editedMp3"]): old.unlink(missing_ok=True)
    return updated


def inspect_item(studio, data):
    item = item_for(studio, data.get("id"))
    current = effective_item(item)
    file = checked_file(studio.root, "outputs", item["id"], current["wav"])
    audio, rate = sf.read(file, dtype="float32", always_2d=True)
    report = quality(audio, rate, item.get("text", ""))
    updated = {**item, "editedQuality" if item.get("edit") else "quality": report}
    atomic_json(file.parent / "metadata.json", updated)
    atomic_json(studio.history_file, [updated if row["id"] == item["id"] else row for row in studio.history()])
    return updated


def import_background(studio, data):
    source = Path(data["path"])
    if source.stat().st_size > 80 * 1024 ** 2: raise ValueError("背景音乐最多 80 MB")
    info = sf.info(source)
    if not .1 <= info.duration <= 1200: raise ValueError("背景音乐应为 0.1 秒至 20 分钟")
    if info.samplerate > 192000 or info.channels > 8 or info.frames * info.channels > 120000000:
        raise ValueError("音乐解码后的数据过大，请先缩短或转换为普通采样率音频")
    identifier = uuid.uuid4().hex
    folder = studio.root / "mix-assets" / identifier
    if folder.parent.is_symlink(): raise ValueError("音乐保存目录无效")
    folder.mkdir(parents=True)
    try:
        audio, rate = sf.read(source, dtype="float32", always_2d=True)
        if not np.isfinite(audio).all(): raise ValueError("背景音乐包含无效采样")
        sf.write(folder / "audio.wav", audio.mean(axis=1), rate, subtype="PCM_16")
        item = {"id": identifier, "name": source.stem[:80], "duration": len(audio) / rate}
        atomic_json(folder / "metadata.json", item)
        return item
    except Exception:
        shutil.rmtree(folder)
        raise


def backgrounds(studio):
    base = studio.root / "mix-assets"
    if base.is_symlink(): return []
    result = []
    for file in base.glob("*/metadata.json"):
        try:
            item = json.loads(file.read_text("utf-8"))
            checked_file(studio.root, "mix-assets", item["id"], "audio.wav")
            result.append(item)
        except (OSError, ValueError, KeyError): pass
    return result


def mix_settings(raw):
    if not isinstance(raw, dict) or set(raw) - set(MIX_DEFAULTS): raise ValueError("混音设置无效")
    result = {**MIX_DEFAULTS, **raw}
    if result["backgroundId"]: valid_id(result["backgroundId"])
    if type(result["loop"]) is not bool or type(result["ducking"]) is not bool: raise ValueError("混音开关无效")
    for key, minimum, maximum in (("gainDb", -60, 0), ("offsetMs", 0, 3600000)):
        value = result[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
            raise ValueError("音乐音量或开始时间无效")
    return result


class BackgroundMixer:
    """Bounded-memory, deterministic mixing shared by preview and delivery."""
    def __init__(self, studio, raw, rate):
        self.settings = mix_settings(raw or {})
        self.rate, self.cursor, self.envelope = rate, 0, 1.0
        self.source = None
        self.offset = round(self.settings["offsetMs"] * rate / 1000)
        if self.settings["backgroundId"]:
            file = checked_file(studio.root, "mix-assets", self.settings["backgroundId"], "audio.wav")
            self.source = sf.SoundFile(file)
            if self.source.frames < 1: self.close(); raise ValueError("背景音乐为空")
        self.gain = 10 ** (self.settings["gainDb"] / 20)

    def process(self, block):
        block = np.asarray(block, dtype=np.float64).reshape(-1)
        if self.source is None:
            self.cursor += len(block)
            return block
        output = block.copy()
        # Fixed 10 ms analysis boundaries, independent of caller block sizes.
        step = max(1, self.rate // 100)
        index = 0
        while index < len(block):
            size = min(step - self.cursor % step, len(block) - index)
            voice = block[index:index + size]
            positions = (np.arange(size) + self.cursor - self.offset) * self.source.samplerate / self.rate
            active = positions >= 0
            if not self.settings["loop"]: active &= positions < self.source.frames
            music = np.zeros(size)
            if active.any():
                wanted = positions[active]
                if self.settings["loop"]: wanted %= self.source.frames
                # At most one wrap per 10 ms for normal music; support very short clips as well.
                lower = np.floor(wanted).astype(np.int64)
                values = np.zeros(len(lower)); upper_values = np.zeros(len(lower))
                for begin in range(0, len(lower), 4096):
                    indexes = lower[begin:begin + 4096]
                    lo, hi = int(indexes.min()), int(indexes.max())
                    if hi - lo <= 8192:
                        self.source.seek(lo); samples = self.source.read(min(hi - lo + 2, self.source.frames - lo), dtype="float64", always_2d=True).mean(axis=1)
                        values[begin:begin + len(indexes)] = samples[indexes - lo]
                        upper = indexes + 1
                        upper_values[begin:begin + len(indexes)] = samples[np.minimum(upper - lo, len(samples) - 1)]
                        if self.settings["loop"] and (upper >= self.source.frames).any():
                            self.source.seek(0); first = float(self.source.read(1, dtype="float64", always_2d=True).mean())
                            section = upper_values[begin:begin + len(indexes)]; section[upper >= self.source.frames] = first
                    else:
                        for j, position in enumerate(indexes):
                            self.source.seek(int(position)); pair = self.source.read(2, dtype="float64", always_2d=True).mean(axis=1)
                            values[begin + j] = pair[0]; upper_values[begin + j] = pair[-1]
                music[active] = values + (upper_values - values) * (wanted - lower)
            target = .25 if self.settings["ducking"] and np.sqrt(np.mean(voice ** 2)) > .008 else 1.0
            tau = .04 if target < self.envelope else .3
            alpha = np.exp(-np.arange(1, size + 1) / (self.rate * tau))
            envelope = target + (self.envelope - target) * alpha
            self.envelope = float(envelope[-1])
            output[index:index + size] += music * self.gain * envelope
            self.cursor += size; index += size
        return output

    def close(self):
        if self.source is not None: self.source.close(); self.source = None


def selections(studio):
    try:
        value = json.loads((studio.root / "audio-selections.json").read_text("utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError): return {}


def select_version(studio, data):
    root_id = valid_id(data.get("groupId")); item = item_for(studio, data.get("id"))
    if item["id"] != root_id and item.get("options", {}).get("generationGroupId") != root_id:
        raise ValueError("此音频不属于所选版本组")
    value = selections(studio); value[root_id] = item["id"]
    atomic_json(studio.root / "audio-selections.json", value)
    return value
