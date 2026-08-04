/**
 * The saved-items store talks to chrome.storage.local, so these tests install a
 * minimal in-memory stand-in for it. That is enough to exercise the real
 * dedupe, ordering, review-tracking, and export logic.
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
        for (const [k, v] of Object.entries(entries)) store.set(k, v);
      },
      async remove(key) {
        for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
      },
    },
  },
};

const {
  clearSaved,
  findSavedByText,
  listSaved,
  recordReview,
  removeSaved,
  saveAnalysis,
  studyOrder,
  updateTranslation,
  toJson,
  toTsv,
} = await import('../.cache/lib.mjs');

/** Minimal Analysis stand-in — the store only reads these fields. */
const analysis = (text, extra = {}) => ({
  text,
  romaji: 'Nihongo o benkyō shite imasu.',
  kana: 'にほんごをべんきょうしています。',
  tokens: [],
  warnings: [],
  translation: { text: 'I am studying Japanese.', source: 'ai', model: 'claude-opus-5' },
  ...extra,
});

/** The same sentence as it looks with AI translation switched off. */
const glossOnly = (text) =>
  analysis(text, {
    translation: { text: 'Japanese · direct object marker · to study', source: 'gloss' },
    literalTranslation: undefined,
    grammarNote: undefined,
  });

beforeEach(() => store.clear());

describe('saveAnalysis', () => {
  it('stores what the panel showed', async () => {
    const { item, created, total } = await saveAnalysis(analysis('日本語を勉強しています。'), {
      url: 'https://example.com/a',
      title: 'Example',
    });

    assert.equal(created, true);
    assert.equal(total, 1);
    assert.equal(item.text, '日本語を勉強しています。');
    assert.equal(item.romaji, 'Nihongo o benkyō shite imasu.');
    assert.equal(item.translation, 'I am studying Japanese.');
    assert.equal(item.translationSource, 'ai');
    assert.equal(item.url, 'https://example.com/a');
    assert.equal(item.reviewCount, 0);
    assert.ok(item.id);
    assert.ok(item.savedAt > 0);
  });

  it('snapshots the whole model response, not just the translation', async () => {
    const { item } = await saveAnalysis(
      analysis('猫が好きです', {
        literalTranslation: 'cat-SUBJ liked is',
        grammarNote: '好き takes が, not を.',
      }),
    );

    assert.equal(item.translation, 'I am studying Japanese.');
    assert.equal(item.translationSource, 'ai');
    assert.equal(item.translationModel, 'claude-opus-5', 'the model was not recorded');
    assert.equal(item.literal, 'cat-SUBJ liked is');
    assert.equal(item.note, '好き takes が, not を.');
  });

  it('refreshes rather than duplicating the same sentence', async () => {
    const first = await saveAnalysis(analysis('猫が好きです'));
    const second = await saveAnalysis(
      analysis('猫が好きです', {
        translation: { text: 'I like cats.', source: 'ai', model: 'claude-opus-5' },
      }),
    );

    assert.equal(second.created, false);
    assert.equal(second.item.id, first.item.id);
    assert.equal((await listSaved()).length, 1);
    assert.equal(second.item.translation, 'I like cats.');
  });

  it('treats whitespace-only differences as the same sentence', async () => {
    await saveAnalysis(analysis('猫が好きです'));
    const again = await saveAnalysis(analysis('  猫が好きです  '));
    assert.equal(again.created, false);
    assert.equal((await listSaved()).length, 1);
  });

  it('keeps the original save time and review history when refreshed', async () => {
    const first = await saveAnalysis(analysis('猫が好きです'));
    await recordReview(first.item.id, true);
    const again = await saveAnalysis(analysis('猫が好きです'));

    assert.equal(again.item.savedAt, first.item.savedAt);
    assert.equal(again.item.reviewCount, 1);
  });

  it('keeps different sentences apart', async () => {
    await saveAnalysis(analysis('猫が好きです'));
    await saveAnalysis(analysis('犬が好きです'));
    assert.equal((await listSaved()).length, 2);
  });

  it('lists newest first', async () => {
    const a = await saveAnalysis(analysis('一'));
    // savedAt comes from Date.now(); force a distinct, later value.
    const b = await saveAnalysis(analysis('二'));
    b.item.savedAt = a.item.savedAt + 1000;
    await chrome.storage.local.set({ savedItems: [a.item, b.item] });

    const items = await listSaved();
    assert.deepEqual(
      items.map((i) => i.text),
      ['二', '一'],
    );
  });
});

