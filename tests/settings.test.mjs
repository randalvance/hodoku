import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_SETTINGS,
  PROVIDERS,
  PROVIDER_IDS,
  availableProviders,
  credentialsFor,
  getProvider,
  migrateSettings,
} from '../.cache/lib.mjs';

describe('provider registry', () => {
  it('offers both providers', () => {
    assert.deepEqual(PROVIDER_IDS.sort(), ['anthropic', 'openai']);
  });

  it('gives each provider its own host permission', () => {
    assert.equal(PROVIDERS.anthropic.origin, 'https://api.anthropic.com/*');
    assert.equal(PROVIDERS.openai.origin, 'https://api.openai.com/*');
  });

  it('declares a default model that is also a suggestion', () => {
    for (const id of PROVIDER_IDS) {
      const provider = PROVIDERS[id];
      assert.ok(provider.defaultModel, `${id} has no default model`);
      assert.ok(
        provider.suggestedModels.some((m) => m.id === provider.defaultModel),
        `${id}'s default model is missing from its suggestions`,
      );
    }
  });

  it('falls back to Claude for an unknown provider id', () => {
    assert.equal(getProvider('gemini').id, 'anthropic');
    assert.equal(getProvider('').id, 'anthropic');
  });
});

describe('credentialsFor', () => {
  const base = {
    ...DEFAULT_SETTINGS,
    anthropicApiKey: 'sk-ant-key',
    anthropicModel: 'claude-opus-5',
    openaiApiKey: 'sk-openai-key',
    openaiModel: 'gpt-5.4',
  };

  it('reads the Anthropic pair when Claude is selected', () => {
    assert.deepEqual(credentialsFor({ ...base, provider: 'anthropic' }), {
      apiKey: 'sk-ant-key',
      model: 'claude-opus-5',
    });
  });

  it('reads the OpenAI pair when GPT is selected', () => {
    assert.deepEqual(credentialsFor({ ...base, provider: 'openai' }), {
      apiKey: 'sk-openai-key',
      model: 'gpt-5.4',
    });
  });

  it('keeps each provider’s key isolated from the other', () => {
    const anthropic = credentialsFor({ ...base, provider: 'anthropic' });
    const openai = credentialsFor({ ...base, provider: 'openai' });
    assert.notEqual(anthropic.apiKey, openai.apiKey);
  });
});

describe('migrateSettings', () => {
  it('moves a pre-multi-provider key onto Anthropic', () => {
    assert.deepEqual(migrateSettings({ apiKey: 'sk-ant-old', apiModel: 'claude-sonnet-5' }), {
      provider: 'anthropic',
      anthropicApiKey: 'sk-ant-old',
      anthropicModel: 'claude-sonnet-5',
    });
  });

  it('migrates a key even when no model was saved', () => {
    assert.deepEqual(migrateSettings({ apiKey: 'sk-ant-old' }), {
      provider: 'anthropic',
      anthropicApiKey: 'sk-ant-old',
    });
  });

  it('does nothing for an already-migrated profile', () => {
    assert.equal(migrateSettings({ provider: 'openai', openaiApiKey: 'sk-x' }), null);
  });

  it('does nothing for a fresh install', () => {
    assert.equal(migrateSettings({}), null);
  });

  it('never invents a key that was not there', () => {
    const patch = migrateSettings({ apiModel: 'claude-opus-5' });
    assert.equal(patch.anthropicApiKey, undefined);
    assert.equal(patch.anthropicModel, 'claude-opus-5');
  });
});

describe('defaults', () => {
  it('ships with AI translation off and no keys', () => {
    assert.equal(DEFAULT_SETTINGS.aiTranslation, false);
    assert.equal(DEFAULT_SETTINGS.anthropicApiKey, '');
    assert.equal(DEFAULT_SETTINGS.openaiApiKey, '');
  });

  it('defaults each provider to its registry default', () => {
    assert.equal(DEFAULT_SETTINGS.anthropicModel, PROVIDERS.anthropic.defaultModel);
    assert.equal(DEFAULT_SETTINGS.openaiModel, PROVIDERS.openai.defaultModel);
  });
});


describe('availableProviders', () => {
  const base = {
    ...DEFAULT_SETTINGS,
    anthropicApiKey: '',
    openaiApiKey: '',
    anthropicModel: 'claude-opus-5',
    openaiModel: 'gpt-5.4',
  };

  it('offers nothing when no key is configured', () => {
    assert.deepEqual(availableProviders(base), []);
  });

  it('offers only the provider that has a key', () => {
    const list = availableProviders({ ...base, anthropicApiKey: 'sk-ant-x' });
    assert.deepEqual(list.map((p) => p.id), ['anthropic']);
    assert.equal(list[0].label, PROVIDERS.anthropic.label);
    assert.equal(list[0].model, 'claude-opus-5');
  });

  it('offers both when both are configured', () => {
    const list = availableProviders({
      ...base,
      anthropicApiKey: 'sk-ant-x',
      openaiApiKey: 'sk-openai-x',
    });
    assert.deepEqual(list.map((p) => p.id).sort(), ['anthropic', 'openai']);
  });

  it('ignores a key that is only whitespace', () => {
    assert.deepEqual(availableProviders({ ...base, openaiApiKey: '   ' }), []);
  });

  it('reports each provider’s own model', () => {
    const list = availableProviders({
      ...base,
      anthropicApiKey: 'a',
      openaiApiKey: 'b',
      anthropicModel: 'claude-sonnet-5',
      openaiModel: 'gpt-5.4-mini',
    });
    assert.equal(list.find((p) => p.id === 'anthropic').model, 'claude-sonnet-5');
    assert.equal(list.find((p) => p.id === 'openai').model, 'gpt-5.4-mini');
  });
});

describe('credentialsFor with an explicit provider', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    provider: 'anthropic',
    anthropicApiKey: 'sk-ant',
    openaiApiKey: 'sk-oai',
    anthropicModel: 'claude-opus-5',
    openaiModel: 'gpt-5.4',
  };

  it('defaults to the selected provider', () => {
    assert.equal(credentialsFor(settings).apiKey, 'sk-ant');
  });

  it('can read a provider other than the selected one', () => {
    // This is what regenerating on a different provider relies on.
    assert.deepEqual(credentialsFor(settings, 'openai'), {
      apiKey: 'sk-oai',
      model: 'gpt-5.4',
    });
  });
});
