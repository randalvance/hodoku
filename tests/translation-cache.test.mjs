/**
 * Translation cache tests, against an in-memory chrome.storage.local stand-in.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const store = new Map();

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (key === null || key === undefined) return Object.fromEntries(store);
        const keys = typeof key === 'string' ? [key] : Object.keys(key);
        const out = {};
        for (const k of keys) if (store.has(k)) out[k] = store.get(k);
        return out;
      },
      async set(entries) {
        // Round-trip through JSON so tests cannot accidentally share references
        // with the stored copy, the way real extension storage behaves.
        for (const [k, v] of Object.entries(entries)) store.set(k, JSON.parse(JSON.stringify(v)));
      },
      async remove(key) {
        for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
      },
    },
  },
};

const { MAX_ENTRIES, cacheKey, cacheStats, clearCache, getCached, putCached } = await import(
  '../.cache/lib.mjs'
);

const TEXT = '日本語を勉強しています。';
const VALUE = { translation: 'I am studying Japanese.', literal: 'Japanese studying am.', note: 'ています marks an ongoing action.' };

beforeEach(() => store.clear());

describe('cacheKey', () => {
  it('is stable for the same inputs', () => {
    assert.equal(
      cacheKey(TEXT, 'anthropic', 'claude-opus-5'),
      cacheKey(TEXT, 'anthropic', 'claude-opus-5'),
    );
  });

  it('separates providers and models', () => {
    const a = cacheKey(TEXT, 'anthropic', 'claude-opus-5');
    assert.notEqual(a, cacheKey(TEXT, 'openai', 'claude-opus-5'));
    assert.notEqual(a, cacheKey(TEXT, 'anthropic', 'claude-sonnet-5'));
  });

  it('separates different text', () => {
    assert.notEqual(
      cacheKey('猫', 'anthropic', 'claude-opus-5'),
      cacheKey('犬', 'anthropic', 'claude-opus-5'),
    );
  });
});

describe('put and get', () => {
  it('returns what was stored', async () => {
    await putCached(TEXT, 'anthropic', 'claude-opus-5', VALUE);
    const entry = await getCached(TEXT, 'anthropic', 'claude-opus-5');

    assert.equal(entry.translation, VALUE.translation);
    assert.equal(entry.literal, VALUE.literal);
    assert.equal(entry.note, VALUE.note);
    assert.equal(entry.text, TEXT);
    assert.equal(entry.provider, 'anthropic');
    assert.equal(entry.model, 'claude-opus-5');
  });

  it('misses for text that was never translated', async () => {
    assert.equal(await getCached('未知', 'anthropic', 'claude-opus-5'), undefined);
  });

  it('misses when the model changes', async () => {
    await putCached(TEXT, 'anthropic', 'claude-opus-5', VALUE);
    assert.equal(await getCached(TEXT, 'anthropic', 'claude-sonnet-5'), undefined);
  });

  it('misses when the provider changes', async () => {
    await putCached(TEXT, 'anthropic', 'claude-opus-5', VALUE);
    assert.equal(await getCached(TEXT, 'openai', 'claude-opus-5'), undefined);
  });

  it('keeps both providers side by side', async () => {
    await putCached(TEXT, 'anthropic', 'claude-opus-5', { translation: 'From Claude.' });
    await putCached(TEXT, 'openai', 'gpt-5.4', { translation: 'From GPT.' });

    assert.equal((await getCached(TEXT, 'anthropic', 'claude-opus-5')).translation, 'From Claude.');
    assert.equal((await getCached(TEXT, 'openai', 'gpt-5.4')).translation, 'From GPT.');
  });

  it('overwrites an existing entry rather than duplicating it', async () => {
    await putCached(TEXT, 'anthropic', 'claude-opus-5', { translation: 'First.' });
    await putCached(TEXT, 'anthropic', 'claude-opus-5', { translation: 'Second.' });

    assert.equal((await getCached(TEXT, 'anthropic', 'claude-opus-5')).translation, 'Second.');
    assert.equal((await cacheStats()).entries, 1);
  });

  it('does not return another sentence when hashes collide', async () => {
    // Force a collision by writing a foreign entry under a known key.
    const key = cacheKey(TEXT, 'anthropic', 'claude-opus-5');
    store.set('translationCache', {
      [key]: {
        text: 'まったく違う文',
        provider: 'anthropic',
        model: 'claude-opus-5',
        translation: 'Someone else’s translation.',
        createdAt: 1,
        lastUsedAt: 1,
        hits: 0,
      },
    });

    assert.equal(await getCached(TEXT, 'anthropic', 'claude-opus-5'), undefined);
  });
});

describe('usage tracking', () => {
  it('counts hits and updates last use', async () => {
    await putCached(TEXT, 'anthropic', 'claude-opus-5', VALUE);
    const first = await getCached(TEXT, 'anthropic', 'claude-opus-5');
    assert.equal(first.hits, 1);

    const second = await getCached(TEXT, 'anthropic', 'claude-opus-5');
    assert.equal(second.hits, 2);
    assert.ok(second.lastUsedAt >= first.lastUsedAt);
  });

  it('reports totals', async () => {
    await putCached('猫', 'anthropic', 'm', { translation: 'cat' });
    await putCached('犬', 'anthropic', 'm', { translation: 'dog' });
    await getCached('猫', 'anthropic', 'm');

    const stats = await cacheStats();
    assert.equal(stats.entries, 2);
    assert.equal(stats.hits, 1);
    assert.ok(stats.bytes > 0);
  });

  it('reports an empty cache cleanly', async () => {
    assert.deepEqual(await cacheStats(), { entries: 0, hits: 0, bytes: 2 });
  });
});

describe('eviction', () => {
  it('keeps the cache at the cap', async () => {
    for (let i = 0; i < MAX_ENTRIES + 25; i++) {
      await putCached(`文${i}`, 'anthropic', 'm', { translation: `t${i}` });
    }
    assert.equal((await cacheStats()).entries, MAX_ENTRIES);
  });

  it('evicts the least recently used, not the oldest', async () => {
    for (let i = 0; i < MAX_ENTRIES; i++) {
      await putCached(`文${i}`, 'anthropic', 'm', { translation: `t${i}` });
    }
    // Touch the very first entry so it is the most recently used.
    await getCached('文0', 'anthropic', 'm');
    await putCached('新しい文', 'anthropic', 'm', { translation: 'new' });

    assert.ok(await getCached('文0', 'anthropic', 'm'), 'the recently used entry was evicted');
    assert.ok(await getCached('新しい文', 'anthropic', 'm'));
    assert.equal((await cacheStats()).entries, MAX_ENTRIES);
  });
});

describe('clearCache', () => {
  it('removes everything', async () => {
    await putCached(TEXT, 'anthropic', 'claude-opus-5', VALUE);
    await clearCache();

    assert.equal((await cacheStats()).entries, 0);
    assert.equal(await getCached(TEXT, 'anthropic', 'claude-opus-5'), undefined);
  });

  it('leaves saved items alone', async () => {
    store.set('savedItems', [{ id: 'a' }]);
    await putCached(TEXT, 'anthropic', 'claude-opus-5', VALUE);
    await clearCache();

    assert.deepEqual(store.get('savedItems'), [{ id: 'a' }]);
  });
});