describe('findSavedByText', () => {
  it('finds an item regardless of surrounding whitespace', async () => {
    await saveAnalysis(analysis('猫が好きです'));
    assert.ok(await findSavedByText('猫が好きです'));
    assert.ok(await findSavedByText('  猫が好きです '));
  });

  it('returns nothing for text that was never saved', async () => {
    assert.equal(await findSavedByText('未保存'), undefined);
  });
});

describe('removeSaved and clearSaved', () => {
  it('removes one item and leaves the rest', async () => {
    const a = await saveAnalysis(analysis('一'));
    await saveAnalysis(analysis('二'));

    const remaining = await removeSaved(a.item.id);
    assert.equal(remaining, 1);
    assert.deepEqual((await listSaved()).map((i) => i.text), ['二']);
  });

  it('ignores an unknown id', async () => {
    await saveAnalysis(analysis('一'));
    assert.equal(await removeSaved('does-not-exist'), 1);
  });

  it('clears everything', async () => {
    await saveAnalysis(analysis('一'));
    await saveAnalysis(analysis('二'));
    await clearSaved();
    assert.deepEqual(await listSaved(), []);
  });
});

describe('recordReview', () => {
  it('counts up on a remembered item', async () => {
    const { item } = await saveAnalysis(analysis('猫'));
    await recordReview(item.id, true);
    await recordReview(item.id, true);

    const [stored] = await listSaved();
    assert.equal(stored.reviewCount, 2);
    assert.ok(stored.lastReviewedAt > 0);
  });

  it('resets the count when the user did not remember', async () => {
    const { item } = await saveAnalysis(analysis('猫'));
    await recordReview(item.id, true);
    await recordReview(item.id, false);

    const [stored] = await listSaved();
    assert.equal(stored.reviewCount, 0);
    assert.ok(stored.lastReviewedAt > 0, 'a failed review still counts as reviewed');
  });

  it('does nothing for an unknown id', async () => {
    await saveAnalysis(analysis('猫'));
    await recordReview('nope', true);
    assert.equal((await listSaved())[0].reviewCount, 0);
  });
});

describe('studyOrder', () => {
  it('puts never-reviewed items first', () => {
    const ordered = studyOrder([
      { id: 'b', reviewCount: 3, lastReviewedAt: 500 },
      { id: 'a', reviewCount: 0 },
      { id: 'c', reviewCount: 1, lastReviewedAt: 900 },
    ]);
    assert.deepEqual(ordered.map((i) => i.id), ['a', 'c', 'b']);
  });

  it('breaks ties by longest since reviewed', () => {
    const ordered = studyOrder([
      { id: 'recent', reviewCount: 1, lastReviewedAt: 900 },
      { id: 'stale', reviewCount: 1, lastReviewedAt: 100 },
    ]);
    assert.deepEqual(ordered.map((i) => i.id), ['stale', 'recent']);
  });

  it('does not mutate its input', () => {
    const input = [{ id: 'b', reviewCount: 2 }, { id: 'a', reviewCount: 0 }];
    studyOrder(input);
    assert.deepEqual(input.map((i) => i.id), ['b', 'a']);
  });
});

describe('export', () => {
  it('writes a tab-separated table with a header', async () => {
    await saveAnalysis(analysis('猫が好きです'), { url: 'https://example.com/a' });
    const tsv = toTsv(await listSaved());
    const [header, row] = tsv.split('\n');

    assert.deepEqual(header.split('\t'), [
      'Japanese',
      'Reading',
      'Romaji',
      'Meaning',
      'Notes',
      'Source',
    ]);
    assert.equal(row.split('\t').length, 6);
    assert.equal(row.split('\t')[0], '猫が好きです');
  });

  it('strips tabs and newlines that would break the import', async () => {
    await saveAnalysis(
      analysis('猫', { translation: { text: 'a\tb\nc', source: 'gloss' } }),
    );
    const row = toTsv(await listSaved()).split('\n')[1];
    assert.equal(row.split('\t').length, 6, 'an embedded tab created an extra column');
    assert.ok(row.includes('a b c'));
  });

  it('writes JSON with a count and the items', async () => {
    await saveAnalysis(analysis('猫'));
    const parsed = JSON.parse(toJson(await listSaved()));
    assert.equal(parsed.count, 1);
    assert.equal(parsed.items[0].text, '猫');
    assert.ok(parsed.exportedAt);
  });
});


