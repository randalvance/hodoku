/**
 * Claude backend for the optional sentence translation, and for follow-up
 * questions about a sentence.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  buildAskMessages,
  buildAskSystem,
  buildUserMessage,
  outputSchema,
  parseAnswer,
  parseOutput,
  systemPrompt,
  type AskRequest,
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

function createClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    // The service worker is a browser context. The key is the user's own and
    // goes nowhere but api.anthropic.com.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });
}

/** One Messages call, with the per-model extras the model accepts. */
async function createMessage(
  apiKey: string,
  model: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const caps = CAPABILITIES[model] ?? UNKNOWN_MODEL;
  const client = createClient(apiKey);

  const request: Record<string, unknown> = {
    model,
    ...params,
    ...(caps.adaptiveThinking ? { thinking: { type: 'adaptive' } } : {}),
  };
  if (caps.effort) {
    // Neither request is reasoning-heavy; low effort keeps the panel
    // responsive and the cost per lookup small.
    request.output_config = { ...(request.output_config as object | undefined), effort: 'low' };
  }

  const betas: string[] = [];
  if (caps.serverSideFallback) {
    // A safety classifier can decline a request; the fallback re-runs it on
    // another model server-side rather than handing the user an error.
    betas.push('server-side-fallback-2026-07-01');
    request.fallbacks = 'default';
  }

  let message;
  try {
    message = await client.beta.messages.create(
      { ...request, ...(betas.length ? { betas } : {}) } as never,
      { signal },
    );
  } catch (err) {
    throw describeError(err);
  }

  if (message.stop_reason === 'refusal') {
    throw new Error('The model declined this request.');
  }

  return message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

export async function translateWithClaude(
  request: TranslationRequest,
): Promise<TranslationOutput> {
  const fields = Boolean(request.fields);
  const text = await createMessage(
    request.apiKey,
    request.model,
    {
      // Translating one sentence: a few hundred output tokens at most, or a
      // couple of thousand when the breakdown is included.
      max_tokens: fields ? 4096 : 2048,
      system: systemPrompt(fields),
      messages: [{ role: 'user', content: buildUserMessage(request) }],
      output_config: { format: { type: 'json_schema', schema: outputSchema(fields) } },
    },
    request.signal,
  );
  return parseOutput(text);
}

export async function askWithClaude(request: AskRequest): Promise<string> {
  const text = await createMessage(
    request.apiKey,
    request.model,
    {
      max_tokens: 1024,
      system: buildAskSystem(request),
      messages: buildAskMessages(request),
    },
    request.signal,
  );
  return parseAnswer(text);
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
