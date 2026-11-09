"""Staged reference import and optional, offline CPU transcription."""
import gc
import json
from pathlib import Path
import shutil
import time
import uuid

import numpy as np
import soundfile as sf

import importlib.util

def _local(name):
    spec = importlib.util.spec_from_file_location("shengyue_" + name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

audio_tools = _local("audio_tools")
downloads = _local("downloads")

MANIFEST_FILE = Path(__file__).parent.parent / "shared/transcription-manifest.json"


def model_status(studio):
    manifest = json.loads(MANIFEST_FILE.read_text("utf-8"))
    folder = studio.assets / "models" / "reference-transcription"
    ready = False
    try:
        marker = json.loads((folder / ".complete.json").read_text("utf-8"))
        ready = marker.get("repo") == manifest["repo"] and marker.get("revision") == manifest["revision"] and marker.get("weights") == manifest["weights"] and all(
            (folder / name).is_file() and (folder / name).stat().st_size == spec["size"]
            for name, spec in manifest["files"].items())
    except (OSError, ValueError, KeyError): pass
    return {"ready": ready, "bytes": sum(spec["size"] for spec in manifest["files"].values())}


def download(studio, emit):
    manifest = json.loads(MANIFEST_FILE.read_text("utf-8"))
    folder = studio.assets / "models" / "reference-transcription"
    downloads.download_model(folder, manifest["repo"], manifest, emit)
    return model_status(studio)


def staged_file(studio, token):
    return audio_tools.checked_file(studio.root, ".reference-imports", token, "audio.wav")


def open_reference(studio, data):
    if data.get("consent") is not True: raise ValueError("请确认你拥有参考声音的使用授权")
    source = Path(data["path"])
    if source.stat().st_size > 30 * 1024 ** 2: raise ValueError("参考录音最多 30 MB")
    info = sf.info(source)
    if not 3 <= info.duration <= 600: raise ValueError("录音应为 3 秒至 10 分钟，请选取其中 3–30 秒清晰人声")
    if info.samplerate > 192000 or info.channels > 8 or info.frames * info.channels > 60000000:
        raise ValueError("录音解码后的数据过大，请先缩短或转换为普通单声道音频")
    audio, rate = sf.read(source, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if not np.isfinite(audio).all(): raise ValueError("录音包含无效采样")
    if rate != 24000:
        from scipy.signal import resample_poly
        from math import gcd
        divisor = gcd(rate, 24000); audio = resample_poly(audio, 24000 // divisor, rate // divisor); rate = 24000
    token = uuid.uuid4().hex
    parent = studio.root / ".reference-imports"
    if parent.is_symlink(): raise ValueError("录音暂存目录无效")
    parent.mkdir(exist_ok=True)
    # Stale imports have no user material beyond a disposable copy of the source.
    for old in parent.iterdir():
        if old.is_dir() and not old.is_symlink() and time.time() - old.stat().st_mtime > 86400:
            shutil.rmtree(old)
    folder = parent / token; folder.mkdir()
    try:
        sf.write(folder / "audio.wav", audio, rate, subtype="PCM_16")
        return {"token": token, "name": source.stem[:48], "duration": len(audio) / rate,
                "quality": audio_tools.quality(audio[:30 * rate], rate), "transcription": model_status(studio)}
    except Exception:
        shutil.rmtree(folder); raise


def selection(studio, data):
    file = staged_file(studio, data.get("token"))
    info = sf.info(file)
    start, end = data.get("startMs", 0), data.get("endMs", min(info.duration * 1000, 30000))
    for value in (start, end):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value): raise ValueError("录音选区无效")
    if not 0 <= start < end <= info.duration * 1000 + .01 or not 3000 <= end - start <= 30000.01:
        raise ValueError("请选择 3–30 秒的清晰人声")
    with sf.SoundFile(file) as source:
        source.seek(round(start * source.samplerate / 1000))
        audio = source.read(round((end - start) * source.samplerate / 1000), dtype="float32")
    return audio, info.samplerate


def transcribe(studio, data, emit):
    audio, rate = selection(studio, data)
    if not model_status(studio)["ready"]: raise ValueError("请先准备本地识别资源，或手动填写录音原话")
    # Keep TTS and STT models out of memory at the same time.
    studio.model = None; studio.loaded_key = None; gc.collect()
    if getattr(studio, "is_mlx", False):
        import mlx.core as mx
        mx.clear_cache()
    from scipy.signal import resample_poly
    audio = resample_poly(audio, 2, 3)  # stored references are 24 kHz; Whisper takes 16 kHz
    from faster_whisper import WhisperModel
    emit("progress", stage="transcribing", message="正在本机识别录音原话…")
    model = WhisperModel(str(studio.assets / "models/reference-transcription"), device="cpu", compute_type="int8",
                         cpu_threads=4, local_files_only=True)
    try:
        language = data.get("language", "zh")
        if language not in ("zh", "en", "ja", "ko", "auto"): raise ValueError("识别语言无效")
        segments, info = model.transcribe(audio, language=None if language == "auto" else language,
                                         beam_size=5, condition_on_previous_text=False, vad_filter=True)
        text = "".join(segment.text for segment in segments).strip()
        if not text: raise ValueError("没有识别出原话，请选择更清晰的人声或手动填写")
        return {"text": text[:1000], "language": info.language, "quality": audio_tools.quality(audio, 16000)}
    finally:
        del model; gc.collect()


def commit(studio, data):
    if data.get("consent") is not True: raise ValueError("请确认你拥有参考声音的使用授权")
    name, text = data.get("name", ""), data.get("text", "")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 48: raise ValueError("请填写 1–48 字的声音名称")
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 1000: raise ValueError("请核对并填写录音原话，最多 1000 字")
    audio, rate = selection(studio, data)
    report = audio_tools.quality(audio, rate)
    if "SILENT_AUDIO" in report["flags"]: raise ValueError("所选录音没有有效声音，请重新选取")
    source = staged_file(studio, data["token"])
    selected = source.parent / "selected.wav"
    sf.write(selected, audio, rate, subtype="PCM_16")
    try:
        result = studio.import_reference({"path": str(selected), "name": name.strip(), "text": text.strip(), "consent": True})
        result["quality"] = report
        audio_tools.atomic_json(studio.references / (result["id"] + ".json"), result)
        shutil.rmtree(source.parent)
        return result
    finally:
        selected.unlink(missing_ok=True)


def cancel(studio, data):
    token = audio_tools.valid_id(data.get("token"))
    base = studio.root / ".reference-imports"; folder = base / token
    if base.is_symlink() or folder.is_symlink(): raise ValueError("录音暂存目录无效")
    if folder.exists(): shutil.rmtree(folder)
    return {"cancelled": True}
