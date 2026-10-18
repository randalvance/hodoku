/**
 * Turns a model-produced breakdown into the same WordToken shape the offline
 * analyser emits, so the panel renders both identically.
 *
 * The model is asked for readings, not romaji: the romaji is derived here with
 * the user's chosen style, exactly as the offline path does it, so switching
 * style or provider never changes how a sentence is romanised. The model's
 * entries are matched against the sentence text in order; anything it
 * invented is dropped, and anything it skipped is carried as a plain token, so
 * the breakdown always accounts for the whole sentence.
 */

import { assembleRomaji } from './analyzer';
import { punctuationRomaji } from './grammar';
import { containsJapanese, furiganaSegments, isKana, toHiragana, toKatakana } from './kana';
import { kanaToRomaji, type RomajiStyle } from './romaji';
import type { AiForm, AiInflection, AiPos, AiWord, Analysis, WordToken } from './types';

/** Nothing but punctuation, symbols and whitespace. */
const PUNCTUATION_ONLY = /^[\p{P}\p{S}\s]+$/u;

/** Learner-facing labels for the schema's part-of-speech enum. */
const POS_LABELS: Record<AiPos, string> = {
  noun: 'Noun',
  pronoun: 'Pronoun',
  number: 'Number',
  counter: 'Counter',
  verb: 'Verb',
  'i-adjective': 'I-adjective',
  'na-adjective': 'Na-adjective',
  adverb: 'Adverb',
  particle: 'Particle',
  auxiliary: 'Auxiliary',
  copula: 'Copula',
  conjunction: 'Conjunction',
  prefix: 'Prefix',
  suffix: 'Suffix',
  expression: 'Expression',
  interjection: 'Interjection',
  punctuation: 'Punctuation',
  other: 'Word',
};

/** Learner-facing names for the schema's conjugation enum. */
const FORM_LABELS: Record<Exclude<AiForm, 'none'>, string> = {
  dictionary: 'Dictionary form',
  stem: 'Stem',
  te: 'Te-form',
  ta: 'Ta-form',
  nai: 'Nai-form',
  ba: 'Ba-form',
  tara: 'Tara-form',
  volitional: 'Volitional',
  imperative: 'Imperative',
  potential: 'Potential',
  passive: 'Passive',
  causative: 'Causative',
  'causative-passive': 'Causative-passive',
  other: 'Inflected',
};

/**
 * The inflection facts as one label, in the same style as the offline
 * analyser's: "Te-form + いる, polite", "Past, negative". Undefined when there
 * is nothing to say, so uninflected words get no tag.
 */
export function aiInflectionLabel(inflection: AiInflection): string | undefined {
  const head: string[] = [];
  if (inflection.form !== 'none') head.push(FORM_LABELS[inflection.form]);
  if (inflection.progressive) head.push('いる');
  if (inflection.auxiliary) head.push(inflection.auxiliary);

  const qualifiers: string[] = [];
  if (inflection.past) qualifiers.push('past');
  if (inflection.negative) qualifiers.push('negative');
  if (inflection.polite) qualifiers.push('polite');

  const label = [head.join(' + '), qualifiers.join(', ')].filter(Boolean).join(', ');
  return label || undefined;
}

function allKana(text: string): boolean {
  return text.length > 0 && [...text].every((ch) => isKana(ch));
}

/**
 * Romaji for a word, from the reading the style wants: keyboard spelling
 * follows what is written, the Hepburn styles follow what is said.
 */
function romajiFor(word: AiWord, surface: string, style: RomajiStyle): string {
  // The particle を is written ヲ but romanised "o" in Hepburn.
  if (surface === 'を' && word.pos === 'particle') return style === 'wapuro' ? 'wo' : 'o';

  const written = toKatakana(word.reading || (allKana(surface) ? surface : ''));
  // One pronunciation element per romaji word; the converter passes the
  // spaces through, so a verb phrase kept whole still reads "benkyō shite imasu".
  const spoken = toKatakana(word.pronunciation.join(' ')) || written;
  const source = style === 'wapuro' ? written : spoken;
  if (!source) return containsJapanese(surface) ? '' : surface;
  return kanaToRomaji(source, style);
}

