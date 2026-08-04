/**
 * Turns a selected run of Japanese text into the structure the panel renders:
 * full-sentence romaji, a kana reading, and one annotated entry per word.
 */

import { Dictionary } from './dict';
import { createTokenizer, type IpadicToken, type Tokenizer } from './tokenizer';
import {
  attachesToPrevious,
  functionWordNote,
  inflectionLabel,
  posDetailLabel,
  posLabel,
  punctuationRomaji,
} from './grammar';
import {
  containsJapanese,
  furiganaSegments,
  isKana,
  normalizeJapanese,
  toHiragana,
  toKatakana,
} from './kana';
import {
  capitalize,
  endsWithSokuon,
  geminationFor,
  kanaToRomaji,
  type RomajiStyle,
} from './romaji';
import type { Analysis, WordToken } from './types';

/** Sentence-final marks that get a space after them in romaji. */
const SENTENCE_ENDERS = new Set(['。', '！', '？', '．', '!', '?', '.']);

export interface AnalyzerAssets {
  /** Directory holding kuromoji's *.dat.gz files. */
  tokenizerBaseUrl: string;
  /** URL of the compiled JMdict table, or null to run without meanings. */
  dictionaryUrl: string | null;
}

export class Analyzer {
  private tokenizer: Tokenizer | null = null;
  private dictionary = new Dictionary();
  private initPromise: Promise<void> | null = null;
  private dictionaryError: string | null = null;

  get ready(): boolean {
    return this.tokenizer !== null;
  }

  get stats(): { dictionaryHeadwords: number; dictionaryError: string | null } {
    return {
      dictionaryHeadwords: this.dictionary.size,
      dictionaryError: this.dictionaryError,
    };
  }

