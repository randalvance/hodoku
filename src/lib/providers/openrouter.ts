/**
 * OpenRouter backend for the optional sentence translation.
 *
 * OpenRouter speaks the OpenAI Chat Completions protocol, so this reuses the
 * OpenAI client pointed at a different base URL. Its Responses support is
 * newer and patchier across the models it routes to; Chat Completions with a
 * JSON schema `response_format` is what the broadest set of models accepts.
 */

import OpenAI from 'openai';
import {
  OUTPUT_SCHEMA,
  SYSTEM_PROMPT,
  buildUserMessage,
  parseOutput,
  type TranslationOutput,
  type TranslationRequest,
} from './shared';

const BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Same headroom as the OpenAI backend: many routed models reason before they
 * answer, and those tokens count against this ceiling.
 */
const MAX_OUTPUT_TOKENS = 4096;

export async function translateWithOpenRouter(
  request: TranslationRequest,
): Promise<TranslationOutput> {
  const { apiKey, model, signal } = request;

  const client = new OpenAI({
    apiKey,
    baseURL: BASE_URL,
    // The user's own key, used from the extension's background worker, sent
    // only to openrouter.ai.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    // Optional app attribution on OpenRouter's side; carries nothing personal.
    defaultHeaders: { 'X-Title': 'Hodoku' },
  });

  const params = {
    model,
    messages: [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: buildUserMessage(request) },
    ],
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: {
      type: 'json_schema' as const,
      json_schema: {
        name: 'japanese_translation',
        schema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        strict: true,
      },
    },
    // OpenRouter's unified reasoning control. Models without reasoning ignore
    // it; translation is not reasoning-heavy, so keep latency and cost down.
    reasoning: { effort: 'low', exclude: true },
  };

  let completion;
  try {
    completion = await client.chat.completions.create(params as never, { signal });
  } catch (err) {
    throw describeError(err);
  }

  const choice = completion.choices?.[0];
  if (!choice) throw new Error('The translation came back empty.');
  if (choice.message.refusal) {
    throw new Error('The model declined to translate this text.');
  }
  if (choice.finish_reason === 'length') {
    throw new Error('The translation was cut off before it finished.');
  }

  return parseOutput(choice.message.content ?? '');
}

/** Turn SDK errors into something readable in a 400px-wide panel. */
function describeError(err: unknown): Error {
  if (err instanceof OpenAI.AuthenticationError) {
    return new Error('OpenRouter rejected the API key. Check it in the extension options.');
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return new Error('This API key does not have access to the selected model.');
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new Error('Rate limited by OpenRouter or the model provider. Try again in a moment.');
  }
  if (err instanceof OpenAI.NotFoundError) {
    return new Error('Model not found on OpenRouter. Pick a different one in the options.');
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new Error('Could not reach the OpenRouter API.');
  }
  if (err instanceof OpenAI.APIError) {
    // OpenRouter uses 402 for an account that has run out of credits.
    if (err.status === 402) {
      return new Error('The OpenRouter account is out of credits.');
    }
    return new Error(`OpenRouter API error ${err.status ?? ''}: ${err.message}`.trim());
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}
