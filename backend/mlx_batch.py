"""Bounded two-row preset synthesis for the pinned mlx-audio 0.5.8 backend.

One model, two KV-cache lanes, and at most 8 codec frames per lane. Keeping
prefixes identical avoids padded-prefill attention and preserves each row's full
trailing text (including its EOS embedding). Decoder weights stay float32.
"""
from types import SimpleNamespace
import importlib.util
from pathlib import Path

import mlx.core as mx


MAX_ROWS = 2
CHUNK_FRAMES = 8  # Reserve room for two long KV histories under the existing memory budget.
MAX_TOKENS = 4096


def streaming_decoder(model):
    spec = importlib.util.spec_from_file_location("shengyue_mlx_decoder", Path(__file__).with_name("mlx_decoder.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.StreamingDecoder(model.speech_tokenizer.decoder)


def generate(model, texts, speaker, instruction, language="Chinese"):
    if not 1 <= len(texts) <= MAX_ROWS:
        raise ValueError("并行配音每组最多两条")
    prepared = [model._prepare_generation_inputs(
        text=text, language=language, speaker=speaker, instruct=instruction or None) for text in texts]
    if len({part[0].shape[1] for part in prepared}) != 1:
        raise ValueError("并行配音需要相同的声音设置")
    inputs = mx.concatenate([part[0] for part in prepared], axis=0)
    trailing_size = max(part[1].shape[1] for part in prepared)
    trailing = mx.concatenate([
        mx.concatenate([part[1], mx.broadcast_to(
            part[2], (1, trailing_size - part[1].shape[1], part[1].shape[2]))], axis=1)
        for part in prepared], axis=0)
    pad = mx.concatenate([part[2] for part in prepared], axis=0)
    del prepared
    cache = model.talker.make_cache()
    code_cache = model.talker.code_predictor.make_cache()
    eos = model.config.talker_config.codec_eos_token_id
    suppress = model._suppress_codec_tokens(eos)
    previous = [[] for _ in texts]
    finished = mx.zeros((len(texts),), dtype=mx.bool_)
    codes, counts = [], [0] * len(texts)
    decoder = streaming_decoder(model)
    samples_per_frame = model.speech_tokenizer.decode_upsample_rate
    decoder.reset_streaming_state()

    def decode():
        chunk = mx.transpose(mx.stack(codes, axis=1), (0, 2, 1))
        audio = decoder.streaming_step(chunk).squeeze(1)
        mx.eval(audio)
        for row, count in enumerate(counts):
            if count:
                yield SimpleNamespace(audio=audio[row, :count * samples_per_frame],
                                      sample_rate=model.sample_rate, sequence_idx=row)

    try:
        for step in range(MAX_TOKENS):
            logits, hidden = model.talker(inputs, cache=cache)
            token = model._sample_token_batch(
                logits, temperature=0.9, top_k=50, top_p=1.0, repetition_penalty=1.05,
                generated_tokens_per_seq=previous, suppress_tokens=suppress)
            finished = finished | (token[:, 0] == eos)
            # A finished lane stays in the batch until the other lane ends. EOS
            # is outside the codec vocabulary: feed valid zero codes, emit no pad.
            token = mx.where(finished[:, None], mx.zeros_like(token), token)
            tokens, frame = model._predict_code_tokens(
                token, hidden, temperature=0.9, top_k=50, top_p=1.0, code_cache=code_cache)
            text_embed = trailing[:, step:step + 1, :] if step < trailing_size else pad
            inputs = text_embed + model._codec_embeds_for_tokens(tokens)
            mx.eval(inputs, finished, frame)
            done = finished.tolist()
            if all(done):
                break
            ids = token[:, 0].tolist()
            for row in range(len(texts)):
                if not done[row]:
                    # Sampling only uses the last 64 IDs; keep history bounded.
                    previous[row] = (previous[row] + [ids[row]])[-64:]
                    counts[row] += 1
            codes.append(mx.where(finished[:, None], mx.zeros_like(frame), frame))
            if len(codes) == CHUNK_FRAMES:
                yield from decode()
                codes.clear()
                counts = [0] * len(texts)
        else:
            # Never report a token-budget cutoff as a successfully finished row.
            raise RuntimeError("配音达到单条生成上限，请将文本分成更短的段落后重试")
        if codes:
            yield from decode()
    finally:
        decoder.reset_streaming_state()
        codes.clear()
        cache.clear()
        code_cache.clear()
        mx.synchronize()
        mx.clear_cache()
