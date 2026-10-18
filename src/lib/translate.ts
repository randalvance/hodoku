/**
 * Optional model-backed features.
 *
 * A bonus on top of the offline analysis: the extension always produces romaji,
 * a word-by-word breakdown, and dictionary glosses without a network call. A
 * user who supplies their own API key additionally gets a fluent sentence
 * translation and templated notes, can have the model produce the reading and
 * breakdown too, and can ask it questions about the sentence.
 *
 * Requests run in the background service worker, which holds the host
 * permission — a content script could not make this call.
 */

import { askerFor, translatorFor } from './providers';
import type { ProviderId } from './providers/registry';
import type { AiWord, AskTurn, Explanation, Translation, WordToken } from './types';
import { literalGloss } from './analyzer';

export { PROVIDERS, PROVIDER_IDS, getProvider } from './providers/registry';
export type { ProviderId, ProviderInfo } from './providers/registry';

export interface TranslateOptions {
  provider: ProviderId;
  apiKey: string;
  model: string;
  text: string;
  tokens: WordToken[];
  /** Also ask for the reading and word breakdown. */
  fields?: boolean;
  signal?: AbortSignal;
}

export interface TranslateResult {
  translation: Translation;
  /** Structure-preserving rendering, shown under the translation. */
  literal?: string;
  explanation: Explanation;
  /** The model's breakdown, when it was asked for. */
  words?: AiWord[];
}

export async function translateSentence(options: TranslateOptions): Promise<TranslateResult> {
  const translate = translatorFor(options.provider);

  const output = await translate({
    apiKey: options.apiKey,
    model: options.model,
    text: options.text,
    tokens: options.tokens,
    fields: options.fields,
    signal: options.signal,
  });

  return {
    translation: { text: output.translation, source: 'ai', model: options.model },
    literal: output.literal || undefined,
    explanation: output.explanation,
    words: output.words,
  };
}

export interface AskOptions {
  provider: ProviderId;
  apiKey: string;
  model: string;
  text: string;
  tokens: WordToken[];
  translation?: string;
  history: AskTurn[];
  question: string;
  signal?: AbortSignal;
}

/** A free-form answer to a question about the sentence. */
export async function askAboutSentence(options: AskOptions): Promise<string> {
  const ask = askerFor(options.provider);
  return ask({
    apiKey: options.apiKey,
    model: options.model,
    text: options.text,
    tokens: options.tokens,
    translation: options.translation,
    history: options.history,
    question: options.question,
    signal: options.signal,
  });
}

/** Offline stand-in used when no provider is configured. */
export function glossTranslation(tokens: WordToken[]): Translation | undefined {
  const gloss = literalGloss(tokens);
  return gloss ? { text: gloss, source: 'gloss' } : undefined;
}