  /**
   * Load the tokenizer and dictionary. The tokenizer is required; a dictionary
   * failure is recorded as a warning so the extension still gives romaji.
   */
  async init(assets: AnalyzerAssets, onProgress?: (message: string) => void): Promise<void> {
    if (this.tokenizer) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      onProgress?.('Loading Japanese tokenizer…');
      const tokenizerPromise = createTokenizer(assets.tokenizerBaseUrl, ({ loaded, total }) => {
        onProgress?.(`Loading tokenizer… ${loaded}/${total}`);
      });

      const dictionaryPromise = assets.dictionaryUrl
        ? this.dictionary.load(assets.dictionaryUrl).catch((err: unknown) => {
            this.dictionaryError = err instanceof Error ? err.message : String(err);
          })
        : Promise.resolve();

      this.tokenizer = await tokenizerPromise;
      onProgress?.('Loading dictionary…');
      await dictionaryPromise;
      onProgress?.('Ready');
    })();

    try {
      await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
    return;
  }

  analyze(rawText: string, style: RomajiStyle = 'macron'): Analysis {
    if (!this.tokenizer) throw new Error('Analyzer used before init()');
    const started = Date.now();

    const text = normalizeJapanese(rawText).trim();
    const warnings: string[] = [];
    if (this.dictionaryError) {
      warnings.push(`Word meanings unavailable: ${this.dictionaryError}`);
    }

    if (!text) {
      return { text: '', romaji: '', kana: '', tokens: [], warnings, elapsedMs: 0 };
    }

    const raw = this.tokenizer.tokenize(text);
    // Each token needs its successor: a token ending in っ carries no sound of
    // its own and instead doubles the next token's first consonant.
    const tokens = raw.map((token, index) => this.buildToken(token, style, raw[index + 1]));

    return {
      text,
      romaji: assembleRomaji(tokens),
      kana: tokens.map((t) => t.kana || t.surface).join(''),
      tokens,
      warnings,
      elapsedMs: Date.now() - started,
    };
  }

  private buildToken(
    token: IpadicToken,
    style: RomajiStyle,
    next?: IpadicToken,
  ): WordToken {
    const surface = token.surface_form;
    const isPunctuation = token.pos === '記号';

    // `reading` is the written kana; `pronunciation` is how it is said, which
    // is what romaji needs (は as a particle reads ワ, 東京 reads トーキョー).
    const writtenReading = token.reading && token.reading !== '*' ? token.reading : fallbackReading(surface);
    const spokenReading =
      token.pronunciation && token.pronunciation !== '*' ? token.pronunciation : writtenReading;

    const kana = writtenReading ? toHiragana(writtenReading) : '';
    const romaji = this.romajiFor(
      token,
      surface,
      writtenReading,
      spokenReading,
      style,
      isPunctuation,
      next,
    );

    const detail = token.pos_detail_1;
    const dictionaryForm =
      token.basic_form && token.basic_form !== '*' && token.basic_form !== surface
        ? token.basic_form
        : undefined;

    const word: WordToken = {
      surface,
      reading: writtenReading,
      kana,
      romaji,
      furigana: furiganaSegments(surface, writtenReading),
      pos: posLabel(token.pos),
      posJa: token.pos,
      posDetail: posDetailLabel(token.pos, detail),
      dictionaryForm,
      inflection: inflectionLabel(token.conjugated_form),
      glosses: [],
      attachToPrevious: attachesToPrevious(token.pos, detail, surface, token.basic_form),
      isPunctuation,
    };

    if (isPunctuation) return word;

    // Curated notes win for particles and auxiliaries: JMdict's entries for
    // these are accurate but far too long to read mid-sentence.
    const curated =
      token.pos === '助詞' || token.pos === '助動詞' || detail === '非自立'
        ? functionWordNote(surface, token.basic_form)
        : undefined;

    if (curated) {
      word.glosses = curated.glosses;
      word.note = curated.note;
    }

    if (this.dictionary.ready) {
      const lookupKey = dictionaryForm ?? surface;
      const { glosses, common } = this.dictionary.glossesFor(surface, lookupKey, kana);
      if (glosses.length && !curated) word.glosses = glosses;
      word.common = common;

      if (dictionaryForm) {
        const reading = this.readingOf(dictionaryForm);
        if (reading) {
          word.dictionaryFormKana = reading;
          word.dictionaryFormRomaji = kanaToRomaji(toKatakana(reading), style);
        }
      }
    }

    return word;
  }

  /** Best-known kana reading for a headword, used for dictionary forms. */
  private readingOf(word: string): string | undefined {
    if ([...word].every((ch) => isKana(ch))) return toHiragana(word);
    const entries = this.dictionary.lookupExact(word);
    const reading = entries.find((e) => e.reading && e.reading !== word)?.reading;
    return reading ? toHiragana(reading) : undefined;
  }

  private romajiFor(
    token: IpadicToken,
    surface: string,
    writtenReading: string,
    spokenReading: string,
    style: RomajiStyle,
    isPunctuation: boolean,
    next?: IpadicToken,
  ): string {
    if (isPunctuation) return punctuationRomaji(surface) ?? surface;

    // The particle を is written ヲ but romanised "o" in Hepburn.
    if (token.pos === '助詞' && surface === 'を') return style === 'wapuro' ? 'wo' : 'o';

    // Wapuro spelling follows what you would type, so it uses the written
    // reading rather than the spoken one.
    const source = style === 'wapuro' ? writtenReading : spokenReading;
    if (!source) return containsJapanese(surface) ? '' : surface;

    const romaji = kanaToRomaji(source, style);
    // 行った tokenises as 行っ + た, so the gemination has to reach across the
    // boundary: 行っ becomes "it" and た stays "ta", giving "itta".
    if (!endsWithSokuon(source)) return romaji;
    return romaji + geminationFor(this.readingOfToken(next, style));
  }

  /** The romaji a following token will start with, for gemination. */
  private readingOfToken(token: IpadicToken | undefined, style: RomajiStyle): string {
    if (!token) return '';
    const written = token.reading && token.reading !== '*' ? token.reading : '';
    const spoken = token.pronunciation && token.pronunciation !== '*' ? token.pronunciation : written;
    const source = style === 'wapuro' ? written : spoken;
    return source ? kanaToRomaji(source, style) : '';
  }
}

function fallbackReading(surface: string): string {
  // Unknown words get no reading from IPADIC. If the surface is already kana we
  // can read it directly; otherwise we genuinely do not know.
  return [...surface].every((ch) => isKana(ch)) ? toKatakana(surface) : '';
}

/** Join token romaji with Hepburn word spacing. */
export function assembleRomaji(tokens: WordToken[]): string {
  let out = '';
  let startOfSentence = true;

  for (const token of tokens) {
    const piece = token.romaji;
    if (!piece) continue;

    if (out && !token.attachToPrevious) out += ' ';
    out += startOfSentence && !token.isPunctuation ? capitalize(piece) : piece;

    startOfSentence = token.isPunctuation && SENTENCE_ENDERS.has(token.surface);
  }
  return out;
}

/**
 * Word-by-word English gloss, used when no model translation is configured.
 * Deliberately labelled as literal in the UI - it is a reading aid, not a
 * translation.
 */
export function literalGloss(tokens: WordToken[]): string {
  const parts: string[] = [];
  for (const token of tokens) {
    if (token.isPunctuation) continue;
    const gloss = token.glosses[0];
    if (!gloss) continue;
    parts.push(gloss);
  }
  return parts.join(' · ');
}
