/**
 * Provider metadata: labels, host permissions, and model suggestions.
 *
 * Deliberately free of SDK imports. The options page and the settings types
 * only need this much, and pulling the provider SDKs into those bundles would
 * add a couple of hundred KB of client code that never runs there.
 */

export type ProviderId = 'anthropic' | 'openai';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Host permission pattern, requested only when the user enables this provider. */
  origin: string;
  /** Where to get a key. */
  consoleUrl: string;
  keyPlaceholder: string;
  defaultModel: string;
  /**
   * Suggestions for the model field. The field accepts anything, so a model
   * released after this build can still be typed in.
   */
  suggestedModels: Array<{ id: string; hint: string }>;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    origin: 'https://api.anthropic.com/*',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-\u2026',
    defaultModel: 'claude-opus-5',
    suggestedModels: [
      { id: 'claude-opus-5', hint: 'most capable' },
      { id: 'claude-sonnet-5', hint: 'balanced' },
      { id: 'claude-haiku-4-5', hint: 'fastest, cheapest' },
    ],
  },
  openai: {
    id: 'openai',
    label: 'GPT (OpenAI)',
    origin: 'https://api.openai.com/*',
    consoleUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-\u2026',
    defaultModel: 'gpt-5.4',
    suggestedModels: [
      { id: 'gpt-5.4', hint: 'balanced' },
      { id: 'gpt-5.4-mini', hint: 'faster, cheaper' },
      { id: 'gpt-5.4-nano', hint: 'fastest, cheapest' },
      { id: 'gpt-5.2', hint: 'previous generation' },
      { id: 'gpt-5.1', hint: 'previous generation' },
    ],
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function getProvider(id: string): ProviderInfo {
  return PROVIDERS[id as ProviderId] ?? PROVIDERS.anthropic;
}
