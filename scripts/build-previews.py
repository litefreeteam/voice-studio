"""Build-time recording of bundled demos; never called by the consumer application.

Run with the installed voice environment's Python:
  python scripts/build-previews.py --models-dir "/path/to/Voice Studio/models"
Existing recordings with matching text/voice settings and hashes are reused.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def master_preview(wav, destination, recipe):
    """Match audition levels and trim excess edge silence, preserving speech dynamics."""
    import numpy as np
    import soundfile as sf
    import lameenc
    audio, rate = sf.read(wav, dtype="float32")
    window = max(1, rate // 100)
    frames = np.pad(audio, (0, (-len(audio)) % window)).reshape(-1, window)
    levels = np.sqrt(np.mean(frames * frames, axis=1))
    active = np.flatnonzero(levels > max(.001, float(levels.max()) * .015))
    if not active.size:
        raise ValueError("试听音频没有可用的人声")
    padding = round(rate * recipe["paddingMs"] / 1000)
    start = max(0, int(active[0]) * window - padding)
    end = min(len(audio), (int(active[-1]) + 1) * window + padding)
    audio = audio[start:end].copy()
    rms = float(np.sqrt(np.mean(audio * audio)))
    gain = min(10 ** (recipe["targetRmsDb"] / 20) / max(rms, 1e-6), recipe["peak"] / max(float(np.max(np.abs(audio))), 1e-6))
    audio *= gain
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(192); encoder.set_in_sample_rate(rate); encoder.set_channels(1); encoder.set_quality(2)
    destination.write_bytes(encoder.encode((audio * 32767).astype("<i2").tobytes()) + encoder.flush())
    return round(len(audio) / rate, 3)


def build(models_dir, destination, license_file=None, voice_keys=None):
    spec = importlib.util.spec_from_file_location("worker", ROOT / "backend/worker.py")
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    catalog = json.loads((ROOT / "shared/catalog.json").read_text("utf-8"))
    known = {mode + ":" + voice["id"] for mode, entries in [("preset", catalog["voices"]), ("design", catalog["characters"])] for voice in entries}
    selected = set(voice_keys) if voice_keys else known
    if selected - known:
        raise ValueError("试听声音不存在：" + ", ".join(sorted(selected - known)))
    destination.mkdir(parents=True, exist_ok=True)
    manifest_file = destination / "manifest.json"
    manifest = json.loads(manifest_file.read_text("utf-8")) if manifest_file.exists() else {"schema": "shengyue-previews-1", "items": {}}
    with tempfile.TemporaryDirectory(prefix="shengyue-previews-") as temp:
        stage = Path(temp)
        if license_file:
            shutil.copyfile(license_file, stage / "license.txt")
        (stage / "models").symlink_to(models_dir.resolve(), target_is_directory=True)
        studio = worker.Studio(stage)
        for mode, entries in [("preset", catalog["voices"]), ("design", catalog["characters"])]:
            for voice in entries:
                key = mode + ":" + voice["id"]
                if key not in selected:
                    continue
                options = {"mode": mode, "speaker": voice["id"] if mode == "preset" else "Vivian",
                           "language": voice.get("language", "Chinese"), "text": voice["preview"]["text"],
                           "sampleRate": 24000, "prefix": voice["id"], "voiceName": voice["name"],
                           "scene": "dialogue", "emotion": "natural", "engine": "standard"}
                if mode == "design":
                    options["character"] = voice["id"]
                options.update({key: voice["preview"][key] for key in ("scene", "emotion", "pace", "intensity") if key in voice["preview"]})
                fingerprint_data = {"options": options, "prompt": voice.get("prompt")}
                if mode == "preset" and voice.get("stylePrompt"):
                    fingerprint_data["stylePrompt"] = voice["stylePrompt"]
                if voice.get("reference"):
                    fingerprint_data["reference"] = voice["reference"]
                recipe = voice["preview"].get("mastering")
                if recipe:
                    fingerprint_data["mastering"] = recipe
                fingerprint = hashlib.sha256(json.dumps(fingerprint_data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                file = destination / (voice["id"] + ".mp3")
                previous = manifest["items"].get(key, {})
                if previous.get("fingerprint") == fingerprint and file.is_file() and previous.get("sha256") == hashlib.sha256(file.read_bytes()).hexdigest():
                    print("Reusing " + key, flush=True)
                    continue
                temporary = file.with_suffix(".tmp")
                if voice.get("reference"):
                    # The audition is the selected voice, not a newly randomized take.
                    import soundfile as sf
                    studio.bundled_voice_sample({**options, "voiceDescription": voice["prompt"]})
                    source = ROOT / "backend" / voice["reference"]["file"]
                    shutil.copyfile(source, temporary)
                    duration = round(sf.info(source).duration, 3)
                else:
                    item = studio.generate(options)["items"][0]
                    source = studio.outputs / item["id"] / item["mp3"]
                    duration = master_preview(studio.outputs / item["id"] / item["wav"], temporary, recipe) if recipe else item["duration"]
                    if not recipe:
                        shutil.copyfile(source, temporary)
                temporary.replace(file)
                manifest["items"][key] = {"file": file.name, "text": options["text"], "duration": duration,
                                          "language": options["language"], "fingerprint": fingerprint,
                                          "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
                temporary_manifest = manifest_file.with_suffix(".tmp")
                temporary_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8")
                temporary_manifest.replace(manifest_file)
                print("Recorded " + key, flush=True)
    if destination.resolve() == (ROOT / "ui/assets/previews").resolve():
        for mode, entries in [("preset", catalog["voices"]), ("design", catalog["characters"])]:
            for voice in entries:
                if mode + ":" + voice["id"] not in selected:
                    continue
                recording = manifest["items"][mode + ":" + voice["id"]]
                voice["preview"].update(duration=recording["duration"], sha256=recording["sha256"])
        (ROOT / "shared/catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", "utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "ui/assets/previews")
    parser.add_argument("--license-file", type=Path, help="本机有效的离线授权文件；新录制试听也必须验权")
    parser.add_argument("--voice", action="append", help="只更新指定试听，如 preset:Vivian；可重复传入")
    args = parser.parse_args()
    build(args.models_dir, args.output_dir, args.license_file, args.voice)
