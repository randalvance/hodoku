/**
 * Provider-agnostic pieces of the translation request.
 *
 * Both providers get the same instructions and the same output contract, so the
 * panel renders identically whichever one is configured and switching provider
 * is not a change in behaviour.
 */

import type { WordToken } from '../types';

export const SYSTEM_PROMPT = `You translate Japanese into natural English for a language learner.

You are given one Japanese sentence or phrase, plus the morphological analysis the extension already computed. Return:
- "translation": fluent, idiomatic English. Match the register of the original (casual stays casual, keigo reads as polite).
- "literal": a close, structure-preserving rendering that shows how the Japanese is put together. Keep Japanese word order where English tolerates it.
- "note": at most one sentence on the single most useful grammar point for a learner, or an empty string when nothing stands out. Do not restate the translation.

Translate only what is present. If the text is a fragment, translate it as a fragment rather than inventing a subject or completing the sentence.`;

/**
 * The shape both providers are constrained to.
 *
 * `additionalProperties: false` plus every key listed in `required` is what
 * OpenAI's strict mode demands, and Anthropic accepts the same schema, so one
 * definition serves both.
 */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    translation: { type: 'string' },
    literal: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['translation', 'literal', 'note'],
  additionalProperties: false,
} as const;

export interface TranslationRequest {
  apiKey: string;
  model: string;
  /** The Japanese being translated. */
  text: string;
  tokens: WordToken[];
  signal?: AbortSignal;
}

export interface TranslationOutput {
  translation: string;
  literal: string;
  note: string;
}

/**
 * Compact rendering of the analysis, so the model works from the same readings
 * the user is looking at rather than re-deriving them.
 */
export function describeTokens(tokens: WordToken[]): string {
  return tokens
    .filter((t) => !t.isPunctuation)
    .map((t) => {
      const parts = [t.surface];
      if (t.kana && t.kana !== t.surface) parts.push(t.kana);
      if (t.dictionaryForm) parts.push(`← ${t.dictionaryForm}`);
      parts.push(t.posDetail ?? t.pos);
      if (t.glosses.length) parts.push(t.glosses.slice(0, 3).join(', '));
      return parts.join(' | ');
    })
    .join('\n');
}

export function buildUserMessage(request: TranslationRequest): string {
  return (
    `Japanese:\n${request.text}\n\n` +
    'Morphological analysis (surface | reading | dictionary form | part of speech | glosses):\n' +
    describeTokens(request.tokens)
  );
}

/** Parse and validate whatever the model returned. */
export function parseOutput(raw: string): TranslationOutput {
  if (!raw.trim()) throw new Error('The translation came back empty.');

  let parsed: Partial<TranslationOutput>;
  try {
    parsed = JSON.parse(raw) as Partial<TranslationOutput>;
  } catch {
    // Structured outputs make this unlikely, but a response truncated by the
    // output-token cap would land here.
    throw new Error('Could not read the translation response.');
  }

  if (!parsed.translation) throw new Error('The translation came back empty.');
  return {
    translation: parsed.translation,
    literal: parsed.literal ?? '',
    note: parsed.note ?? '',
  };
}
