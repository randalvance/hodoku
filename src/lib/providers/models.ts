/**
 * Live model lists, for the options page's model selector.
 *
 * Plain fetch rather than the SDKs, for the same reason as ./registry: the
 * options bundle should not carry a couple of hundred KB of client code to make
 * one GET request. Each provider's list is normalised into the same shape and
 * filtered down to models that can actually serve a translation.
 */

import type { ProviderId } from './registry';

export interface ModelOption {
  id: string;
  /** Human-readable name; falls back to the id. */
  label: string;
  /** Optgroup heading, when the list is long enough to want grouping. */
  group?: string;
  /** Short extra detail, e.g. price. */
  hint?: string;
}

/** Fetch the models a key can use, newest first within each group. */
export async function listModels(
  provider: ProviderId,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ModelOption[]> {
  switch (provider) {
    case 'anthropic':
      return normalizeAnthropicModels(
        await getJson('https://api.anthropic.com/v1/models?limit=1000', signal, {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }),
      );
    case 'openai':
      return normalizeOpenAIModels(
        await getJson('https://api.openai.com/v1/models', signal, {
          Authorization: `Bearer ${apiKey}`,
        }),
      );
    case 'openrouter':
      // The catalogue is public; the key is not needed to read it.
      return normalizeOpenRouterModels(await getJson('https://openrouter.ai/api/v1/models', signal));
  }
}

/** Whether listing needs a key before it can be attempted. */
export function listingNeedsKey(provider: ProviderId): boolean {
  return provider !== 'openrouter';
}

async function getJson(
  url: string,
  signal: AbortSignal | undefined,
  headers: Record<string, string> = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new Error(`Could not reach ${new URL(url).host}.`);
  }
  if (response.status === 401) throw new Error('The API key was rejected.');
  if (response.status === 403) throw new Error('This API key cannot list models.');
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}.`);
  return response.json();
}

function dataOf(json: unknown): Array<Record<string, unknown>> {
  const data = (json as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

/* ---------- Anthropic ---------- */

export function normalizeAnthropicModels(json: unknown): ModelOption[] {
  return dataOf(json)
    .filter((m) => typeof m.id === 'string')
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .map((m) => ({
      id: m.id as string,
      label: typeof m.display_name === 'string' && m.display_name ? m.display_name : (m.id as string),
    }));
}

/* ---------- OpenAI ---------- */

/**
 * /v1/models lists everything the key can touch — embeddings, TTS, image
 * models. Keep the text-generation families and drop the special-purpose
 * variants that cannot take a plain text-in, JSON-out request.
 */
const OPENAI_TEXT_FAMILY = /^(gpt-|o\d|chatgpt-)/;
const OPENAI_NOT_TEXT =
  /(audio|realtime|tts|transcribe|image|search|embedding|moderation|instruct|computer-use|deep-research|codex)/;
/** Pinned snapshots end in a date; aliases do not. */
const OPENAI_SNAPSHOT = /-\d{4}-\d{2}-\d{2}$/;

export function normalizeOpenAIModels(json: unknown): ModelOption[] {
  return dataOf(json)
    .filter((m) => typeof m.id === 'string')
    .filter((m) => OPENAI_TEXT_FAMILY.test(m.id as string) && !OPENAI_NOT_TEXT.test(m.id as string))
    .sort((a, b) => Number(b.created ?? 0) - Number(a.created ?? 0))
    .map((m) => {
      const id = m.id as string;
      return { id, label: id, group: OPENAI_SNAPSHOT.test(id) ? 'Snapshots' : 'Models' };
    })
    // Aliases first: they are what most people want.
    .sort((a, b) => Number(a.group === 'Snapshots') - Number(b.group === 'Snapshots'));
}

/* ---------- OpenRouter ---------- */

interface OpenRouterModel {
  id?: unknown;
  name?: unknown;
  created?: unknown;
  supported_parameters?: unknown;
  architecture?: { output_modalities?: unknown };
  pricing?: { prompt?: unknown; completion?: unknown };
}

/**
 * Keep models that produce text and accept a JSON-schema response format —
 * the translation relies on it — and drop `:batch` variants, which are for
 * asynchronous bulk jobs rather than a request someone is waiting on.
 */
export function normalizeOpenRouterModels(json: unknown): ModelOption[] {
  const models = dataOf(json) as OpenRouterModel[];
  return models
    .filter((m): m is OpenRouterModel & { id: string } => typeof m.id === 'string')
    .filter((m) => !m.id.endsWith(':batch'))
    .filter((m) => {
      const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
      return params.includes('response_format') || params.includes('structured_outputs');
    })
    .filter((m) => {
      const out = m.architecture?.output_modalities;
      return !Array.isArray(out) || out.includes('text');
    })
    .map((m) => ({
      id: m.id,
      label: openRouterLabel(m),
      group: vendorName(m),
      hint: openRouterPrice(m),
      created: Number(m.created ?? 0),
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || b.created - a.created)
    .map(({ created: _created, ...option }) => option);
}

/** "Google: Gemini 3.8 Flash" -> "Gemini 3.8 Flash"; the vendor is the group. */
function openRouterLabel(m: OpenRouterModel & { id: string }): string {
  const name = typeof m.name === 'string' && m.name ? m.name : m.id;
  const colon = name.indexOf(': ');
  return colon > 0 ? name.slice(colon + 2) : name;
}

function vendorName(m: OpenRouterModel & { id: string }): string {
  if (typeof m.name === 'string') {
    const colon = m.name.indexOf(': ');
    if (colon > 0) return m.name.slice(0, colon);
  }
  return m.id.split('/')[0];
}

/** "$0.75 / $3.75 per M" (input / output), or "free". */
function openRouterPrice(m: OpenRouterModel): string | undefined {
  const input = Number(m.pricing?.prompt);
  const output = Number(m.pricing?.completion);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  if (input === 0 && output === 0) return 'free';
  const perMillion = (n: number) => `$${(n * 1e6).toFixed(2).replace(/\.00$/, '')}`;
  return `${perMillion(input)} / ${perMillion(output)} per M`;
}