describe('protecting the snapshot', () => {
  const rich = () =>
    analysis('猫が好きです', {
      literalTranslation: 'cat-SUBJ liked is',
      grammarNote: '好き takes が, not を.',
    });

  it('does not let a gloss overwrite a model translation', async () => {
    // Save with AI on, then re-save the same sentence with AI off. The
    // expensive snapshot must survive.
    await saveAnalysis(rich());
    const { item } = await saveAnalysis(glossOnly('猫が好きです'));

    assert.equal(item.translation, 'I am studying Japanese.');
    assert.equal(item.translationSource, 'ai');
    assert.equal(item.translationModel, 'claude-opus-5');
    assert.equal(item.literal, 'cat-SUBJ liked is', 'the literal rendering was wiped');
    assert.equal(item.note, '好き takes が, not を.', 'the grammar note was wiped');
  });

  it('upgrades a gloss to a model translation', async () => {
    await saveAnalysis(glossOnly('猫が好きです'));
    const { item } = await saveAnalysis(rich());

    assert.equal(item.translationSource, 'ai');
    assert.equal(item.translation, 'I am studying Japanese.');
    assert.equal(item.note, '好き takes が, not を.');
  });

  it('refreshes one gloss with another', async () => {
    await saveAnalysis(glossOnly('猫が好きです'));
    const { item } = await saveAnalysis(
      analysis('猫が好きです', { translation: { text: 'newer gloss', source: 'gloss' } }),
    );
    assert.equal(item.translation, 'newer gloss');
  });

  it('replaces one model translation with another', async () => {
    await saveAnalysis(rich());
    const { item } = await saveAnalysis(
      analysis('猫が好きです', {
        translation: { text: 'A different take.', source: 'ai', model: 'gpt-5.4' },
      }),
    );
    assert.equal(item.translation, 'A different take.');
    assert.equal(item.translationModel, 'gpt-5.4');
  });

  it('still refreshes readings and source when the meaning is kept', async () => {
    await saveAnalysis(rich(), { url: 'https://old.example', title: 'Old' });
    const { item } = await saveAnalysis(glossOnly('猫が好きです'), {
      url: 'https://new.example',
      title: 'New',
    });

    assert.equal(item.url, 'https://new.example', 'the source page did not refresh');
    assert.equal(item.title, 'New');
    assert.equal(item.translationSource, 'ai', 'the snapshot should still be protected');
  });
});


describe('updateTranslation', () => {
  const snapshot = {
    translation: 'A regenerated translation.',
    translationSource: 'ai',
    translationModel: 'gpt-5.4',
    literal: 'regenerated literal',
    note: 'regenerated note',
  };

  it('replaces the stored meaning after a regenerate', async () => {
    await saveAnalysis(analysis('猫が好きです'));
    const updated = await updateTranslation('猫が好きです', snapshot);

    assert.equal(updated.translation, 'A regenerated translation.');
    assert.equal(updated.translationModel, 'gpt-5.4');
    assert.equal(updated.literal, 'regenerated literal');
    assert.equal((await listSaved())[0].translation, 'A regenerated translation.');
  });

  it('matches regardless of surrounding whitespace', async () => {
    await saveAnalysis(analysis('猫が好きです'));
    assert.ok(await updateTranslation('  猫が好きです ', snapshot));
  });

  it('does nothing when the sentence is not saved', async () => {
    assert.equal(await updateTranslation('未保存', snapshot), undefined);
  });

  it('still refuses to downgrade a model translation to a gloss', async () => {
    await saveAnalysis(analysis('猫が好きです'));
    const updated = await updateTranslation('猫が好きです', {
      translation: 'a gloss',
      translationSource: 'gloss',
    });
    assert.equal(updated.translationSource, 'ai');
  });
});
