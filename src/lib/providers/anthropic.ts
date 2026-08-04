/**
 * Claude backend for the optional sentence translation.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  OUTPUT_SCHEMA,
  SYSTEM_PROMPT,
  buildUserMessage,
  parseOutput,
  type TranslationOutput,
  type TranslationRequest,
} from './shared';

/**
 * Per-model request shape. Effort and adaptive thinking are not accepted by
 * every model, and sending them where unsupported is a 400 rather than a
 * silently ignored field.
 */
interface ModelCapabilities {
  effort: boolean;
  adaptiveThinking: boolean;
  serverSideFallback: boolean;
}

const CAPABILITIES: Record<string, ModelCapabilities> = {
  'claude-opus-5': { effort: true, adaptiveThinking: true, serverSideFallback: true },
  'claude-sonnet-5': { effort: true, adaptiveThinking: true, serverSideFallback: false },
  'claude-haiku-4-5': { effort: false, adaptiveThinking: false, serverSideFallback: false },
};

/** Conservative defaults for a model we do not have a capability entry for. */
const UNKNOWN_MODEL: ModelCapabilities = {
  effort: false,
  adaptiveThinking: false,
  serverSideFallback: false,
};

export async function translateWithClaude(
  request: TranslationRequest,
): Promise<TranslationOutput> {
  const { apiKey, model, signal } = request;
  const caps = CAPABILITIES[model] ?? UNKNOWN_MODEL;

  const client = new Anthropic({
    apiKey,
    // The service worker is a browser context. The key is the user's own and
    // goes nowhere but api.anthropic.com.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });

  const params: Record<string, unknown> = {
    model,
    // Translating one sentence: a few hundred output tokens at most.
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(request) }],
    output_config: {
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      // Translation is not reasoning-heavy; low effort keeps the panel
      // responsive and the cost per lookup small.
      ...(caps.effort ? { effort: 'low' } : {}),
    },
    ...(caps.adaptiveThinking ? { thinking: { type: 'adaptive' } } : {}),
  };

  const betas: string[] = [];
  if (caps.serverSideFallback) {
    // A safety classifier can decline a request; the fallback re-runs it on
    // another model server-side rather than handing the user an error.
    betas.push('server-side-fallback-2026-07-01');
    params.fallbacks = 'default';
  }

  let message;
  try {
    message = await client.beta.messages.create(
      { ...params, ...(betas.length ? { betas } : {}) } as never,
      { signal },
    );
  } catch (err) {
    throw describeError(err);
  }

  if (message.stop_reason === 'refusal') {
    throw new Error('The model declined to translate this text.');
  }

  const text = message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return parseOutput(text);
}

/** Turn SDK errors into something readable in a 400px-wide panel. */
function describeError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error('Anthropic rejected the API key. Check it in the extension options.');
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new Error('This API key does not have access to the selected model.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new Error('Rate limited by Anthropic. Try again in a moment.');
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new Error('Model not found. Pick a different one in the options.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new Error('Could not reach the Anthropic API.');
  }
  if (err instanceof Anthropic.APIError) {
    return new Error(`Anthropic API error ${err.status ?? ''}: ${err.message}`.trim());
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}
