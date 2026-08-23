(function () {
  'use strict';

  const WORD_TOKEN_MULTIPLIER = 1.33;
  const CHARS_PER_TOKEN = 4;
  const BYTES_PER_TOKEN = 4;

  let intlWordSegmenter = null;

  function getWordSegmenter() {
    if (intlWordSegmenter !== null) {
      return intlWordSegmenter;
    }

    if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
      intlWordSegmenter = undefined;
      return intlWordSegmenter;
    }

    try {
      intlWordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    } catch (error) {
      console.debug('ChatGPT Token Counter: failed to create Intl.Segmenter', error);
      intlWordSegmenter = undefined;
    }

    return intlWordSegmenter;
  }

  function countWords(text) {
    const segmenter = getWordSegmenter();
    if (!segmenter) {
      return text.split(/\s+/u).filter(Boolean).length;
    }

    let count = 0;
    const iterator = segmenter.segment(text);
    for (const segment of iterator) {
      if (segment.isWordLike) {
        count += 1;
      }
    }

    return count;
  }

  function estimateTokensFromText(text) {
    if (!text) {
      return {
        tokens: 0,
        words: 0,
        characters: 0
      };
    }

    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      return {
        tokens: 0,
        words: 0,
        characters: 0
      };
    }

    const words = countWords(cleaned);
    const characters = cleaned.replace(/\s+/g, '').length;

    const byWord = Math.ceil((words || 1) * WORD_TOKEN_MULTIPLIER);
    const byCharacter = Math.ceil(characters / CHARS_PER_TOKEN);
    const blended = Math.round((byWord * 0.4) + (byCharacter * 0.6));
    const tokens = Math.max(1, Math.max(byWord, byCharacter, blended));

    return { tokens, words, characters };
  }

  function estimateTokensFromBytes(bytes) {
    if (!bytes || Number.isNaN(bytes)) {
      return 0;
    }
    return Math.max(1, Math.ceil(bytes / BYTES_PER_TOKEN));
  }

  function parseFileSizeToBytes(sizeText) {
    if (!sizeText) {
      return 0;
    }

    const match = sizeText
      .replace(/,/g, '')
      .match(/([\d.]+)\s*(kib|kb|mib|mb|gib|gb|tib|tb|b)/i);

    if (!match) {
      return 0;
    }

    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    const base = 1024;
    switch (unit) {
      case 'tib':
      case 'tb':
        return value * Math.pow(base, 4);
      case 'gib':
      case 'gb':
        return value * Math.pow(base, 3);
      case 'mib':
      case 'mb':
        return value * Math.pow(base, 2);
      case 'kib':
      case 'kb':
        return value * base;
      case 'b':
      default:
        return value;
    }
  }

  function estimateTokensFromFileSizeString(sizeText) {
    const bytes = parseFileSizeToBytes(sizeText);
    return {
      tokens: estimateTokensFromBytes(bytes),
      bytes
    };
  }

  window.ChatGPTTokenEstimator = {
    estimateTokensFromText,
    estimateTokensFromFileSizeString,
    parseFileSizeToBytes,
    estimateTokensFromBytes,
    countWords
  };
})();

