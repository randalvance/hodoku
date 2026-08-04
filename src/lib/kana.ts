/**
 * Kana utilities: script detection and hiragana <-> katakana conversion.
 *
 * Everything here is pure and dependency-free so it can run in a worker, a
 * service worker, or a content script without any platform assumptions.
 */

const HIRAGANA_START = 0x3041; // ぁ
const HIRAGANA_END = 0x3096; // ゖ
const KATAKANA_START = 0x30a1; // ァ
const KATAKANA_END = 0x30f6; // ヶ
const KATAKANA_OFFSET = KATAKANA_START - HIRAGANA_START;

/** Halfwidth katakana ｦ..ﾟ */
const HALFWIDTH_START = 0xff61;
const HALFWIDTH_END = 0xff9f;

const HALFWIDTH_TO_FULLWIDTH: Record<string, string> = {
  '｡': '。', '｢': '「', '｣': '」', '､': '、', '･': '・',
  'ｦ': 'ヲ', 'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
  'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ', 'ｯ': 'ッ', 'ｰ': 'ー',
  'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
  'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
  'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
  'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
  'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
  'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
  'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
  'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
  'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
  'ﾜ': 'ワ', 'ﾝ': 'ン',
};

/** Voicing marks that follow a halfwidth katakana base character. */
const HALFWIDTH_VOICED: Record<string, string> = {
  'ｶ': 'ガ', 'ｷ': 'ギ', 'ｸ': 'グ', 'ｹ': 'ゲ', 'ｺ': 'ゴ',
  'ｻ': 'ザ', 'ｼ': 'ジ', 'ｽ': 'ズ', 'ｾ': 'ゼ', 'ｿ': 'ゾ',
  'ﾀ': 'ダ', 'ﾁ': 'ヂ', 'ﾂ': 'ヅ', 'ﾃ': 'デ', 'ﾄ': 'ド',
  'ﾊ': 'バ', 'ﾋ': 'ビ', 'ﾌ': 'ブ', 'ﾍ': 'ベ', 'ﾎ': 'ボ',
  'ｳ': 'ヴ',
};

const HALFWIDTH_SEMI_VOICED: Record<string, string> = {
  'ﾊ': 'パ', 'ﾋ': 'ピ', 'ﾌ': 'プ', 'ﾍ': 'ペ', 'ﾎ': 'ポ',
};

export function isHiragana(ch: string): boolean {
  const c = ch.codePointAt(0);
  return c !== undefined && c >= HIRAGANA_START && c <= HIRAGANA_END;
}

export function isKatakana(ch: string): boolean {
  const c = ch.codePointAt(0);
  if (c === undefined) return false;
  if (c === 0x30fc) return true; // ー prolonged sound mark
  return c >= KATAKANA_START && c <= KATAKANA_END;
}

export function isKana(ch: string): boolean {
  return isHiragana(ch) || isKatakana(ch);
}

export function isKanji(ch: string): boolean {
  const c = ch.codePointAt(0);
  if (c === undefined) return false;
  return (
    (c >= 0x4e00 && c <= 0x9fff) || // CJK Unified Ideographs
    (c >= 0x3400 && c <= 0x4dbf) || // Extension A
    (c >= 0xf900 && c <= 0xfaff) || // Compatibility Ideographs
    c === 0x3005 // 々 iteration mark
  );
}

/** True for any character that participates in Japanese text. */
export function isJapaneseChar(ch: string): boolean {
  const c = ch.codePointAt(0);
  if (c === undefined) return false;
  return (
    isKana(ch) ||
    isKanji(ch) ||
    (c >= HALFWIDTH_START && c <= HALFWIDTH_END) ||
    c === 0x3005 || // 々
    c === 0x30fb || // ・
    c === 0xff5e // ～
  );
}

/**
 * Heuristic: does this string contain enough Japanese to be worth analysing?
 * Guards against firing on a stray ideograph inside otherwise-Latin text.
 */
export function containsJapanese(text: string): boolean {
  for (const ch of text) {
    if (isKana(ch) || isKanji(ch)) return true;
    const c = ch.codePointAt(0)!;
    if (c >= HALFWIDTH_START && c <= HALFWIDTH_END) return true;
  }
  return false;
}

export function toKatakana(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= HIRAGANA_START && c <= HIRAGANA_END) {
      out += String.fromCodePoint(c + KATAKANA_OFFSET);
    } else {
      out += ch;
    }
  }
  return out;
}

export function toHiragana(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= KATAKANA_START && c <= KATAKANA_END) {
      out += String.fromCodePoint(c - KATAKANA_OFFSET);
    } else {
      out += ch;
    }
  }
  return out;
}

/** Expand halfwidth katakana (including trailing ﾞ/ﾟ) into fullwidth katakana. */
export function widenHalfwidthKatakana(text: string): string {
  const chars = [...text];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (next === 'ﾞ' && HALFWIDTH_VOICED[ch]) {
      out += HALFWIDTH_VOICED[ch];
      i++;
      continue;
    }
    if (next === 'ﾟ' && HALFWIDTH_SEMI_VOICED[ch]) {
      out += HALFWIDTH_SEMI_VOICED[ch];
      i++;
      continue;
    }
    out += HALFWIDTH_TO_FULLWIDTH[ch] ?? ch;
  }
  return out;
}

/**
 * Normalise text before analysis: fullwidth ASCII -> ASCII, halfwidth kana ->
 * fullwidth kana, and Unicode NFKC for the rest. Keeps kana/kanji untouched.
 */
export function normalizeJapanese(text: string): string {
  return widenHalfwidthKatakana(text).normalize('NFC');
}

/**
 * Split a word into furigana segments by aligning its reading against its
 * surface form. Returns the kanji runs paired with the kana that voices them,
 * which is what the breakdown UI renders above each word.
 *
 * Falls back to a single whole-word segment when alignment is ambiguous.
 */
export function furiganaSegments(
  surface: string,
  reading: string,
): Array<{ text: string; ruby?: string }> {
  if (!reading || surface === reading) return [{ text: surface }];

  const readingHira = toHiragana(reading);
  const surfaceChars = [...surface];

  // Strip the shared kana prefix and suffix (okurigana) so only the kanji core
  // needs a reading attached.
  let start = 0;
  while (
    start < surfaceChars.length &&
    isKana(surfaceChars[start]) &&
    toHiragana(surfaceChars[start]) === readingHira[start]
  ) {
    start++;
  }

  let endOffset = 0;
  while (
    endOffset < surfaceChars.length - start &&
    isKana(surfaceChars[surfaceChars.length - 1 - endOffset]) &&
    toHiragana(surfaceChars[surfaceChars.length - 1 - endOffset]) ===
      readingHira[readingHira.length - 1 - endOffset]
  ) {
    endOffset++;
  }

  const core = surfaceChars.slice(start, surfaceChars.length - endOffset).join('');
  const coreReading = readingHira.slice(start, readingHira.length - endOffset);

  const segments: Array<{ text: string; ruby?: string }> = [];
  if (start > 0) segments.push({ text: surfaceChars.slice(0, start).join('') });
  if (core) {
    // Only annotate if the core actually contains kanji; otherwise the reading
    // adds nothing (e.g. a katakana word read back as hiragana).
    const hasKanji = [...core].some(isKanji);
    segments.push(hasKanji && coreReading ? { text: core, ruby: coreReading } : { text: core });
  }
  if (endOffset > 0) {
    segments.push({ text: surfaceChars.slice(surfaceChars.length - endOffset).join('') });
  }

  return segments.length ? segments : [{ text: surface }];
}