function wordToken(word: AiWord, surface: string, style: RomajiStyle): WordToken {
  const isPunctuation = PUNCTUATION_ONLY.test(surface) || word.pos === 'punctuation';
  const reading = toHiragana(word.reading);
  const dictionaryForm = word.dictionaryForm && word.dictionaryForm !== surface ? word.dictionaryForm : undefined;

  const token: WordToken = {
    surface,
    reading: toKatakana(reading),
    kana: isPunctuation ? '' : reading,
    romaji: isPunctuation ? (punctuationRomaji(surface) ?? surface) : romajiFor(word, surface, style),
    furigana: isPunctuation ? [{ text: surface }] : furiganaSegments(surface, reading),
    pos: isPunctuation ? POS_LABELS.punctuation : POS_LABELS[word.pos],
    posJa: '',
    dictionaryForm,
    inflection: isPunctuation ? undefined : aiInflectionLabel(word.inflection),
    glosses: !isPunctuation && word.meaning ? [word.meaning] : [],
    note: !isPunctuation && word.note ? word.note : undefined,
    // Punctuation hangs off the previous word in romaji, as the offline path
    // does it; everything else the model returns is a whole word.
    attachToPrevious: isPunctuation,
    isPunctuation,
  };

  if (dictionaryForm && allKana(dictionaryForm)) {
    token.dictionaryFormKana = toHiragana(dictionaryForm);
    token.dictionaryFormRomaji = kanaToRomaji(toKatakana(dictionaryForm), style);
  }
  return token;
}

/** A stretch of the sentence the model did not account for. */
function fillerToken(chunk: string, style: RomajiStyle): WordToken | null {
  if (!chunk.trim()) return null;
  const isPunctuation = PUNCTUATION_ONLY.test(chunk);
  const kana = !isPunctuation && allKana(chunk) ? toHiragana(chunk) : '';
  return {
    surface: chunk,
    reading: toKatakana(kana),
    kana,
    romaji: isPunctuation
      ? (punctuationRomaji(chunk) ?? chunk)
      : kana
        ? kanaToRomaji(toKatakana(kana), style)
        : containsJapanese(chunk)
          ? ''
          : chunk,
    furigana: [{ text: chunk }],
    pos: isPunctuation ? 'Punctuation' : 'Word',
    posJa: '',
    glosses: [],
    attachToPrevious: isPunctuation,
    isPunctuation,
  };
}

/**
 * Build tokens for `text` from the model's entries.
 *
 * Returns null when too few entries can be found in the text to trust the
 * result — the caller then keeps the offline breakdown.
 */
export function tokensFromAiWords(
  text: string,
  words: AiWord[],
  style: RomajiStyle,
): WordToken[] | null {
  const tokens: WordToken[] = [];
  let cursor = 0;
  let matched = 0;
  let offered = 0;

  for (const word of words) {
    const surface = word.surface.trim();
    if (!surface) continue;
    offered++;

    const index = text.indexOf(surface, cursor);
    // Not in the sentence from here on: the model invented or reordered it.
    if (index === -1) continue;

    if (index > cursor) {
      const filler = fillerToken(text.slice(cursor, index), style);
      if (filler) tokens.push(filler);
    }
    tokens.push(wordToken(word, surface, style));
    matched++;
    cursor = index + surface.length;
  }

  if (cursor < text.length) {
    const filler = fillerToken(text.slice(cursor), style);
    if (filler) tokens.push(filler);
  }

  if (!matched || matched * 2 < offered) return null;
  return tokens;
}

/**
 * Replace the offline reading and breakdown with the model's.
 *
 * Returns false, leaving the analysis untouched, when the model's entries do
 * not line up with the sentence.
 */
export function applyAiFields(analysis: Analysis, words: AiWord[], style: RomajiStyle): boolean {
  const tokens = tokensFromAiWords(analysis.text, words, style);
  if (!tokens) return false;

  analysis.tokens = tokens;
  analysis.romaji = assembleRomaji(tokens);
  analysis.kana = tokens.map((token) => token.kana || token.surface).join('');
  analysis.aiFields = true;
  return true;
}
