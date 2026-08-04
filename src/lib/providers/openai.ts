/**
 * OpenAI backend for the optional sentence translation.
 *
 * Uses the Responses API with a strict JSON schema, so the model is constrained
 * to the same output contract as the Claude backend.
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

/**
 * Reasoning models spend part of the output budget on reasoning tokens before
 * writing anything, so this is more generous than the Anthropic ceiling. Too
 * tight and the response comes back `incomplete` with empty text.
 */
const MAX_OUTPUT_TOKENS = 4096;

/** Models that reject the `reasoning` parameter — everything before gpt-5/o-series. */
function supportsReasoningEffort(model: string): boolean {
  return /^(gpt-5|o1|o3|o4)/.test(model);
}

export async function translateWithOpenAI(
  request: TranslationRequest,
): Promise<TranslationOutput> {
  const { apiKey, model, signal } = request;

  const client = new OpenAI({
    apiKey,
    // Same reasoning as the Anthropic client: the user's own key, used from the
    // extension's background worker, sent only to api.openai.com.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });

  let response;
  try {
    response = await client.responses.create(
      {
        model,
        instructions: SYSTEM_PROMPT,
        input: buildUserMessage(request),
        max_output_tokens: MAX_OUTPUT_TOKENS,
        text: {
          format: {
            type: 'json_schema',
            name: 'japanese_translation',
            schema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,
            strict: true,
          },
        },
        // Translation is not reasoning-heavy; keep latency and cost down.
        ...(supportsReasoningEffort(model) ? { reasoning: { effort: 'low' as const } } : {}),
        // Nothing here needs to be retrievable later.
        store: false,
      },
      { signal },
    );
  } catch (err) {
    throw describeError(err);
  }

  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;
    throw new Error(
      reason === 'max_output_tokens'
        ? 'The translation was cut off before it finished.'
        : `The translation did not complete${reason ? ` (${reason})` : ''}.`,
    );
  }

  // `output_text` concatenates the text parts; a refusal leaves it empty.
  return parseOutput(response.output_text ?? '');
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
