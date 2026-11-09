"""Chunk-size-independent decoding for the pinned Qwen speech tokenizer.

Reuse its weights and causal buffers; do not change precision or quantization.
"""
import mlx.core as mx


class StreamingDecoder:
    def __init__(self, decoder):
        # mlx-audio wraps __call__ with mx.compile; streaming_step remains a
        # bound method of the original Module, which owns all streaming state.
        self.base = decoder.streaming_step.__self__

    def reset_streaming_state(self):
        self.base.reset_streaming_state()

    def streaming_step(self, codes):
        decoder = self.base
        if decoder._transformer_cache is None:
            decoder._transformer_cache = decoder.pre_transformer.make_cache()
        hidden = mx.transpose(decoder.quantizer.decode(codes), (0, 2, 1))
        hidden = decoder.pre_conv.step(hidden)
        size = hidden.shape[1]
        offset = decoder._transformer_cache[0].offset
        # Only allocate the query rows that this chunk needs. The library
        # builds an entire (offset + size)^2 mask before slicing those rows.
        allowed = mx.arange(offset + size)[None, :] <= mx.arange(offset, offset + size)[:, None]
        mask = mx.where(allowed, mx.array(0, hidden.dtype), mx.array(float('-inf'), hidden.dtype))
        hidden = decoder.pre_transformer(hidden, mask=mask, cache=decoder._transformer_cache)
        for transpose_conv, convnext in decoder.upsample:
            hidden = convnext.step(transpose_conv(hidden))
        wav = decoder.decoder[0].step(hidden)
        for block in decoder.decoder[1:-2]:
            wav = block.block[0](wav)
            upsample = block.block[1]
            y = upsample.conv(wav)
            if upsample._overflow is not None:
                length = upsample._overflow.shape[1]
                y = mx.concatenate([y[:, :length, :] + upsample._overflow, y[:, length:, :]], axis=1)
            if upsample.trim_right > 0:
                # ConvTranspose already adds bias to the next chunk. Carry
                # contributions only, otherwise bias is doubled at every seam.
                overflow = y[:, -upsample.trim_right:, :]
                if 'bias' in upsample.conv:
                    overflow = overflow - upsample.conv.bias
                upsample._overflow = overflow
                y = y[:, :-upsample.trim_right, :]
            wav = y
            for unit in block.block[2:]:
                wav = unit.step(wav)
        wav = decoder.decoder[-1].step(decoder.decoder[-2](wav))
        return mx.clip(mx.transpose(wav, (0, 2, 1)), -1, 1)
