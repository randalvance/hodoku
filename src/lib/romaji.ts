/**
 * Kana -> Hepburn romaji conversion.
 *
 * The analyser feeds this the *pronunciation* field from the morphological
 * analyser (e.g. トーキョー rather than トウキョウ), which already collapses
 * long vowels onto ー and reads the topic particle は as ワ. That makes correct
 * Hepburn output mostly a matter of a good syllable table plus handling for
 * sokuon (っ), moraic n (ん) and long vowels.
 */

import { toKatakana } from './kana';

export type RomajiStyle =
  /** Modified Hepburn with macrons: とうきょう -> tōkyō. */
  | 'macron'
  /** Macron-free but length-preserving: とうきょう -> tookyoo. */
  | 'doubled'
  /** Passport style, length dropped entirely: とうきょう -> tokyo. */
  | 'none'
  /** Keyboard/IME spelling, driven by the written reading: とうきょう -> toukyou. */
  | 'wapuro';

/** Multi-kana sequences, tried longest-first. */
const DIGRAPHS: Record<string, string> = {
  キャ: 'kya', キュ: 'kyu', キョ: 'kyo', キェ: 'kye',
  ギャ: 'gya', ギュ: 'gyu', ギョ: 'gyo', ギェ: 'gye',
  シャ: 'sha', シュ: 'shu', ショ: 'sho', シェ: 'she',
  ジャ: 'ja', ジュ: 'ju', ジョ: 'jo', ジェ: 'je',
  チャ: 'cha', チュ: 'chu', チョ: 'cho', チェ: 'che',
  ヂャ: 'ja', ヂュ: 'ju', ヂョ: 'jo',
  ニャ: 'nya', ニュ: 'nyu', ニョ: 'nyo',
  ヒャ: 'hya', ヒュ: 'hyu', ヒョ: 'hyo',
  ビャ: 'bya', ビュ: 'byu', ビョ: 'byo',
  ピャ: 'pya', ピュ: 'pyu', ピョ: 'pyo',
  ミャ: 'mya', ミュ: 'myu', ミョ: 'myo',
  リャ: 'rya', リュ: 'ryu', リョ: 'ryo',
  // Katakana-only extensions used for loanwords.
  ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo', フュ: 'fyu', フャ: 'fya', フョ: 'fyo',
  ティ: 'ti', トゥ: 'tu', テュ: 'tyu',
  ディ: 'di', ドゥ: 'du', デュ: 'dyu',
  ウィ: 'wi', ウェ: 'we', ウォ: 'wo', ウャ: 'wya',
  ヴァ: 'va', ヴィ: 'vi', ヴェ: 've', ヴォ: 'vo', ヴュ: 'vyu',
  ツァ: 'tsa', ツィ: 'tsi', ツェ: 'tse', ツォ: 'tso',
  クァ: 'kwa', クィ: 'kwi', クェ: 'kwe', クォ: 'kwo',
  グァ: 'gwa', グィ: 'gwi', グェ: 'gwe', グォ: 'gwo',
  スィ: 'si', ズィ: 'zi',
  イェ: 'ye',
};

const MONOGRAPHS: Record<string, string> = {
  ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o',
  カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko',
  サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so',
  タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to',
  ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no',
  ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
  マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo',
  ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
  ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro',
  ワ: 'wa', ヲ: 'wo', ン: 'n',
  ヰ: 'wi', ヱ: 'we',
  ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go',
  ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
  ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do',
  バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
  パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po',
  ヴ: 'vu',
  // Small kana standing on their own (rare, but they must not vanish).
  ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o',
  ャ: 'ya', ュ: 'yu', ョ: 'yo', ヮ: 'wa',
  ヵ: 'ka', ヶ: 'ke',
};

const MACRONS: Record<string, string> = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };
const VOWELS = new Set(['a', 'i', 'u', 'e', 'o']);

const SOKUON = 'ッ';
const LONG_MARK = 'ー';

interface Mora {
  romaji: string;
  /** Number of extra vowel beats carried by this mora (from ー or a repeat). */
  lengthened: number;
}

/**
 * Convert a kana string to a list of romaji morae, resolving sokuon, moraic n
 * and vowel length. Non-kana characters pass through untouched.
 */
function toMorae(kana: string): Mora[] {
  const src = toKatakana(kana);
  const chars = [...src];
  const morae: Mora[] = [];
  let pendingSokuon = false;

  const push = (romaji: string) => {
    let value = romaji;
    if (pendingSokuon) {
      pendingSokuon = false;
      const first = value[0];
      if (first && !VOWELS.has(first)) {
        // Hepburn writes っち as "tch", not "cch".
        value = value.startsWith('ch') ? 't' + value : first + value;
      }
    }
    morae.push({ romaji: value, lengthened: 0 });
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const pair = ch + (chars[i + 1] ?? '');

    if (ch === SOKUON) {
      pendingSokuon = true;
      continue;
    }

    if (ch === LONG_MARK) {
      const prev = morae[morae.length - 1];
      if (prev && VOWELS.has(prev.romaji[prev.romaji.length - 1])) {
        prev.lengthened += 1;
      }
      continue;
    }

    if (DIGRAPHS[pair]) {
      push(DIGRAPHS[pair]);
      i++;
      continue;
    }

    if (MONOGRAPHS[ch]) {
      push(MONOGRAPHS[ch]);
      continue;
    }

    // Not kana. A sokuon waiting here has nothing to geminate, and it has no
    // sound of its own, so it contributes nothing rather than a literal.
    pendingSokuon = false;
    morae.push({ romaji: ch, lengthened: 0 });
  }

  // Merge repeated identical vowels into length (オオ -> ō). Modified Hepburn
  // keeps いい as "ii", so i is excluded.
  for (let i = morae.length - 1; i > 0; i--) {
    const cur = morae[i];
    const prev = morae[i - 1];
    if (cur.romaji.length !== 1 || !VOWELS.has(cur.romaji) || cur.romaji === 'i') continue;
    const prevVowel = prev.romaji[prev.romaji.length - 1];
    if (prevVowel !== cur.romaji) continue;
    prev.lengthened += 1 + cur.lengthened;
    morae.splice(i, 1);
  }

  return morae;
}

