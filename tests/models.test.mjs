import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  listingNeedsKey,
  normalizeAnthropicModels,
  normalizeOpenAIModels,
  normalizeOpenRouterModels,
} from '../.cache/lib.mjs';

describe('normalizeAnthropicModels', () => {
  it('uses display names and puts the newest first', () => {
    const list = normalizeAnthropicModels({
      data: [
        { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z' },
        { id: 'claude-opus-5', display_name: 'Claude Opus 5', created_at: '2026-05-01T00:00:00Z' },
      ],
    });
    assert.deepEqual(list, [
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ]);
  });

  it('survives a malformed body', () => {
    assert.deepEqual(normalizeAnthropicModels(null), []);
    assert.deepEqual(normalizeAnthropicModels({ data: 'nope' }), []);
  });
});

describe('normalizeOpenAIModels', () => {
  const list = normalizeOpenAIModels({
    data: [
      { id: 'gpt-5.4', created: 300 },
      { id: 'gpt-5.4-2026-03-05', created: 301 },
      { id: 'gpt-5.4-mini', created: 200 },
      { id: 'o4-mini', created: 100 },
      { id: 'text-embedding-3-large', created: 50 },
      { id: 'gpt-4o-realtime-preview', created: 60 },
      { id: 'gpt-4o-mini-tts', created: 61 },
      { id: 'gpt-image-1', created: 62 },
      { id: 'dall-e-3', created: 63 },
      { id: 'whisper-1', created: 64 },
    ],
  });

  it('keeps only text-generation models', () => {
    assert.deepEqual(
      list.map((m) => m.id).sort(),
      ['gpt-5.4', 'gpt-5.4-2026-03-05', 'gpt-5.4-mini', 'o4-mini'],
    );
  });

  it('lists aliases before dated snapshots, newest first', () => {
    assert.deepEqual(
      list.map((m) => [m.id, m.group]),
      [
        ['gpt-5.4', 'Models'],
        ['gpt-5.4-mini', 'Models'],
        ['o4-mini', 'Models'],
        ['gpt-5.4-2026-03-05', 'Snapshots'],
      ],
    );
  });
});

describe('normalizeOpenRouterModels', () => {
  const structured = ['max_tokens', 'response_format', 'structured_outputs'];
  const list = normalizeOpenRouterModels({
    data: [
      {
        id: 'google/gemini-3.8-flash',
        name: 'Google: Gemini 3.8 Flash',
        created: 20,
        supported_parameters: structured,
        architecture: { output_modalities: ['text'] },
        pricing: { prompt: '0.00000075', completion: '0.00000375' },
      },
      {
        id: 'google/gemini-3.8-flash:batch',
        name: 'Google: Gemini 3.8 Flash (batch)',
        created: 20,
        supported_parameters: structured,
      },
      {
        id: 'anthropic/claude-opus-5',
        name: 'Anthropic: Claude Opus 5',
        created: 10,
        supported_parameters: structured,
        pricing: { prompt: '0.000005', completion: '0.000025' },
      },
      {
        id: 'anthropic/claude-sonnet-5.5',
        name: 'Anthropic: Claude Sonnet 5.5',
        created: 30,
        supported_parameters: structured,
      },
      {
        id: 'qwen/qwen3.8-27b:free',
        name: 'Qwen: Qwen3.8 27B (free)',
        created: 5,
        supported_parameters: structured,
        pricing: { prompt: '0', completion: '0' },
      },
      { id: 'old/no-json', name: 'Old: No JSON', supported_parameters: ['max_tokens'] },
      {
        id: 'mode/json-only',
        name: 'Mode: JSON Only',
        supported_parameters: ['max_tokens', 'response_format'],
      },
      {
        id: 'image/only',
        name: 'Image: Only',
        supported_parameters: structured,
        architecture: { output_modalities: ['image'] },
      },
    ],
  });

  it('drops batch variants, models without structured outputs, and non-text models', () => {
    assert.deepEqual(
      list.map((m) => m.id),
      [
        'anthropic/claude-sonnet-5.5',
        'anthropic/claude-opus-5',
        'google/gemini-3.8-flash',
        'qwen/qwen3.8-27b:free',
      ],
    );
  });

  it('groups by vendor and strips the vendor from the label', () => {
    const gemini = list.find((m) => m.id === 'google/gemini-3.8-flash');
    assert.equal(gemini.group, 'Google');
    assert.equal(gemini.label, 'Gemini 3.8 Flash');
  });

  it('shows price per million tokens, or free', () => {
    assert.equal(list.find((m) => m.id === 'google/gemini-3.8-flash').hint, '$0.75 / $3.75 per M');
    assert.equal(list.find((m) => m.id === 'anthropic/claude-opus-5').hint, '$5 / $25 per M');
    assert.equal(list.find((m) => m.id === 'qwen/qwen3.8-27b:free').hint, 'free');
    assert.equal(list.find((m) => m.id === 'anthropic/claude-sonnet-5.5').hint, undefined);
  });
});

describe('listingNeedsKey', () => {
  it('lets OpenRouter list without a key, but not the others', () => {
    assert.equal(listingNeedsKey('openrouter'), false);
    assert.equal(listingNeedsKey('anthropic'), true);
    assert.equal(listingNeedsKey('openai'), true);
  });
});
