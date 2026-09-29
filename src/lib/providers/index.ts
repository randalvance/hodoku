/**
 * Binds each provider to its API client.
 *
 * Importing this pulls in the SDKs, so only the background service worker
 * should. Anything that just needs labels or origins imports ./registry.
 */

import { translateWithClaude } from './anthropic';
import { translateWithOpenAI } from './openai';
import { translateWithOpenRouter } from './openrouter';
import type { ProviderId } from './registry';
import type { TranslationOutput, TranslationRequest } from './shared';

export * from './registry';
export type { TranslationOutput, TranslationRequest };

type Translator = (request: TranslationRequest) => Promise<TranslationOutput>;

const TRANSLATORS: Record<ProviderId, Translator> = {
  anthropic: translateWithClaude,
  openai: translateWithOpenAI,
  openrouter: translateWithOpenRouter,
};

export function translatorFor(id: string): Translator {
  return TRANSLATORS[id as ProviderId] ?? TRANSLATORS.anthropic;
}
