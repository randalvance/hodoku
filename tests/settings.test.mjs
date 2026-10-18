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
  outputSchema,
  parseOutput,
  systemPrompt,
  buildAskMessages,
  buildAskSystem,
} from '../.cache/lib.mjs';

describe('provider registry', () => {
  it('offers every provider', () => {
    assert.deepEqual([...PROVIDER_IDS].sort(), ['anthropic', 'openai', 'openrouter']);
  });

  it('gives each provider its own host permission', () => {
    assert.equal(PROVIDERS.anthropic.origin, 'https://api.anthropic.com/*');
    assert.equal(PROVIDERS.openai.origin, 'https://api.openai.com/*');
    assert.equal(PROVIDERS.openrouter.origin, 'https://openrouter.ai/*');
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
    openrouterApiKey: 'sk-or-key',
    openrouterModel: 'deepseek/deepseek-v4.1-flash',
  };

  it('reads the OpenRouter pair when OpenRouter is selected', () => {
    assert.deepEqual(credentialsFor({ ...base, provider: 'openrouter' }), {
      apiKey: 'sk-or-key',
      model: 'deepseek/deepseek-v4.1-flash',
    });
  });

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
    assert.equal(DEFAULT_SETTINGS.aiStandardFields, false, 'AI standard fields must be opt-in');
    assert.equal(DEFAULT_SETTINGS.anthropicApiKey, '');
    assert.equal(DEFAULT_SETTINGS.openaiApiKey, '');
    assert.equal(DEFAULT_SETTINGS.openrouterApiKey, '');
  });

  it('defaults each provider to its registry default', () => {
    assert.equal(DEFAULT_SETTINGS.anthropicModel, PROVIDERS.anthropic.defaultModel);
    assert.equal(DEFAULT_SETTINGS.openaiModel, PROVIDERS.openai.defaultModel);
    assert.equal(DEFAULT_SETTINGS.openrouterModel, PROVIDERS.openrouter.defaultModel);
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

describe('parseOutput', () => {
  const json =
    '{"translation":"I like cats.","literal":"cats-as-for liked is",' +
    '"explanation":{"grammar":["好き takes が."],"exceptions":[],"readings":[]}}';

  it('reads plain JSON', () => {
    assert.equal(parseOutput(json).translation, 'I like cats.');
  });

  it('unwraps a Markdown-fenced answer from a model that ignored the format', () => {
    assert.equal(parseOutput('```json\n' + json + '\n```').translation, 'I like cats.');
    assert.equal(parseOutput('```\n' + json + '\n```\n').translation, 'I like cats.');
  });

  it('still rejects something that is not JSON', () => {
    assert.throws(() => parseOutput('I like cats.'), /Could not read/);
  });

  it('reads the explanation template', () => {
    assert.deepEqual(parseOutput(json).explanation, {
      grammar: ['好き takes が.'],
      exceptions: [],
      readings: [],
    });
  });

  it('always yields the three sections, even when the model omits them', () => {
    const { explanation } = parseOutput('{"translation":"Hi.","literal":"Hi."}');
    assert.deepEqual(explanation, { grammar: [], exceptions: [], readings: [] });
  });

  it('tolerates a section typed as a string, and drops blank items', () => {
    const { explanation } = parseOutput(
      '{"translation":"Hi.","literal":"","explanation":{"grammar":"One point.","exceptions":["", "  "],"readings":[" rendaku "]}}',
    );
    assert.deepEqual(explanation, { grammar: ['One point.'], exceptions: [], readings: ['rendaku'] });
  });

  it('has no words unless the model sent some', () => {
    assert.equal(parseOutput(json).words, undefined);
  });

  it('normalises the words it was sent', () => {
    const inflection = { form: 'te', polite: true, negative: false, past: false, progressive: true, auxiliary: '' };
    const { words } = parseOutput(
      '{"translation":"Hi.","literal":"","explanation":{"grammar":[],"exceptions":[],"readings":[]},' +
        '"words":[{"surface":"食べています","reading":"たべています","pronunciation":["タベテ","イマス"],"dictionaryForm":"食べる","pos":"verb","inflection":' +
        JSON.stringify(inflection) +
        ',"meaning":"am eating","note":""},' +
        '{"surface":"","reading":"","pronunciation":[],"dictionaryForm":"","pos":"other","meaning":"","note":""},' +
        '{"surface":"が","meaning":" subject "}]}',
    );
    assert.equal(words.length, 2, 'an entry with no surface was kept');
    assert.deepEqual(words[0].pronunciation, ['タベテ', 'イマス']);
    assert.deepEqual(words[0].inflection, inflection);
    assert.equal(words[1].surface, 'が');
    assert.equal(words[1].meaning, 'subject');
    assert.equal(words[1].pos, 'other', 'a missing part of speech should fall back to "other"');
    assert.deepEqual(
      words[1].inflection,
      { form: 'none', polite: false, negative: false, past: false, progressive: false, auxiliary: '' },
      'a missing inflection should mean uninflected',
    );
  });

  it('coerces a model that strayed from the enums and the list', () => {
    const { words } = parseOutput(
      '{"translation":"Hi.","literal":"","explanation":{"grammar":[],"exceptions":[],"readings":[]},' +
        '"words":[{"surface":"勉強しています","reading":"べんきょうしています","pronunciation":"ベンキョー シテ イマス","dictionaryForm":"","pos":"Verb","inflection":{"form":"Te","polite":"yes"},"meaning":"","note":""}]}',
    );
    assert.equal(words[0].pos, 'verb', 'enum values are matched case-insensitively');
    assert.deepEqual(words[0].pronunciation, ['ベンキョー', 'シテ', 'イマス'], 'a single string is split on whitespace');
    assert.equal(words[0].inflection.form, 'te');
    assert.equal(words[0].inflection.polite, false, 'only a real boolean counts');
  });
});

describe('outputSchema', () => {
  it('requires the explanation template', () => {
    const schema = outputSchema(false);
    assert.deepEqual(schema.required, ['translation', 'literal', 'explanation']);
    assert.deepEqual(schema.properties.explanation.required, ['grammar', 'exceptions', 'readings']);
    assert.equal(schema.properties.words, undefined, 'words were in the schema without being asked for');
  });

  it('adds the breakdown only when asked', () => {
    const schema = outputSchema(true);
    assert.ok(schema.required.includes('words'));
    assert.equal(schema.properties.words.items.additionalProperties, false);
    // OpenAI strict mode: every property listed must be required.
    const word = schema.properties.words.items;
    assert.deepEqual(word.required.slice().sort(), Object.keys(word.properties).sort());
  });

  it('carries the breakdown conventions in the schema, not the prose', () => {
    const word = outputSchema(true).properties.words.items.properties;
    assert.ok(word.pos.enum.includes('particle'), 'part of speech should be an enum');
    assert.ok(word.pos.enum.includes('punctuation'));
    assert.equal(word.pronunciation.type, 'array', 'pronunciation should be one element per romaji word');
    const inflection = word.inflection;
    assert.equal(inflection.type, 'object');
    assert.ok(inflection.properties.form.enum.includes('te'));
    for (const flag of ['polite', 'negative', 'past', 'progressive']) {
      assert.equal(inflection.properties[flag].type, 'boolean', `${flag} should be a flag`);
    }
    assert.equal(inflection.additionalProperties, false);
    assert.deepEqual(
      inflection.required.slice().sort(),
      Object.keys(inflection.properties).sort(),
    );
  });

  it('only mentions the breakdown in the prompt when asked', () => {
    assert.ok(!/"words"/.test(systemPrompt(false)));
    assert.ok(/"words"/.test(systemPrompt(true)));
  });

  it('asks for the three sections by name', () => {
    for (const key of ['grammar', 'exceptions', 'readings']) {
      assert.ok(systemPrompt(false).includes(`"${key}"`), `prompt does not mention ${key}`);
    }
  });
});

describe('ask prompts', () => {
  const request = {
    apiKey: 'k',
    model: 'm',
    text: '猫が好きです',
    tokens: [],
    translation: 'I like cats.',
    history: [
      { question: 'Why が?', answer: 'Because 好き marks its object with が.' },
      { question: 'unanswered', answer: '' },
    ],
    question: 'Could I use を?',
  };

  it('puts the sentence and translation in the system prompt', () => {
    const system = buildAskSystem(request);
    assert.ok(system.includes('猫が好きです'));
    assert.ok(system.includes('I like cats.'));
  });

  it('ends the thread with the new question and skips unanswered turns', () => {
    const messages = buildAskMessages(request);
    assert.deepEqual(
      messages.map((m) => m.role),
      ['user', 'assistant', 'user'],
    );
    assert.equal(messages.at(-1).content, 'Could I use を?');
  });
});
