/**
 * Binds each provider to its API client.
 *
 * Importing this pulls in the SDKs, so only the background service worker
 * should. Anything that just needs labels or origins imports ./registry.
 */

import { askWithClaude, translateWithClaude } from './anthropic';
import { askWithOpenAI, translateWithOpenAI } from './openai';
import { askWithOpenRouter, translateWithOpenRouter } from './openrouter';
import type { ProviderId } from './registry';
import type { AskRequest, TranslationOutput, TranslationRequest } from './shared';

export * from './registry';
export type { AskRequest, TranslationOutput, TranslationRequest };

type Translator = (request: TranslationRequest) => Promise<TranslationOutput>;
type Asker = (request: AskRequest) => Promise<string>;

const TRANSLATORS: Record<ProviderId, Translator> = {
  anthropic: translateWithClaude,
  openai: translateWithOpenAI,
  openrouter: translateWithOpenRouter,
};

const ASKERS: Record<ProviderId, Asker> = {
  anthropic: askWithClaude,
  openai: askWithOpenAI,
  openrouter: askWithOpenRouter,
};

export function translatorFor(id: string): Translator {
  return TRANSLATORS[id as ProviderId] ?? TRANSLATORS.anthropic;
}

export function askerFor(id: string): Asker {
  return ASKERS[id as ProviderId] ?? ASKERS.anthropic;
}
