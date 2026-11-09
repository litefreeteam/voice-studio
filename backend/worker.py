"""JSON-lines sidecar. Network is used only by the explicit download command."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import sys
import time
import traceback
import uuid
import zipfile
import gc
import base64
import subprocess
import importlib.util
import unicodedata
import tempfile

# Isolated Python (-I) does not add the script directory to sys.path.
_downloads_spec = importlib.util.spec_from_file_location("shengyue_downloads", Path(__file__).with_name("downloads.py"))
_downloads = importlib.util.module_from_spec(_downloads_spec)
_downloads_spec.loader.exec_module(_downloads)

_local_modules = {}
def local_module(name):
    if name not in _local_modules:
        spec = importlib.util.spec_from_file_location("shengyue_" + name, Path(__file__).with_name(name + ".py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _local_modules[name] = module
    return _local_modules[name]

# Pinned inside the integrity-checked ASAR, not loaded from a replaceable PEM.
PUBLIC_KEY_PEM = b"""-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAEk8mRmKZHCyEGPMx6wPtZB52JQ/bUpkr3mZgybyxCbU=
-----END PUBLIC KEY-----
"""


class LicenseRequiredError(RuntimeError):
    code = "LICENSE_REQUIRED"


def machine_code(root):
    try:
        if sys.platform == "darwin":
            value = re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"', subprocess.check_output(
                ["/usr/sbin/ioreg", "-rd1", "-c", "IOPlatformExpertDevice"], text=True, timeout=5)).group(1)
        elif sys.platform == "win32":
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography", 0,
                                winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
                value = winreg.QueryValueEx(key, "MachineGuid")[0]
        else:
            # Development-only platforms keep the same identity convention as Node.
            value = (Path(root) / "installation-id").read_text("utf-8")
        return "SYD1-" + hashlib.sha256(("shengyue:" + value.strip().lower()).encode()).hexdigest()[:32].upper()
    except (OSError, ValueError, AttributeError, subprocess.SubprocessError) as error:
        raise LicenseRequiredError("无法读取本机设备标识，请检查系统权限后重试") from error


ACTIVATION_REQUIRED = json.loads((Path(__file__).parent.parent / "shared" / "edition.json").read_text("utf-8"))["activationRequired"]

def require_license(root):
    """Free releases need no device identity or activation, including direct CLI work."""
    if not ACTIVATION_REQUIRED:
        return
    try:
        with (Path(root) / "license.txt").open("rb") as source:
            raw = source.read(513)
        if len(raw) > 512:
            raise ValueError("invalid length")
        code = re.sub(r"\s", "", raw.decode("utf-8"))
        if not re.fullmatch(r"SY2\.[A-Za-z0-9_-]{86}", code):
            raise ValueError("invalid format")
        encoded = code[4:]
        signature = base64.urlsafe_b64decode(encoded + "==")
        if len(signature) != 64 or base64.urlsafe_b64encode(signature).decode().rstrip("=") != encoded:
            raise ValueError("noncanonical signature")
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        key = load_pem_public_key(PUBLIC_KEY_PEM)
        if not isinstance(key, Ed25519PublicKey):
            raise ValueError("invalid trust anchor")
        message = f"shengyue:offline:pro:perpetual:v2:{machine_code(root)}".encode()
        try:
            key.verify(signature, message)
        except InvalidSignature as error:
            raise ValueError("invalid signature") from error
    except LicenseRequiredError:
        raise
    except (OSError, ValueError, UnicodeError, ImportError) as error:
        raise LicenseRequiredError("请先激活软件后再使用；授权无效、与本机不匹配或验签组件缺失") from error

PROTOCOL_OUT = sys.stdout
SPEAKERS = {"Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden", "Ono_Anna", "Sohee"}
MODEL_MAC = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit"
MODEL_WIN = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
CATALOG = json.loads((Path(__file__).parent.parent / "shared" / "catalog.json").read_text("utf-8"))
MODEL_MANIFEST = json.loads((Path(__file__).parent.parent / "shared" / "model-manifest.json").read_text("utf-8"))["repositories"]
MODEL_NAMES = {"standard": ("qwen3-custom", "1.7B-CustomVoice", "日常配音"),
               "light": ("voice-light", "0.6B-CustomVoice", "轻松朗读"),
               "character": ("voice-character", "1.7B-VoiceDesign", "人物与童声"),
               "reference": ("voice-reference", "1.7B-Base", "我的专属声音"),
               "expressive": ("voice-expressive", "VoxCPM2", "我的声音·情绪表达")}

# Complete setup text for fixed voices and the legacy short/long first-line fallback.
ANCHOR_TEXT = {
    "Chinese": "清晨，小镇的书店刚刚开门。一位旅人推开木门，把一张泛黄的地图放在柜台上。店主抬头看了看，指向窗外那条通往山里的小路。",
    "English": "The little bookshop opened early that morning. A traveler stepped inside and placed an old map on the counter. The owner looked up and pointed to the narrow path leading into the hills.",
    "Japanese": "朝、小さな町の本屋が店を開けました。旅人が木の扉を押して入り、古い地図をカウンターに広げました。店主は顔を上げて、山へ続く細い道を指さしました。",
    "Korean": "이른 아침, 작은 마을의 서점이 문을 열었어요. 한 여행자가 들어와 낡은 지도를 계산대 위에 펼쳤어요. 주인은 고개를 들어 산으로 이어지는 좁은 길을 가리켰어요.",
    "German": "Am frühen Morgen öffnete die kleine Buchhandlung. Ein Reisender trat ein und legte eine alte Karte auf den Tresen. Der Besitzer blickte auf und zeigte auf den schmalen Weg in die Berge.",
    "French": "La petite librairie ouvrit tôt ce matin-là. Un voyageur entra et posa une vieille carte sur le comptoir. Le libraire leva les yeux et montra le sentier qui menait vers les collines.",
    "Russian": "Рано утром открылся маленький книжный магазин. Путник вошёл и положил старую карту на прилавок. Хозяин поднял глаза и указал на узкую тропинку, ведущую в горы.",
    "Portuguese": "A pequena livraria abriu cedo naquela manhã. Um viajante entrou e colocou um mapa antigo no balcão. O dono levantou os olhos e apontou para o caminho estreito que levava às montanhas.",
    "Spanish": "La pequeña librería abrió temprano aquella mañana. Un viajero entró y puso un mapa antiguo sobre el mostrador. El dueño levantó la vista y señaló el sendero que llevaba hacia las montañas.",
    "Italian": "La piccola libreria aprì presto quella mattina. Un viaggiatore entrò e posò una vecchia mappa sul bancone. Il proprietario alzò lo sguardo e indicò il sentiero che portava verso le montagne.",
}


def locks_project_voice(options):
    return (options.get("mode") == "design" and bool(options.get("projectId"))
            and bool(options.get("roleId")) and options.get("lockVoice", True))


def locks_voice(options):
    return options.get("mode") == "design" and options.get("lockVoice", True)


def voice_anchor_key(options, instruction):
    # Text, line IDs and display names must never change a role's established voice.
    if locks_project_voice(options):
        # Preserve anchors already chosen in existing projects.
        identity = ["first-clip-v1", options["projectId"], options["roleId"],
                    options.get("character"), options.get("language", "Chinese"),
                    instruction, options.get("voiceRevision", "")]
    else:
        # Performance belongs to the chosen sample. Per-line emotion/instruction,
        # queue IDs and display names must not create a different speaker.
        identity = ["fixed-voice-v2", options.get("voiceScopeId") or "default",
                    options.get("voiceId") or options.get("character") or "custom",
                    options.get("voiceDescription", ""), options.get("language", "Chinese"),
                    options.get("voiceRevision", "")]
    return hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()


def emit(kind, **values):
    PROTOCOL_OUT.write(json.dumps({"type": kind, **values}, ensure_ascii=False) + "\n")
    PROTOCOL_OUT.flush()


def validate_request(data):
    if not isinstance(data, dict):
        raise ValueError("请求格式不正确")
    text = data.get("text", "")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("请先输入需要配音的文字")
    if any(0xD800 <= ord(char) <= 0xDFFF for char in text):
        raise ValueError("文案含有不完整的 Unicode 字符，请检查原文")
    if re.search(r"\[\[(?:emotion:|/emotion|cue:)|<#", text):
        raise ValueError("段内标记功能已撤回，请打开文稿恢复普通文字后再生成")
    if len(text) > 5000:
        raise ValueError("每批最多 5000 字；建议拆成较短的句子")
    speaker = data.get("speaker", "Vivian")
    if speaker not in SPEAKERS:
        raise ValueError("音色不存在")
    instruction = data.get("instruction", "")
    if not isinstance(instruction, str) or len(instruction) > 500:
        raise ValueError("表演要求最多 500 字")
    rate = data.get("sampleRate", 48000)
    if rate not in (24000, 44100, 48000):
        raise ValueError("不支持这个采样率")
    # Desktop rows already carry their exact split text. Trimming each row here
    # loses the separators between words in adjacent chunks and in history/SRT.
    lines = [s.strip() for s in text.splitlines() if s.strip()] if data.get("batch") else [text]
    if len(lines) > 100:
        raise ValueError("每批最多 100 条")
    if any(len(s) > 600 for s in lines):
        raise ValueError("单条最多 600 字；长文请按段落换行，并开启逐行生成")
    prefix = data.get("prefix", "voice")
    if not isinstance(prefix, str) or not re.fullmatch(r"[\w\-]{1,48}", prefix, re.UNICODE):
        raise ValueError("文件名前缀限 1–48 个字母、数字、中文、下划线或短横线")
    return lines, speaker, instruction.strip(), rate, prefix


class Studio:
    def __init__(self, data_dir, asset_dir=None):
        self.root = Path(data_dir).resolve()
        self.assets = Path(asset_dir).resolve() if asset_dir else self.root
        self.model_dir = self.assets / "models" / "qwen3-custom"
        self.outputs = self.root / "outputs"
        self.outputs.mkdir(parents=True, exist_ok=True)
        self.history_file = self.root / "history.json"
        self.is_mlx = platform.system() == "Darwin" and platform.machine() == "arm64"
        self.model_id = MODEL_MAC if self.is_mlx else MODEL_WIN
        self.model = None
        self.device = None
        self.loaded_key = None
        self._mlx = None
        self.force_cpu = False
        self.references = self.root / "references"
        self.references.mkdir(exist_ok=True)
        self.voice_anchors = self.root / "voice-anchors"

    def model_info(self, key):
        if key not in MODEL_NAMES:
            raise ValueError("音色包不存在")
        folder, suffix, name = MODEL_NAMES[key]
        if key == "expressive":
            repo = "mlx-community/VoxCPM2-4bit" if self.is_mlx else "openbmb/VoxCPM2"
        else:
            repo = f"mlx-community/Qwen3-TTS-12Hz-{suffix}-4bit" if self.is_mlx else f"Qwen/Qwen3-TTS-12Hz-{suffix}"
        return self.assets / "models" / folder, repo, name

    def model_ready(self, key):
        folder, repo, _ = self.model_info(key)
        try:
            marker = json.loads((folder / ".complete.json").read_text())
            return marker["repo"] == repo and bool(marker["files"]) and all(
                (folder / name).is_file() and (folder / name).stat().st_size == size
                for name, size in marker["files"].items())
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            return False

    def status(self):
        try:
            require_license(self.root)
            activated = True
        except LicenseRequiredError:
            activated = False
        ready = False
        marker = self.model_dir / ".complete.json"
        if marker.exists():
            try:
                m = json.loads(marker.read_text())
                ready = m["repo"] == self.model_id and all(
                    (self.model_dir / name).is_file() and (self.model_dir / name).stat().st_size == size
                    for name, size in m["files"].items()
                ) and bool(m["files"])
            except (OSError, ValueError, KeyError, TypeError):
                pass
        packages = []
        for key in MODEL_NAMES:
            folder, repo, name = self.model_info(key)
            try:
                metadata = json.loads((folder / ".complete.json").read_text("utf-8"))
                pinned = MODEL_MANIFEST[repo]
                verified = (metadata.get("revision") == pinned["revision"] and metadata.get("weights") == pinned["weights"]
                            and all(metadata.get("files", {}).get(filename) == spec["size"] for filename, spec in pinned["files"].items()))
            except (OSError, ValueError, TypeError, AttributeError):
                verified = False
            packages.append({"id": key, "name": name, "ready": self.model_ready(key), "verified": verified})
        return {"modelReady": ready, "model": self.model_id, "packages": packages,
                "engine": "MLX · Apple Silicon" if self.is_mlx else "PyTorch · CUDA / CPU",
                "device": self.device, "history": self.history() if activated else [], "references": self.list_references() if activated else [],
                "backgrounds": local_module("audio_tools").backgrounds(self) if activated else [],
                "audioSelections": local_module("audio_tools").selections(self) if activated else {},
                "transcription": local_module("reference_tools").model_status(self) if activated else {"ready": False}}

    def list_references(self):
        result = []
        for file in self.references.glob("*.json"):
            try:
                item = json.loads(file.read_text("utf-8"))
                if (self.references / (item["id"] + ".wav")).is_file():
                    result.append(item)
            except (OSError, ValueError, KeyError):
                pass
        return result

    def import_reference(self, data):
        require_license(self.root)
        import numpy as np
        import soundfile as sf
        from scipy.signal import resample_poly
        from math import gcd
        source = Path(data["path"])
        if source.stat().st_size > 30 * 1024 * 1024:
            raise ValueError("参考音频最多 30 MB")
        info = sf.info(source)
        if not 3 <= info.duration <= 30:
            raise ValueError("参考音频需要 3–30 秒清晰人声")
        audio, rate = sf.read(source, dtype="float32", always_2d=True)
        audio = np.mean(audio, axis=1)
        if not np.isfinite(audio).all() or np.max(np.abs(audio)) < 0.001:
            raise ValueError("参考音频没有有效人声信号")
        if rate != 24000:
            divisor = gcd(rate, 24000)
            audio = resample_poly(audio, 24000 // divisor, rate // divisor)
        reference_id = uuid.uuid4().hex
        sf.write(self.references / (reference_id + ".wav"), audio, 24000, subtype="PCM_16")
        item = {"id": reference_id, "name": str(data.get("name") or source.stem)[:48],
                "text": str(data.get("text", ""))[:1000], "duration": info.duration,
                "quality": local_module("audio_tools").quality(audio, 24000)}
        (self.references / (reference_id + ".json")).write_text(json.dumps(item, ensure_ascii=False), "utf-8")
        return item

    def update_reference(self, data):
        require_license(self.root)
        reference_id = data.get("id")
        if not isinstance(reference_id, str) or not re.fullmatch(r"[a-f0-9]{32}", reference_id):
            raise ValueError("参考声音不存在")
        if not any(key in data for key in ("text", "name", "note")):
            raise ValueError("请填写需要更新的声音资料")
        for key, limit, label in (("text", 1000, "参考原话"), ("name", 48, "声音名称"), ("note", 240, "备注")):
            if key in data and (not isinstance(data[key], str) or len(data[key]) > limit or key == "name" and not data[key].strip()):
                raise ValueError(f"{label}格式无效，最多 {limit} 字")
        item = next((item for item in self.list_references() if item["id"] == reference_id), None)
        if item is None:
            raise ValueError("参考声音不存在")
        item = {**item, **{key: data[key].strip() for key in ("text", "name", "note") if key in data}}
        if "text" in data:
            item["textUpdatedAt"] = int(time.time() * 1000)
        destination = self.references / (reference_id + ".json")
        temporary = self.references / (reference_id + "." + uuid.uuid4().hex + ".tmp")
        try:
            temporary.write_text(json.dumps(item, ensure_ascii=False), "utf-8")
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
        return item

    def capture_reference(self, data):
        require_license(self.root)
        known = {i["id"]: i for i in self.history()}
        if data.get("id") not in known:
            raise ValueError("音频记录不存在")
        item = known[data["id"]]
        return self.import_reference({"path": str(self.outputs / item["id"] / item["wav"]),
                                      "text": item["text"], "name": data.get("name") or item.get("voiceName", "我的角色")})

    def history(self):
        try:
            items = json.loads(self.history_file.read_text("utf-8"))
            return [i for i in items if (self.outputs / i["id"] / i["wav"]).is_file()]
        except (OSError, ValueError, KeyError):
            return []

    def save_item(self, item):
        history = [item] + self.history()
        tmp = self.history_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(history, ensure_ascii=False, indent=2), "utf-8")
        tmp.replace(self.history_file)

    def download(self, data=None):
        key = (data or {}).get("package", "standard")
        folder, repo, name = self.model_info(key)
        emit("progress", stage="download", message=f"正在获取{name}，请保持网络连接…")
        _downloads.download_model(folder, repo, MODEL_MANIFEST[repo], emit)
        return self.status()

    def load(self, key="standard"):
        if self.model is not None and self.loaded_key == key:
            return
        if not self.model_ready(key):
            raise RuntimeError(f"请先在下载中心安装{self.model_info(key)[2]}")
        self.model = None
        gc.collect()
        if self.is_mlx:
            import mlx.core as mx
            self._mlx = mx
            # MLX otherwise lets unused buffers grow to its device memory limit
            # (about 37 GiB on a 32 GiB Mac). Keep reuse bounded between chunks.
            mx.set_cache_limit(256 * 1024 * 1024)
            mx.clear_cache()
        folder, repo, _ = self.model_info(key)
        # Any accidental library hub requests must fail locally during inference.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        emit("progress", stage="loading", message="正在准备声音，首次载入需要稍等…")
        if self.is_mlx:
            from mlx_audio.tts.utils import load_model
            self.model = load_model(str(folder))
            self.device = "Apple GPU · MLX 4-bit"
        else:
            import torch
            device = "cuda:0" if not self.force_cpu and torch.cuda.is_available() else "cpu"
            if key == "expressive":
                self.model = local_module("reference_expression").load_torch(folder, device)
                self.device = device
                self.loaded_key = key
                self.active_repo = repo
                return
            from qwen_tts import Qwen3TTSModel
            dtype = (torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16) if device != "cpu" else torch.float32
            # Eager attention works with the last official Intel Mac PyTorch (2.2).
            attention = "eager" if platform.system() == "Darwin" else "sdpa"
            try:
                self.model = Qwen3TTSModel.from_pretrained(str(folder), device_map=device,
                                                         dtype=dtype, attn_implementation=attention, local_files_only=True)
            except RuntimeError as error:
                if device == "cpu" or not self.gpu_failure(error):
                    raise
                self.force_cpu = True
                gc.collect()
                torch.cuda.empty_cache()
                emit("progress", stage="loading", message="显卡无法完成载入，正在改用 CPU；速度以试音为准…")
                self.model = Qwen3TTSModel.from_pretrained(str(folder), device_map="cpu", dtype=torch.float32,
                                                         attn_implementation=attention, local_files_only=True)
                device = "cpu"
            self.device = device
        self.loaded_key = key
        self.active_repo = repo

    @staticmethod
    def gpu_failure(error):
        return any(word in str(error).lower() for word in ("out of memory", "cuda", "cudnn", "cublas", "no kernel image"))

    def synthesize(self, text, speaker, instruction, options=None):
        require_license(self.root)
        return self._synthesize_with_fallback(text, speaker, instruction, options)

    def _synthesize_with_fallback(self, text, speaker, instruction, options=None):
        try:
            return self._synthesize(text, speaker, instruction, options)
        except RuntimeError as error:
            if self.is_mlx or self.device != "cuda:0" or not self.gpu_failure(error):
                raise
            key = self.loaded_key
            self.model = None
            self.loaded_key = None
            self.force_cpu = True
            import torch
            gc.collect()
            torch.cuda.empty_cache()
            emit("progress", stage="loading", message="显卡无法完成配音，正在改用 CPU 重试…")
            self.load(key)
            return self._synthesize(text, speaker, instruction, options)

    def _synthesize(self, text, speaker, instruction, options=None):
        import numpy as np
        options = options or {}
        language = options.get("language", "Chinese")
        mode = options.get("mode", "preset")
        if mode == "clone" and options.get("referenceStyle", "original") == "expressive":
            return local_module("reference_expression").synthesize(self, text, instruction, options)
        if self.is_mlx:
            if mode == "preset" and self.loaded_key == "standard":
                parts = self.split_for_pair(text)
                # Short presets need the same corrected causal decoder as paired
                # rows; the library decoder doubles bias at every chunk seam.
                pair = self.synthesize_pair(parts, speaker, instruction, options)
                return np.concatenate([audio for audio, _ in pair]), pair[0][1]
            # Incremental codec decoding bounds temporary convolution buffers.
            # Keep the same token budget and text; shortening either can omit words.
            streaming = {"max_tokens": 4096, "verbose": False, "stream": True, "streaming_interval": 2.0}
            if mode == "design":
                chunks = self.model.generate_voice_design(text=text, instruct=instruction, language=language, **streaming)
            elif mode == "clone":
                chunks = self.model.generate(text=text, ref_audio=options["refPath"], ref_text=options["refText"], lang_code=language,
                                              **streaming)
            else:
                chunks = self.model.generate_custom_voice(text=text, speaker=speaker, language=language,
                            instruct=instruction or None, **streaming)
            audio, rate = [], 24000
            try:
                for chunk in chunks:
                    # Detach the PCM from MLX before advancing the generator so
                    # completed chunks cannot retain GPU buffers or lazy graphs.
                    audio.append(np.array(chunk.audio, dtype=np.float32, copy=True).reshape(-1))
                    rate = chunk.sample_rate
                    del chunk
            finally:
                if hasattr(chunks, "close"):
                    chunks.close()
                if self._mlx is not None:
                    # Library generators only clean up after normal exhaustion.
                    # Also release streaming state on an inference/encoding error.
                    self.model.speech_tokenizer.decoder.reset_streaming_state()
                    self._mlx.synchronize()
                    self._mlx.clear_cache()
            if not audio:
                raise RuntimeError("配音引擎没有返回音频，请重试或缩短文本")
            return np.concatenate(audio), rate
        if mode == "design":
            wavs, rate = self.model.generate_voice_design(text=text, language=language, instruct=instruction, max_new_tokens=4096)
        elif mode == "clone":
            wavs, rate = self.model.generate_voice_clone(text=text, language=language, ref_audio=options["refPath"],
                               ref_text=options["refText"], max_new_tokens=4096)
        else:
            wavs, rate = self.model.generate_custom_voice(text=text, language=language, speaker=speaker,
                                instruct=instruction, max_new_tokens=4096)
        return np.asarray(wavs[0], dtype=np.float32).reshape(-1), rate

    @staticmethod
    def split_for_pair(text):
        if len(text) < 320:
            return [text]
        # Keep full sentences when possible, then clauses/word boundaries.
        # No character is removed; the original row remains one output file.
        lower, upper = max(80, int(len(text) * .3)), min(len(text) - 80, int(len(text) * .7))
        for pattern in (r"[。！？!?；;\n]|\.(?=\s|$)", r"[，,、：:]|\s"):
            boundaries = [match.end() for match in re.finditer(pattern, text) if lower <= match.end() <= upper]
            if boundaries:
                split = min(boundaries, key=lambda end: abs(end - len(text) / 2))
                return [text[:split], text[split:]]
        return [text]

    def can_pair(self, first, second):
        options, text, speaker, instruction, _, _, key = first
        other, next_text, next_speaker, next_instruction, _, _, next_key = second
        # Short or uneven rows get lower latency from the ordinary single-row
        # path. Only the tested standard preset model uses two inference lanes.
        return (self.is_mlx and key == next_key == "standard"
                and options.get("mode", "preset") == other.get("mode", "preset") == "preset"
                and speaker == next_speaker and instruction == next_instruction
                and options.get("language", "Chinese") == other.get("language", "Chinese")
                and min(len(text), len(next_text)) >= 80
                and max(len(text), len(next_text)) < 320
                and min(len(text), len(next_text)) * 2 >= max(len(text), len(next_text)))

    def synthesize_pair(self, texts, speaker, instruction, options):
        require_license(self.root)
        import numpy as np
        # Load from the integrity-checked engine copy, also under isolated -I.
        spec = importlib.util.spec_from_file_location("shengyue_mlx_batch", Path(__file__).with_name("mlx_batch.py"))
        batch = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(batch)
        chunks = batch.generate(self.model, texts, speaker, instruction, options.get("language", "Chinese"))
        audio = [[] for _ in texts]
        rate = self.model.sample_rate
        try:
            for chunk in chunks:
                audio[chunk.sequence_idx].append(np.array(chunk.audio, dtype=np.float32, copy=True).reshape(-1))
                del chunk
        finally:
            chunks.close()
            self.model.speech_tokenizer.decoder.reset_streaming_state()
            self._mlx.synchronize()
            self._mlx.clear_cache()
        if any(not parts for parts in audio):
            raise RuntimeError("配音引擎没有返回音频，请重试或缩短文本")
        return [(np.concatenate(parts), rate) for parts in audio]

    def diagnose(self, data):
        """A fixed, non-editable local trial; never creates customer works or references."""
        import numpy as np
        import soundfile as sf
        import lameenc
        key = data.get("package", "light")
        self.model_info(key)  # Reject unknown values before making paths.
        started = time.monotonic()
        self.load(key)
        folder = self.root / "preflight"
        folder.mkdir(exist_ok=True)
        text = "你好，欢迎使用声悦。"
        details = {}

        def checked(audio, rate, minimum=0.3, maximum=120):
            audio = np.asarray(audio, dtype=np.float32).reshape(-1)
            if (not isinstance(rate, (int, float)) or rate <= 0 or not np.isfinite(rate)
                    or not minimum <= len(audio) / rate <= maximum or not self.valid_audio(audio)):
                raise RuntimeError("检测配音未得到有效人声，请勿购买，先联系销售渠道排查")
            return audio, rate

        emit("progress", stage="preflight", message="正在用固定文案真实配音，请稍候…")
        if key == "character":
            # Exercise the default paid workflow without calling paid generation or
            # persisting an anchor: one fixed sample is reused for both trial lines.
            reference_text = ANCHOR_TEXT["Chinese"]
            sample, sample_rate = checked(*self._synthesize_with_fallback(
                reference_text, "Vivian", "温暖清晰的成年女性声音，自然说话。",
                {"language": "Chinese", "mode": "design"}), minimum=3, maximum=30)
            texts = [text, "我们会继续使用同一个人物声音，陪你讲完接下来的故事。"]
            with tempfile.TemporaryDirectory(prefix=".character-", dir=folder) as temporary:
                source = Path(temporary) / "sample.wav"
                sf.write(source, sample, sample_rate, subtype="PCM_16")
                self.load("reference")
                options = {"language": "Chinese", "mode": "clone", "refPath": str(source), "refText": reference_text}
                clips = [checked(*self._synthesize_with_fallback(line, "Vivian", "", options)) for line in texts]
                rate = clips[0][1]
                from scipy.signal import resample_poly
                from math import gcd
                normalized = []
                for clip, clip_rate in clips:
                    if clip_rate != rate:
                        divisor = gcd(int(rate), int(clip_rate))
                        clip = resample_poly(clip, int(rate) // divisor, int(clip_rate) // divisor)
                    normalized.append(clip)
                audio = np.concatenate([normalized[0], np.zeros(int(rate * .2), dtype=np.float32), normalized[1]])
            text = "".join(texts)
            details = {"workflow": "fixed-character-v1", "reuseCount": 2}
        else:
            options = {"language": "Chinese", "mode": "preset"}
            if key in ("reference", "expressive"):
                options["mode"] = "clone"
                if key == "expressive":
                    options["referenceStyle"] = "expressive"
                source = Path(__file__).parent / "diagnostic-reference.mp3"
                if not source.is_file():
                    raise RuntimeError("安装包缺少检测声音，请重新下载安装包")
                options.update(refPath=str(source), refText="你好，欢迎听听我的声音。接下来，让我陪你讲一个有趣的故事。")
            instruction = "开心、温暖地说话，节奏自然。" if key == "expressive" else ""
            audio, rate = checked(*self._synthesize_with_fallback(text, "Vivian", instruction, options))
        sf.write(folder / (key + ".wav"), audio, rate, subtype="PCM_16")
        encoder = lameenc.Encoder()
        encoder.set_bit_rate(192)
        encoder.set_in_sample_rate(rate)
        encoder.set_channels(1)
        encoder.set_quality(2)
        pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
        (folder / (key + ".mp3")).write_bytes(encoder.encode(pcm.tobytes()) + encoder.flush())
        elapsed = time.monotonic() - started
        return {"package": key, "passed": True, "duration": round(len(audio) / rate, 3), "elapsed": round(elapsed, 2),
                "device": self.device, "realTimeFactor": round(elapsed / (len(audio) / rate), 2), "text": text, **details}

    @staticmethod
    def valid_audio(audio):
        import numpy as np
        return audio.size and np.isfinite(audio).all() and float(np.max(np.abs(audio))) >= 0.001

    def bundled_voice_sample(self, options):
        """Use a curated built-in sample only while its original description applies."""
        import soundfile as sf
        voice = next((voice for voice in CATALOG["characters"] if voice["id"] == options.get("character")), None)
        sample = (voice or {}).get("reference")
        if (not sample or options.get("voiceDescription", "").strip() != voice["prompt"].strip()
                or options.get("language", "Chinese") != sample.get("language")):
            return None
        try:
            name = sample["file"]
            if not re.fullmatch(r"voice-[a-z0-9-]+\.mp3", name):
                raise ValueError("invalid sample path")
            source = Path(__file__).with_name(name)
            if source.stat().st_size > 2 * 1024 * 1024:
                raise ValueError("invalid sample size")
            if hashlib.sha256(source.read_bytes()).hexdigest() != sample["sha256"]:
                raise ValueError("invalid sample hash")
            audio, rate = sf.read(source, dtype="float32")
            if (audio.ndim != 1 or rate != 24000 or not 3 <= len(audio) / rate <= 30
                    or not self.valid_audio(audio) or not isinstance(sample["text"], str) or not sample["text"].strip()):
                raise ValueError("invalid sample audio")
        except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
            raise RuntimeError("内置声音样本缺失或损坏，请重新安装完整版本；不能自动更换声音") from error
        return audio, rate, sample["text"]

    def fixed_voice(self, text, speaker, instruction, options, prepare_only=False):
        """Persist a private reference independently of deletable output/history files."""
        import soundfile as sf
        anchor_id = voice_anchor_key(options, instruction)
        if options.get("voiceAnchorId") and options["voiceAnchorId"] != anchor_id:
            raise ValueError("定声样本与当前声音设置不匹配，请重新定声或使用原来的声音设置")
        metadata = self.voice_anchors / (anchor_id + ".json")
        recording = self.voice_anchors / (anchor_id + ".wav")
        if options.get("voiceAnchorId") and not metadata.exists():
            raise RuntimeError("原定声样本缺失，请重新定声后再生成，不能自动更换人物声音")
        if recording.exists() and not metadata.exists():
            raise RuntimeError("定声样本信息不完整，请重新定声后再生成，不能自动更换人物声音")
        first_audio = None
        if metadata.exists():
            try:
                anchor = json.loads(metadata.read_text("utf-8"))
                info = sf.info(recording)
                if (anchor["id"] != anchor_id or not isinstance(anchor["text"], str) or not anchor["text"] or not 3 <= info.duration <= 30
                        or anchor["sha256"] != hashlib.sha256(recording.read_bytes()).hexdigest()):
                    raise ValueError("invalid voice anchor")
            except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
                raise RuntimeError("角色的定声样本损坏，请在角色设置中点击“重新定声”后再生成") from error
        else:
            sample = self.bundled_voice_sample(options)
            if sample:
                audio, rate, ref_text = sample
            else:
                self.load("character")
                # Custom designs retain the existing first-line/complete-sample path.
                ref_text = text if locks_project_voice(options) else ANCHOR_TEXT[options.get("language", "Chinese")]
                audio, rate = self.synthesize(ref_text, speaker, instruction, options)
            if not self.valid_audio(audio):
                raise RuntimeError("首句没有生成有效人声，请重试后再固定人物声音")
            if 3 <= len(audio) / rate <= 30:
                if locks_project_voice(options) and not sample:
                    first_audio = (audio, rate)
            else:
                emit("progress", stage="generating", message="首句长度不适合定声，正在准备完整的人物声音样本…")
                ref_text = ANCHOR_TEXT[options.get("language", "Chinese")]
                audio, rate = self.synthesize(ref_text, speaker, instruction, options)
                if not self.valid_audio(audio) or not 3 <= len(audio) / rate <= 30:
                    raise RuntimeError("未能生成 3–30 秒的清晰定声样本，请重试或调整人物描述")
            require_license(self.root)
            self.voice_anchors.mkdir(exist_ok=True)
            temporary = recording.with_suffix(".tmp.wav")
            sf.write(temporary, audio, rate, subtype="PCM_16")
            temporary.replace(recording)
            anchor = {"id": anchor_id, "text": ref_text, "duration": round(len(audio) / rate, 3),
                      "projectId": options.get("projectId"), "roleId": options.get("roleId"),
                      "voiceScopeId": options.get("voiceScopeId", "default"), "voiceId": options.get("voiceId"),
                      "sourceLineId": None if prepare_only else options.get("lineId"), "createdAt": int(time.time() * 1000),
                      "sha256": hashlib.sha256(recording.read_bytes()).hexdigest()}
            temporary = metadata.with_suffix(".tmp")
            temporary.write_text(json.dumps(anchor, ensure_ascii=False), "utf-8")
            temporary.replace(metadata)
        if prepare_only:
            require_license(self.root)
            emit("progress", stage="voice-setup", message="角色声音已确定，试听满意后保存角色。")
            return {"voiceAnchorId": anchor_id, "text": anchor["text"], "duration": anchor["duration"],
                    "audio": base64.b64encode(recording.read_bytes()).decode("ascii")}
        if first_audio is not None:
            return *first_audio, "character", anchor_id
        self.load("reference")
        clone_options = {**options, "mode": "clone", "referenceStyle": "original", "refPath": str(recording), "refText": anchor["text"]}
        audio, rate = self.synthesize(text, speaker, "", clone_options)
        return audio, rate, "reference", anchor_id

    def prepare_voice(self, data):
        require_license(self.root)
        if not isinstance(data, dict) or not locks_voice(data):
            raise ValueError("请为人物声音开启固定人物声音")
        options = {**data, "rows": None, "batch": False,
                   "text": ANCHOR_TEXT.get(data.get("language", "Chinese"), ANCHOR_TEXT["Chinese"])}
        return self.generate(options, prepare_voice=True)

    def generate(self, data, prepare_voice=False):
        require_license(self.root)
        import numpy as np
        import soundfile as sf
        import lameenc
        from scipy.signal import resample_poly
        from math import gcd
        if data.get("rows") is not None:
            rows = data["rows"]
            if not isinstance(rows, list) or not 1 <= len(rows) <= 100 or any(not isinstance(row, dict) for row in rows):
                raise ValueError("脚本需要 1–100 条有效台词")
        else:
            lines, *_ = validate_request(data)
            rows = [{"text": text} for text in lines]
        if sum(len(str(row.get("text", ""))) for row in rows) > 5000:
            raise ValueError("每批最多 5000 字")
        validated = []
        for row in rows:
            options = {**data, **row, "batch": False, "rows": None}
            lines, speaker, instruction, rate, prefix = validate_request(options)
            mode = options.get("mode", "preset")
            if mode not in ("preset", "design", "clone"):
                raise ValueError("声音类型不存在")
            if "lockVoice" in options and not isinstance(options["lockVoice"], bool):
                raise ValueError("固定人物声音选项无效")
            if any(not isinstance(options.get(field, ""), str) or len(options.get(field, "")) > 64
                   for field in ("projectId", "roleId", "voiceRevision", "voiceScopeId")):
                raise ValueError("角色声音标识无效")
            if not isinstance(options.get("voiceId", ""), str) or len(options.get("voiceId", "")) > 128:
                raise ValueError("人物声音标识无效")
            if options.get("voiceAnchorId") is not None and (not isinstance(options["voiceAnchorId"], str)
                    or not re.fullmatch(r"[a-f0-9]{64}", options["voiceAnchorId"])):
                raise ValueError("定声样本标识无效")
            if options.get("language", "Chinese") not in {i["id"] for i in CATALOG["languages"]}:
                raise ValueError("不支持该语言")
            key = "character" if mode == "design" else "reference" if mode == "clone" else options.get("engine", "standard")
            if key not in MODEL_NAMES or (mode == "preset" and key not in ("standard", "light")):
                raise ValueError("音色包选项无效")
            if key == "light" and (options.get("emotion", "natural") != "natural" or instruction):
                raise ValueError("轻松朗读支持自然配音；情绪表演请切换日常配音")
            if mode == "design":
                character = next((c for c in CATALOG["characters"] if c["id"] == options.get("character")), None)
                description = str(options.get("voiceDescription", "")).strip() or (character or {}).get("prompt", "")
                if not description or len(description) > 500:
                    raise ValueError("请填写 1–500 字的人物声音描述")
                options["voiceDescription"] = description
                instruction = description + " " + instruction
            if mode == "clone":
                reference_style = options.get("referenceStyle", "original")
                if reference_style not in ("original", "expressive"):
                    raise ValueError("请选择沿用录音表达或调整语气")
                if reference_style == "expressive":
                    key = "expressive"
                reference = next((r for r in self.list_references() if r["id"] == options.get("referenceId")), None)
                ref_text = str(options["referenceText"] if "referenceText" in options else (reference or {}).get("text", "")).strip()
                if not reference or not ref_text or len(ref_text) > 1000:
                    raise ValueError("请选择参考声音并填写准确的参考台词")
                options.update(refPath=str(self.references / (reference["id"] + ".wav")), refText=ref_text)
                if reference_style == "original" and (options.get("emotion", "natural") != "natural" or instruction):
                    raise ValueError("沿用录音表达时不能另设情绪，请选择“调整语气”并准备我的声音·情绪表达")
            if key != "light" and (mode != "clone" or key == "expressive"):
                emotion = next((e for e in CATALOG["emotions"] if e["id"] == options.get("emotion", "natural")), None)
                scene = next((e for e in CATALOG["scenes"] if e["id"] == options.get("scene", "dialogue")), None)
                if not emotion or not scene:
                    raise ValueError("表演选项不存在")
                intensity = options.get("intensity", 50)
                if not isinstance(intensity, (int, float)) or not 0 <= intensity <= 100:
                    raise ValueError("情绪强度需要在 0–100 之间")
                strength = "表达克制，轻微流露情绪。" if intensity < 35 else "自然表达情绪。" if intensity < 70 else "情绪表达鲜明，但避免夸张失真。"
                pace = {"slow": "语速稍慢。", "normal": "节奏自然。", "fast": "语速稍快，保持清晰。"}.get(options.get("pace", "normal"))
                if pace is None:
                    raise ValueError("语速选项不存在")
                voice = next((v for v in CATALOG["voices"] if v["id"] == speaker), {}) if mode == "preset" else {}
                if voice.get("stylePrompt"):
                    # The curated style already describes natural conversation.
                    # Repeating neutral directions makes this voice over-perform
                    # and lengthens its delivery. Keep explicit controls, with
                    # the user's own direction last so it can refine the style.
                    instruction = " ".join(filter(None, [voice["stylePrompt"],
                        emotion["prompt"] if emotion["id"] != "natural" else "",
                        scene["prompt"] if scene["id"] != "dialogue" else "",
                        strength if emotion["id"] != "natural" else "",
                        pace if options.get("pace", "normal") != "normal" else "",
                        instruction]))
                else:
                    instruction = " ".join([instruction, emotion["prompt"], scene["prompt"], strength, pace])
            filename = options.get("filename") or prefix + (f"-{len(validated) + 1:03}" if len(rows) > 1 else "")
            if not isinstance(filename, str) or not re.fullmatch(r"[\w\-]{1,80}", filename):
                raise ValueError("每条文件名只能包含字母、数字、中文、下划线或短横线")
            if locks_voice(options) and options.get("voiceAnchorId") and options["voiceAnchorId"] != voice_anchor_key(options, instruction):
                raise ValueError("定声样本与当前声音设置不匹配，请重新定声或使用原来的声音设置")
            validated.append((options, lines[0], speaker, instruction, rate, filename, key))
        if any(locks_voice(options) for options, *_ in validated) and not self.model_ready("reference"):
            raise RuntimeError("固定人物声音需要“我的专属声音”，请先安装；如需逐句自由设计，可关闭“固定人物声音”")
        if prepare_voice:
            options, text, speaker, instruction, *_ = validated[0]
            emit("progress", stage="voice-setup", message="正在生成角色的固定声音，完成后即可试听…")
            return self.fixed_voice(text, speaker, instruction, options, prepare_only=True)
        results = []
        pending_audio = None
        for index, (options, text, speaker, instruction, rate, base, key) in enumerate(validated):
            require_license(self.root)
            emit("progress", stage="generating", message=f"正在生成第 {index + 1} / {len(validated)} 条", current=index + 1, total=len(validated), unit="条")
            started = time.monotonic()
            anchor_id = None
            if pending_audio is not None:
                audio, original_rate, synthesis_seconds = pending_audio
                pending_audio = None
                started -= synthesis_seconds
            elif locks_voice(options):
                audio, original_rate, key, anchor_id = self.fixed_voice(text, speaker, instruction, options)
                options["voiceAnchorId"] = anchor_id
            else:
                self.load(key)
                if index + 1 < len(validated) and self.can_pair(validated[index], validated[index + 1]):
                    emit("progress", stage="generating", message=f"正在生成第 {index + 1}–{index + 2} / {len(validated)} 条",
                         current=index + 1, total=len(validated), unit="条")
                    pair = self.synthesize_pair([text, validated[index + 1][1]], speaker, instruction, options)
                    # Attribute shared synthesis time once across the two clips.
                    synthesis_seconds = (time.monotonic() - started) / 2
                    (audio, original_rate), (next_audio, next_rate) = pair
                    pending_audio = (next_audio, next_rate, synthesis_seconds)
                    del pair, next_audio
                    started = time.monotonic() - synthesis_seconds
                else:
                    audio, original_rate = self.synthesize(text, speaker, instruction, options)
            require_license(self.root)
            tools = local_module("audio_tools")
            report = tools.quality(audio, original_rate, text)
            retries = 0
            while any(flag in report["flags"] for flag in ("SILENT_AUDIO", "LONG_INTERNAL_SILENCE")) and retries < 2:
                retries += 1
                emit("progress", stage="quality-retry", message=f"第 {index + 1} 条检测到可疑静音，正在重新生成（{retries}/2）…")
                # Retry only this segment and retain its fixed voice identity.
                try:
                    if locks_voice(options):
                        candidate, candidate_rate, key, anchor_id = self.fixed_voice(text, speaker, instruction, options)
                    else:
                        self.load(key)
                        candidate, candidate_rate = self.synthesize(text, speaker, instruction, options)
                    candidate_report = tools.quality(candidate, candidate_rate, text)
                except LicenseRequiredError:
                    raise
                except Exception as error:
                    if "SILENT_AUDIO" in report["flags"]: raise
                    report["retryError"] = str(error)[:300]
                    emit("progress", stage="quality-review", message="异常检查重试未完成，已保留原音频供试听核对。")
                    break
                score = lambda value: ("SILENT_AUDIO" in value["flags"], "LONG_INTERNAL_SILENCE" in value["flags"], value["longestInternalSilenceSeconds"])
                if score(candidate_report) < score(report): audio, original_rate, report = candidate, candidate_rate, candidate_report
            report["retries"] = retries
            if "SILENT_AUDIO" in report["flags"] or not self.valid_audio(audio):
                raise RuntimeError("配音引擎返回了无效音频，请重试")
            emit("progress", stage="encoding", message=f"正在保存第 {index + 1} / {len(validated)} 条音频", current=index + 1, total=len(validated), unit="条")
            if rate != original_rate:
                divisor = gcd(rate, original_rate)
                audio = resample_poly(audio, rate // divisor, original_rate // divisor)
            # Preserve dynamics. Only cap out-of-range samples for PCM encoding.
            audio = np.clip(audio, -1, 1)
            item_id = uuid.uuid4().hex
            folder = self.outputs / item_id
            folder.mkdir()
            sf.write(str(folder / (base + ".wav")), audio, rate, subtype="PCM_16")
            encoder = lameenc.Encoder()
            encoder.set_bit_rate(192)
            encoder.set_in_sample_rate(rate)
            encoder.set_channels(1)
            encoder.set_quality(2)
            pcm = (audio * 32767).astype("<i2").tobytes()
            (folder / (base + ".mp3")).write_bytes(encoder.encode(pcm) + encoder.flush())
            item = {"id": item_id, "text": text, "speaker": speaker, "instruction": instruction,
                    "wav": base + ".wav", "mp3": base + ".mp3", "duration": round(len(audio) / rate, 3),
                    "sampleRate": rate, "nativeSampleRate": original_rate, "createdAt": int(time.time() * 1000),
                    "elapsed": round(time.monotonic() - started, 2), "model": self.model_info(key)[1], "device": self.device,
                    "mode": options.get("mode", "preset"), "language": options.get("language", "Chinese"),
                    "voiceName": str(options.get("voiceName", speaker))[:64], "project": str(options.get("project", "未命名项目"))[:80],
                    "emotion": options.get("emotion", "natural"), "quality": report,
                    "options": {k: v for k, v in options.items() if k not in ("refPath", "rows", "text")}}
            if anchor_id:
                item.update(voiceAnchorId=anchor_id, synthesisMode="clone" if key == "reference" else "design")
            (folder / "metadata.json").write_text(json.dumps(item, ensure_ascii=False, indent=2), "utf-8")
            self.save_item(item)
            results.append(item)
            emit("progress", stage="clip", message=f"第 {index + 1} 条已完成", item=item)
        return {"items": results, "device": self.device}

    def export_delivery(self, data, preview=False):
        # This boundary is independently licensed even when called without the
        # desktop service. Delivery only reads existing clips; no model load.
        require_license(self.root)
        spec = importlib.util.spec_from_file_location("shengyue_delivery", Path(__file__).with_name("delivery.py"))
        delivery = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(delivery)
        return delivery.build_delivery(self, data, emit, preview_seconds=30 if preview else 0)

    def export_zip(self, data):
        require_license(self.root)
        ids = data.get("ids", [])
        if (not isinstance(ids, list) or not 1 <= len(ids) <= 20000
                or any(not isinstance(item_id, str) or not re.fullmatch(r"[a-f0-9]{32}", item_id) for item_id in ids)):
            raise ValueError("请选择需要打包的音频")
        fmt = data.get("format", "wav")
        if fmt not in ("wav", "mp3"):
            raise ValueError("不支持的导出格式")
        known = {i["id"]: local_module("audio_tools").effective_item(i) for i in self.history()}
        if any(item_id not in known for item_id in ids):
            raise ValueError("音频记录不存在")
        ids = list(dict.fromkeys(ids))
        id_set = set(ids)
        overrides = {}
        if "items" in data:
            if not isinstance(data["items"], list) or len(data["items"]) != len(ids):
                raise ValueError("导出音频与项目条目不匹配")
            for entry in data["items"]:
                if (not isinstance(entry, dict) or not isinstance(entry.get("id"), str)
                        or entry["id"] not in id_set or entry["id"] in overrides):
                    raise ValueError("导出音频与项目条目不匹配")
                name = entry.get("exportFilename")
                if not isinstance(name, str) or not re.fullmatch(r"[\w\-]{1,80}", name):
                    raise ValueError("导出文件名只能包含 1–80 个字母、数字、中文、下划线或短横线")
                current = {"exportFilename": name}
                for field in ("projectId", "chapterId", "lineId"):
                    if field in entry:
                        if not isinstance(entry[field], str) or len(entry[field]) > 128:
                            raise ValueError("导出项目标识无效")
                        current[field] = entry[field]
                for field in ("chapterOrder", "lineOrder", "partIndex"):
                    if field in entry:
                        if type(entry[field]) is not int or not 0 <= entry[field] <= 20000:
                            raise ValueError("导出项目顺序无效")
                        current[field] = entry[field]
                overrides[entry["id"]] = current
        # All paths and names are checked before creating an intermediate archive.
        entries, names, next_suffix = [], set(), {}
        for item_id in ids:
            item = known[item_id]
            source_name = item.get(fmt)
            if (not isinstance(source_name, str) or not source_name.endswith("." + fmt)
                    or not re.fullmatch(r"[\w\-]{1,80}\." + fmt, source_name)):
                raise ValueError("音频文件名无效")
            folder = self.outputs / item_id
            file = folder / source_name
            if folder.is_symlink() or file.is_symlink() or not file.is_file():
                raise ValueError("音频文件不存在或无效")
            current = overrides.get(item_id, {})
            base = unicodedata.normalize("NFC", current.get("exportFilename", source_name[:-(len(fmt) + 1)]))
            if re.fullmatch(r"(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])", base):
                base = "voice-" + base
            # Leave room for the largest supported collision suffix and extension
            # under common 255-byte filesystem limits, including astral letters.
            base = base.encode("utf-8")[:240].decode("utf-8", errors="ignore")
            base_key = base.casefold()
            name, suffix = base + "." + fmt, next_suffix.get(base_key, 2)
            # Also avoid collisions on case-insensitive / normalization-insensitive disks.
            while unicodedata.normalize("NFC", name).casefold() in names:
                name = f"{base}-{suffix}.{fmt}"
                suffix += 1
            next_suffix[base_key] = suffix
            names.add(unicodedata.normalize("NFC", name).casefold())
            entries.append((item, current, file, name))
        temporary_root = self.root / ".export-tmp"
        if temporary_root.is_symlink():
            raise ValueError("导出临时目录无效")
        temporary_root.mkdir(exist_ok=True)
        token = uuid.uuid4().hex
        folder = temporary_root / ("voice-export-" + token)
        folder.mkdir()
        destination, owner = folder / "archive.zip", folder / "owner.json"
        try:
            owner.write_text(json.dumps({"schema": "shengyue-export-v1", "token": token,
                                         "pid": os.getppid(), "createdAt": int(time.time() * 1000)}), "utf-8")
            with zipfile.ZipFile(destination, "x", zipfile.ZIP_DEFLATED) as archive:
                manifest = []
                for item, current, file, name in entries:
                    archive.write(file, name)
                    digest = hashlib.sha256()
                    with file.open("rb") as source:
                        for chunk in iter(lambda: source.read(1024 * 1024), b""):
                            digest.update(chunk)
                    manifest.append({**item, **current, "exportFile": name, "sha256": digest.hexdigest()})
                archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            return {"path": str(destination), "count": len(entries)}
        except BaseException:
            # Only these files and this unique directory were created by this call.
            destination.unlink(missing_ok=True)
            owner.unlink(missing_ok=True)
            folder.rmdir()
            raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--asset-dir")
    args = parser.parse_args()
    studio = Studio(args.data_dir, args.asset_dir)
    emit("ready")
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            operation = request.get("op")
            # Libraries print to stdout; reserve original stdout for the protocol.
            with contextlib.redirect_stdout(sys.stderr):
                if operation == "status":
                    result = studio.status()
                elif operation == "download":
                    result = studio.download(request.get("data", {}))
                elif operation == "diagnose":
                    result = studio.diagnose(request.get("data", {}))
                elif operation == "generate":
                    result = studio.generate(request.get("data", {}))
                elif operation == "prepare-voice":
                    result = studio.prepare_voice(request.get("data", {}))
                elif operation == "zip":
                    result = studio.export_zip(request.get("data", {}))
                elif operation == "project-export":
                    result = studio.export_delivery(request.get("data", {}))
                elif operation == "project-preview":
                    result = studio.export_delivery(request.get("data", {}), preview=True)
                elif operation == "reference":
                    result = studio.import_reference(request.get("data", {}))
                elif operation == "update-reference":
                    result = studio.update_reference(request.get("data", {}))
                elif operation == "capture":
                    result = studio.capture_reference(request.get("data", {}))
                elif operation in ("audio-edit", "audio-inspect", "audio-select", "background-import"):
                    require_license(studio.root)
                    method = {"audio-edit": "save_edit", "audio-inspect": "inspect_item", "audio-select": "select_version", "background-import": "import_background"}[operation]
                    result = getattr(local_module("audio_tools"), method)(studio, request.get("data", {}))
                elif operation in ("reference-open", "reference-transcribe", "reference-commit", "reference-cancel", "transcription-download"):
                    require_license(studio.root)
                    tools = local_module("reference_tools")
                    if operation == "transcription-download": result = tools.download(studio, emit)
                    elif operation == "reference-transcribe": result = tools.transcribe(studio, request.get("data", {}), emit)
                    else:
                        method = {"reference-open": "open_reference", "reference-commit": "commit", "reference-cancel": "cancel"}[operation]
                        result = getattr(tools, method)(studio, request.get("data", {}))
                else:
                    raise ValueError("不支持的操作")
            emit("result", id=request.get("id"), result=result)
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            emit("error", id=request.get("id"), code=getattr(error, "code", "ENGINE_ERROR"), message=str(error))


if __name__ == "__main__":
    main()