function renderMorae(morae: Mora[], style: RomajiStyle): string {
  let out = '';
  for (let i = 0; i < morae.length; i++) {
    const { romaji, lengthened } = morae[i];
    let text = romaji;

    if (lengthened > 0) {
      const vowel = text[text.length - 1];
      if (VOWELS.has(vowel)) {
        if (style === 'macron') {
          text = text.slice(0, -1) + (MACRONS[vowel] ?? vowel);
          // Beyond one extra beat there is no macron to stack, so repeat.
          if (lengthened > 1) text += vowel.repeat(lengthened - 1);
        } else if (style === 'none') {
          // Length is dropped entirely.
        } else {
          text += vowel.repeat(lengthened);
        }
      }
    }

    // Moraic n needs an apostrophe before a vowel or y so that 「きんえん」
    // reads kin'en rather than kinen.
    if (text === 'n') {
      const next = morae[i + 1]?.romaji;
      const head = next?.[0];
      if (head && (VOWELS.has(head) || head === 'y')) text = "n'";
    }

    out += text;
  }
  return out;
}

/**
 * Convert a kana string to romaji in the requested style.
 *
 * Transcription is faithful to the kana it is given: vowel length comes from ー
 * or a repeated vowel, never from guessing that オウ means a long o. That call
 * needs morphology — 王 is オー (ō) but 追う is オウ (ou) — and the analyser
 * makes it upstream by passing IPADIC's `pronunciation`, which has already
 * resolved the distinction.
 */
export function kanaToRomaji(kana: string, style: RomajiStyle = 'macron'): string {
  if (!kana) return '';
  // Wapuro spelling is literal: it never collapses vowels or adds macrons.
  const effective: RomajiStyle = style === 'wapuro' ? 'doubled' : style;
  const morae = toMorae(kana);
  if (style === 'wapuro') {
    // Undo the vowel merging so とうきょう comes back as "toukyou".
    return renderMoraeLiteral(kana);
  }
  return renderMorae(morae, effective);
}

/** Literal, IME-style transcription with no length collapsing. */
function renderMoraeLiteral(kana: string): string {
  const src = toKatakana(kana);
  const chars = [...src];
  let out = '';
  let pendingSokuon = false;
  let lastVowel = '';

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const pair = ch + (chars[i + 1] ?? '');

    if (ch === SOKUON) {
      pendingSokuon = true;
      continue;
    }
    if (ch === LONG_MARK) {
      out += lastVowel;
      continue;
    }

    let value: string | undefined;
    if (DIGRAPHS[pair]) {
      value = DIGRAPHS[pair];
      i++;
    } else {
      value = MONOGRAPHS[ch];
    }
    if (value === undefined) {
      out += ch;
      lastVowel = '';
      continue;
    }

    if (pendingSokuon) {
      pendingSokuon = false;
      const first = value[0];
      if (first && !VOWELS.has(first)) {
        value = value.startsWith('ch') ? 't' + value : first + value;
      }
    }
    if (value === 'n') {
      const nextHead = (DIGRAPHS[chars[i + 1] + (chars[i + 2] ?? '')] ??
        MONOGRAPHS[chars[i + 1]])?.[0];
      if (nextHead && (VOWELS.has(nextHead) || nextHead === 'y')) value = "n'";
    }
    out += value;
    const tail = value[value.length - 1];
    lastVowel = VOWELS.has(tail) ? tail : '';
  }
  return out;
}

/**
 * Does this kana end in っ?
 *
 * A trailing sokuon is not a sound — it doubles the consonant that follows it,
 * which may well be in the *next* token: the analyser splits 行った into 行っ
 * and た, so the gemination has to be carried across that boundary.
 */
export function endsWithSokuon(kana: string): boolean {
  const chars = [...toKatakana(kana)];
  return chars[chars.length - 1] === SOKUON;
}

/**
 * The consonant a preceding っ contributes, given the romaji that follows it.
 * Hepburn writes っ + ち as "tchi", so "chi" yields "t" rather than "c".
 * Anything that is not a plain consonant (a vowel, punctuation) yields nothing.
 */
export function geminationFor(nextRomaji: string): string {
  const head = nextRomaji[0];
  if (!head || !/[a-z]/.test(head) || VOWELS.has(head)) return '';
  return nextRomaji.startsWith('ch') ? 't' : head;
}

/** Capitalise the first letter, leaving macrons intact. */
export function capitalize(text: string): string {
  if (!text) return text;
  return text[0].toLocaleUpperCase() + text.slice(1);
}
