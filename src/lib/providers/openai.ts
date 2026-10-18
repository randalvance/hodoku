/**
 * OpenAI backend for the optional sentence translation, and for follow-up
 * questions about a sentence.
 *
 * Uses the Responses API with a strict JSON schema, so the model is constrained
 * to the same output contract as the Claude backend.
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
  type TranslationOutput,
  type TranslationRequest,
} from './shared';

/**
 * Reasoning models spend part of the output budget on reasoning tokens before
 * writing anything, so this is more generous than the Anthropic ceiling. Too
 * tight and the response comes back `incomplete` with empty text.
 */
const MAX_OUTPUT_TOKENS = 4096;
/** The breakdown roughly doubles the output. */
const MAX_OUTPUT_TOKENS_WITH_FIELDS = 8192;

/** Models that reject the `reasoning` parameter — everything before gpt-5/o-series. */
function supportsReasoningEffort(model: string): boolean {
  return /^(gpt-5|o1|o3|o4)/.test(model);
}

function createClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    // Same reasoning as the Anthropic client: the user's own key, used from the
    // extension's background worker, sent only to api.openai.com.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });
}

/** One Responses call; returns the concatenated text output. */
async function createResponse(
  apiKey: string,
  model: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const client = createClient(apiKey);

  let response;
  try {
    response = await client.responses.create(
      {
        model,
        ...params,
        // Neither request is reasoning-heavy; keep latency and cost down.
        ...(supportsReasoningEffort(model) ? { reasoning: { effort: 'low' as const } } : {}),
        // Nothing here needs to be retrievable later.
        store: false,
      } as never,
      { signal },
    );
  } catch (err) {
    throw describeError(err);
  }

  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;
    throw new Error(
      reason === 'max_output_tokens'
        ? 'The response was cut off before it finished.'
        : `The response did not complete${reason ? ` (${reason})` : ''}.`,
    );
  }

  // `output_text` concatenates the text parts; a refusal leaves it empty.
  return response.output_text ?? '';
}

export async function translateWithOpenAI(
  request: TranslationRequest,
): Promise<TranslationOutput> {
  const fields = Boolean(request.fields);
  const text = await createResponse(
    request.apiKey,
    request.model,
    {
      instructions: systemPrompt(fields),
      input: buildUserMessage(request),
      max_output_tokens: fields ? MAX_OUTPUT_TOKENS_WITH_FIELDS : MAX_OUTPUT_TOKENS,
      text: {
        format: {
          type: 'json_schema',
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

export async function askWithOpenAI(request: AskRequest): Promise<string> {
  const text = await createResponse(
    request.apiKey,
    request.model,
    {
      instructions: buildAskSystem(request),
      input: buildAskMessages(request),
      max_output_tokens: MAX_OUTPUT_TOKENS,
    },
    request.signal,
  );
  return parseAnswer(text);
}

/** Turn SDK errors into something readable in a 400px-wide panel. */
function describeError(err: unknown): Error {
  if (err instanceof OpenAI.AuthenticationError) {
    return new Error('OpenAI rejected the API key. Check it in the extension options.');
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return new Error('This API key does not have access to the selected model.');
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new Error('Rate limited by OpenAI, or the account is out of quota.');
  }
  if (err instanceof OpenAI.NotFoundError) {
    return new Error('Model not found. Pick a different one in the options.');
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new Error('Could not reach the OpenAI API.');
  }
  if (err instanceof OpenAI.APIError) {
    return new Error(`OpenAI API error ${err.status ?? ''}: ${err.message}`.trim());
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}
