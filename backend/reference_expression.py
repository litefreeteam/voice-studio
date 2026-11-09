"""Native controllable cloning with VoxCPM2; audio and inference stay local.

The reference-only path separates timbre from the instruction. Passing the same
recording as a continuation prompt would also copy its original performance.
"""
import importlib.util
from pathlib import Path
import re
import sys


def load_torch(folder, device):
    name = "shengyue_voxcpm"
    if name not in sys.modules:
        package = Path(__file__).with_name("vendor") / "voxcpm"
        spec = importlib.util.spec_from_file_location(name, package / "__init__.py",
                                                     submodule_search_locations=[str(package)])
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    from shengyue_voxcpm.model.voxcpm2 import VoxCPM2Model
    return VoxCPM2Model.from_local(str(folder), optimize=False, device=device)


def parts(text, limit=80):
    """Bound full-waveform decoder memory without dropping text or punctuation."""
    result = []
    while len(text) > limit:
        # Prefer a sentence/clause ending, then a word boundary, within the cap.
        matches = list(re.finditer(r"[。！？!?；;，,、：:]|\s|\.(?=\s|$)", text[:limit]))
        cut = matches[-1].end() if matches and matches[-1].end() >= limit // 2 else limit
        result.append(text[:cut])
        text = text[cut:]
    if text:
        result.append(text)
    return result


def control(instruction):
    # Parentheses delimit VoxCPM's control prefix; user directions cannot close
    # that prefix and accidentally turn the remaining instruction into speech.
    return re.sub(r"[()（）\r\n]", "，", instruction).strip()


def synthesize(studio, text, instruction, options):
    import numpy as np
    audio = []
    rate = 48000
    for part in parts(text):
        if studio.is_mlx:
            chunks = studio.model.generate(text=part, ref_audio=options["refPath"],
                                           instruct=control(instruction), max_tokens=4096,
                                           inference_timesteps=10, cfg_value=2.0)
            try:
                for chunk in chunks:
                    rate = chunk.sample_rate
                    audio.append(np.array(chunk.audio, dtype=np.float32, copy=True).reshape(-1))
            finally:
                if hasattr(chunks, "close"):
                    chunks.close()
                if studio._mlx is not None:
                    studio._mlx.synchronize()
                    studio._mlx.clear_cache()
        else:
            # This is the upstream reference-isolation path, with no prompt_text
            # or continuation audio. The prefix is part of the model protocol.
            value = studio.model.generate(target_text=f"({control(instruction)}){part}",
                                          reference_wav_path=options["refPath"], max_len=4096,
                                          inference_timesteps=10, cfg_value=2.0,
                                          retry_badcase=False)
            rate = studio.model.sample_rate
            audio.append(value.detach().float().cpu().numpy().reshape(-1))
    if not audio or not any(value.size for value in audio):
        raise RuntimeError("情绪配音引擎没有返回音频，请重试")
    return np.concatenate(audio), rate
