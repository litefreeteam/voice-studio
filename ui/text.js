/* One lossless splitter for renderer imports and desktop generation queues. */
(function (root) {
  const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
  const words = new Intl.Segmenter('und', { granularity: 'word' });
  function splitText(text, limit = 600) {
    if (typeof text !== 'string' || !text.isWellFormed()) throw new Error('文案含有不完整的 Unicode 字符，请检查原文');
    if (/\[\[(?:emotion:|\/emotion|cue:)|<#/.test(text)) throw new Error('段内标记功能已撤回，请打开文稿恢复普通文字后再生成');
    if (!Number.isInteger(limit) || limit < 1 || limit > 600) throw new Error('分段长度须为 1–600');
    if (!text.trim()) return [];
    // Keep UTF-16 length <= 600: also safely below Python's 600-code-point limit.
    // Preserve every space, including spaces at chunk boundaries. Never split a
    // grapheme (surrogate pairs, combining marks, emoji modifiers or ZWJ groups).
    const ends = [0];
    for (const { segment, index } of graphemes.segment(text)) {
      if (segment.length > limit) throw new Error('单个组合字符超过分段上限，请缩短该字符的组合标记');
      ends.push(index + segment.length);
    }
    const wordSpans = [...words.segment(text)].filter(word => word.isWordLike);
    const contentEnd = text.trimEnd().length;
    const chunks = []; let start = 0, cursor = 1, wordCursor = 0;
    while (start < text.length) {
      while (cursor < ends.length && ends[cursor] <= start + limit) cursor++;
      const hardEnd = ends[cursor - 1]; let end = hardEnd;
      if (end < text.length) {
        const head = text.slice(start, end);
        const boundaries = [...head.matchAll(/[。！？!?；;\n]|[.]\s/g)];
        const boundary = boundaries.reverse().find(match => match.index >= limit / 3);
        if (boundary) {
          const preferred = start + boundary.index + boundary[0].length;
          // Punctuation plus a combining mark must remain one grapheme too.
          let preferredCursor = cursor - 1;
          while (ends[preferredCursor] > preferred) preferredCursor--;
          if (ends[preferredCursor] > start) end = ends[preferredCursor];
        } else {
          while (wordCursor < wordSpans.length && wordSpans[wordCursor].index + wordSpans[wordCursor].segment.length <= end) wordCursor++;
          const word = wordSpans[wordCursor];
          if (word && word.index > start && word.index < end) end = word.index;
          // A word longer than limit has no natural boundary: split at the last
          // whole grapheme that fits, without deleting or duplicating anything.
        }
      }
      if (!text.slice(start, end).trim()) end = hardEnd;
      // Keep a final run of spaces attached to at least one visible grapheme.
      if (end >= contentEnd && end < text.length) {
        let last = cursor - 1;
        while (ends[last] >= contentEnd) last--;
        if (ends[last] > start) end = ends[last];
      }
      const chunk = text.slice(start, end);
      if (!chunk.trim()) throw new Error('连续空白超过分段上限，请缩短空白后再生成');
      chunks.push(chunk); start = end;
      while (cursor > 1 && ends[cursor - 1] > start) cursor--;
    }
    return chunks;
  }
  if (typeof module !== 'undefined') module.exports = { splitText }; else root.StudioText = { splitText };
})(typeof window !== 'undefined' ? window : globalThis);
