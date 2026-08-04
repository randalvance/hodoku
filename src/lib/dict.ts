/**
 * Runtime access to the compiled JMdict lookup table produced by
 * scripts/build-dict.mjs.
 *
 * The table is a gzipped JSON object mapping a headword to a packed string of
 * records, so a lookup is one property access plus a cheap split. See the build
 * script for the exact framing.
 */

import type { DictionaryEntry } from './types';
import { toHiragana } from './kana';

const RS = ''; // between entries sharing a headword
const US = ''; // between fields of one entry
const GS = ''; // between senses

/** JMdict part-of-speech codes worth spelling out in the UI. */
const POS_CODE_LABELS: Record<string, string> = {
  n: 'noun',
  'n-adv': 'adverbial noun',
  'n-suf': 'noun suffix',
  'n-pref': 'noun prefix',
  'n-t': 'temporal noun',
  pn: 'pronoun',
  adj_i: 'i-adjective',
  'adj-i': 'i-adjective',
  'adj-na': 'na-adjective',
  'adj-no': 'no-adjective',
  'adj-pn': 'pre-noun adjectival',
  adv: 'adverb',
  'adv-to': 'adverb (と)',
  aux: 'auxiliary',
  'aux-v': 'auxiliary verb',
  'aux-adj': 'auxiliary adjective',
  conj: 'conjunction',
  cop: 'copula',
  ctr: 'counter',
  exp: 'expression',
  int: 'interjection',
  num: 'numeric',
  prt: 'particle',
  pref: 'prefix',
  suf: 'suffix',
  unc: 'unclassified',
  v1: 'ichidan verb',
  'v1-s': 'ichidan verb (くれる)',
  v5b: 'godan verb (-bu)',
  v5g: 'godan verb (-gu)',
  v5k: 'godan verb (-ku)',
  'v5k-s': 'godan verb (行く)',
  v5m: 'godan verb (-mu)',
  v5n: 'godan verb (-nu)',
  v5r: 'godan verb (-ru)',
  'v5r-i': 'godan verb (-ru, irregular)',
  v5s: 'godan verb (-su)',
  v5t: 'godan verb (-tsu)',
  v5u: 'godan verb (-u)',
  'v5u-s': 'godan verb (-u, special)',
  v5aru: 'godan verb (-aru)',
  vk: 'kuru verb',
  vs: 'suru verb',
  'vs-i': 'suru verb (irregular)',
  'vs-s': 'suru verb (special)',
  vt: 'transitive',
  vi: 'intransitive',
  vz: 'zuru verb',
};

export function describePosCode(code: string): string {
  return POS_CODE_LABELS[code] ?? code;
}

export class Dictionary {
  private table: Record<string, string> | null = null;
  private loading: Promise<void> | null = null;

  get ready(): boolean {
    return this.table !== null;
  }

  /** Number of headwords, for the diagnostics panel. */
  get size(): number {
    return this.table ? Object.keys(this.table).length : 0;
  }

  /**
   * Fetch and decompress the table. Safe to call repeatedly; the work happens
   * once and every caller awaits the same promise.
   */
  async load(url: string): Promise<void> {
    if (this.table) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Dictionary fetch failed: ${res.status}`);
      let text: string;
      if (typeof DecompressionStream === 'function' && res.body) {
        const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
        text = await new Response(stream).text();
      } else {
        // Should not happen in any Chrome that supports MV3, but keep the
        // failure legible rather than a stack trace about a bad gzip header.
        throw new Error('DecompressionStream is unavailable in this runtime');
      }
      this.table = JSON.parse(text) as Record<string, string>;
    })();

    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private decode(headword: string, packed: string): DictionaryEntry[] {
    return packed.split(RS).map((record) => {
      const [reading, common, pos, glossBlob] = record.split(US);
      const posCodes = pos ? pos.split(',') : [];
      const senses = (glossBlob ?? '')
        .split(GS)
        .filter(Boolean)
        .map((sense) => ({ pos: posCodes, glosses: sense.split(';') }));
      return {
        word: headword,
        reading: reading || headword,
        senses,
        common: common === '1',
      };
    });
  }

  /** Look up one exact headword. */
  lookupExact(word: string): DictionaryEntry[] {
    if (!this.table || !word) return [];
    const packed = this.table[word];
    return packed ? this.decode(word, packed) : [];
  }

  /**
   * Look up a token, trying the most specific spelling first: the surface form,
   * then the dictionary form, then the kana reading. Kana-only fallback is last
   * because it is the most likely to collide with unrelated homophones.
   */
  lookup(surface: string, dictionaryForm?: string, kana?: string): DictionaryEntry[] {
    const candidates = [surface, dictionaryForm, kana, kana && toHiragana(kana)].filter(
      (c): c is string => Boolean(c),
    );
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const hits = this.lookupExact(candidate);
      if (hits.length) return hits;
    }
    return [];
  }

  /** Flattened English glosses for a token, de-duplicated and capped. */
  glossesFor(
    surface: string,
    dictionaryForm?: string,
    kana?: string,
    limit = 6,
  ): { glosses: string[]; common: boolean; posCodes: string[] } {
    const entries = this.lookup(surface, dictionaryForm, kana);
    if (!entries.length) return { glosses: [], common: false, posCodes: [] };

    const glosses: string[] = [];
    const seen = new Set<string>();
    let common = false;
    const posCodes = new Set<string>();

    for (const entry of entries) {
      if (entry.common) common = true;
      for (const sense of entry.senses) {
        for (const code of sense.pos) posCodes.add(code);
        for (const gloss of sense.glosses) {
          const key = gloss.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          glosses.push(gloss);
          if (glosses.length >= limit) return { glosses, common, posCodes: [...posCodes] };
        }
      }
    }
    return { glosses, common, posCodes: [...posCodes] };
  }
}
