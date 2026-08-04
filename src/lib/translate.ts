/**
 * Optional natural-language translation.
 *
 * A bonus on top of the offline analysis: the extension always produces romaji,
 * a word-by-word breakdown, and dictionary glosses without a network call. A
 * user who supplies their own API key additionally gets a fluent sentence
 * translation and a short grammar note, from either Claude or GPT.
 *
 * Requests run in the background service worker, which holds the host
 * permission — a content script could not make this call.
 */

import { translatorFor } from './providers';
import type { ProviderId } from './providers/registry';
import type { Translation, WordToken } from './types';
import { literalGloss } from './analyzer';

export { PROVIDERS, PROVIDER_IDS, getProvider } from './providers/registry';
export type { ProviderId, ProviderInfo } from './providers/registry';

export interface TranslateOptions {
  provider: ProviderId;
  apiKey: string;
  model: string;
  text: string;
  tokens: WordToken[];
  signal?: AbortSignal;
}

export interface TranslateResult {
  translation: Translation;
  /** Structure-preserving rendering, shown under the translation. */
  literal?: string;
  note?: string;
}

export async function translateSentence(options: TranslateOptions): Promise<TranslateResult> {
  const translate = translatorFor(options.provider);

  const output = await translate({
    apiKey: options.apiKey,
    model: options.model,
    text: options.text,
    tokens: options.tokens,
    signal: options.signal,
  });

  return {
    translation: { text: output.translation, source: 'ai', model: options.model },
    literal: output.literal || undefined,
    note: output.note || undefined,
  };
}

/** Offline stand-in used when no provider is configured. */
export function glossTranslation(tokens: WordToken[]): Translation | undefined {
  const gloss = literalGloss(tokens);
  return gloss ? { text: gloss, source: 'gloss' } : undefined;
}
