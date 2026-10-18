/**
 * OpenRouter backend for the optional sentence translation, and for follow-up
 * questions about a sentence.
 *
 * OpenRouter speaks the OpenAI Chat Completions protocol, so this reuses the
 * OpenAI client pointed at a different base URL. Its Responses support is
 * newer and patchier across the models it routes to; Chat Completions with a
 * JSON schema `response_format` is what the broadest set of models accepts.
 */

import OpenAI from 'openai';
import {
  buildAskMessages,
  buildAskSystem,
  buildUserMessage,
  outputSchema,
  parseAnswer,
  parseOutput,
  systemPrompt,
  type AskRequest,
  type ChatMessage,
  type TranslationOutput,
  type TranslationRequest,
} from './shared';

const BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Same headroom as the OpenAI backend: many routed models reason before they
 * answer, and those tokens count against this ceiling.
 */
const MAX_OUTPUT_TOKENS = 4096;
/** The breakdown roughly doubles the output. */
const MAX_OUTPUT_TOKENS_WITH_FIELDS = 8192;

function createClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: BASE_URL,
    // The user's own key, used from the extension's background worker, sent
    // only to openrouter.ai.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    // Optional app attribution on OpenRouter's side; carries nothing personal.
    defaultHeaders: { 'X-Title': 'Hodoku' },
  });
}

/** One Chat Completions call; returns the message text. */
async function createCompletion(
  apiKey: string,
  model: string,
  system: string,
  messages: ChatMessage[],
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const client = createClient(apiKey);

  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        ...params,
        // OpenRouter's unified reasoning control. Models without reasoning
        // ignore it; neither request is reasoning-heavy, so keep latency and
        // cost down.
        reasoning: { effort: 'low', exclude: true },
      } as never,
      { signal },
    );
  } catch (err) {
    throw describeError(err);
  }

  const choice = completion.choices?.[0];
  if (!choice) throw new Error('The response came back empty.');
  if (choice.message.refusal) {
    throw new Error('The model declined this request.');
  }
  if (choice.finish_reason === 'length') {
    throw new Error('The response was cut off before it finished.');
  }

  return choice.message.content ?? '';
}

export async function translateWithOpenRouter(
  request: TranslationRequest,
): Promise<TranslationOutput> {
  const fields = Boolean(request.fields);
  const text = await createCompletion(
    request.apiKey,
    request.model,
    systemPrompt(fields),
    [{ role: 'user', content: buildUserMessage(request) }],
    {
      max_tokens: fields ? MAX_OUTPUT_TOKENS_WITH_FIELDS : MAX_OUTPUT_TOKENS,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'japanese_translation',
          schema: outputSchema(fields),
          strict: true,
        },
      },
    },
    request.signal,
  );
  return parseOutput(text);
}

export async function askWithOpenRouter(request: AskRequest): Promise<string> {
  const text = await createCompletion(
    request.apiKey,
    request.model,
    buildAskSystem(request),
    buildAskMessages(request),
    { max_tokens: MAX_OUTPUT_TOKENS },
    request.signal,
  );
  return parseAnswer(text);
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
