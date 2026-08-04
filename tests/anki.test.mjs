/**
 * AnkiConnect client tests.
 *
 * `fetch` is stubbed so the whole request/response contract can be exercised
 * without a running Anki: the envelope shape, the 200-with-error-in-body
 * convention, note construction, and HTML escaping.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const calls = [];
let responder = () => ({ result: null, error: null });

globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url, body });
  const outcome = responder(body);
  if (outcome instanceof Error) throw outcome;
  if (outcome.__status) {
    return { ok: false, status: outcome.__status, async json() { return {}; } };
  }
  return { ok: true, status: 200, async json() { return outcome; } };
};

const {
  ANKI_DEFAULT_URL,
  ANKI_ORIGINS,
  AnkiError,
  buildBack,
  buildNote,
  furiganaHtml,
  invoke,
  sendToAnki,
} = await import('../.cache/lib.mjs');

const CONFIG = {
  url: ANKI_DEFAULT_URL,
  deck: 'Hodoku',
  model: 'Basic',
  frontField: 'Front',
  backField: 'Back',
  tags: ['hodoku'],
  furigana: true,
};

/** What furiganaSegments() produces for 猫が好きです. */
const FURIGANA = [
  { text: '猫', ruby: 'ねこ' },
  { text: 'が' },
  { text: '好', ruby: 'す' },
  { text: 'き' },
  { text: 'です' },
];

const item = (extra = {}) => ({
  id: 'x1',
  text: '猫が好きです',
  romaji: 'Neko ga suki desu',
  kana: 'ねこがすきです',
  translation: 'I like cats.',
  savedAt: 1,
  reviewCount: 0,
  ...extra,
});

beforeEach(() => {
  calls.length = 0;
  responder = () => ({ result: null, error: null });
});

describe('permissions surface', () => {
  it('scopes host access to loopback only', () => {
    assert.deepEqual(ANKI_ORIGINS, ['http://127.0.0.1/*', 'http://localhost/*']);
    for (const origin of ANKI_ORIGINS) {
      assert.ok(!/^https?:\/\/(?!127\.0\.0\.1|localhost)/.test(origin), `${origin} is not loopback`);
    }
  });

  it('defaults to the AnkiConnect port', () => {
    assert.equal(ANKI_DEFAULT_URL, 'http://127.0.0.1:8765');
  });
});

describe('invoke', () => {
  it('sends the AnkiConnect envelope', async () => {
    responder = () => ({ result: 6, error: null });
    const result = await invoke(ANKI_DEFAULT_URL, 'version');

    assert.equal(result, 6);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { action: 'version', version: 6, params: {} });
    assert.equal(calls[0].url, ANKI_DEFAULT_URL);
  });

  it('passes params through', async () => {
    responder = () => ({ result: ['Front', 'Back'], error: null });
    await invoke(ANKI_DEFAULT_URL, 'modelFieldNames', { modelName: 'Basic' });
    assert.deepEqual(calls[0].body.params, { modelName: 'Basic' });
  });

  it('raises the error carried in a 200 body', async () => {
    responder = () => ({ result: null, error: 'model was not found: Nope' });
    await assert.rejects(() => invoke(ANKI_DEFAULT_URL, 'addNotes'), (err) => {
      assert.ok(err instanceof AnkiError);
      assert.match(err.message, /model was not found/);
      return true;
    });
  });

  it('explains a connection failure in terms the user can act on', async () => {
    responder = () => new TypeError('Failed to fetch');
    await assert.rejects(() => invoke(ANKI_DEFAULT_URL, 'version'), (err) => {
      assert.ok(err instanceof AnkiError);
      assert.match(err.message, /Anki is running/i);
      assert.match(err.message, /AnkiConnect/);
      return true;
    });
  });

  it('turns a 403 into the CORS instruction, not a raw status', async () => {
    responder = () => ({ __status: 403 });
    await assert.rejects(() => invoke(ANKI_DEFAULT_URL, 'version'), (err) => {
      assert.match(err.message, /webCorsOriginList/);
      return true;
    });
  });

  it('reports other HTTP failures with the status', async () => {
    responder = () => ({ __status: 500 });
    await assert.rejects(() => invoke(ANKI_DEFAULT_URL, 'version'), /HTTP 500/);
  });
});

describe('buildNote', () => {
  it('maps the configured fields', () => {
    const note = buildNote(item(), CONFIG);
    assert.equal(note.deckName, 'Hodoku');
    assert.equal(note.modelName, 'Basic');
    assert.equal(note.fields.Front, '猫が好きです');
    assert.match(note.fields.Back, /Neko ga suki desu/);
    assert.deepEqual(note.tags, ['hodoku']);
  });

  it('honours a custom field mapping', () => {
    const note = buildNote(item(), { ...CONFIG, frontField: 'Expression', backField: 'Meaning' });
    assert.ok('Expression' in note.fields);
    assert.ok('Meaning' in note.fields);
    assert.equal(note.fields.Expression, '猫が好きです');
  });

  it('lets Anki reject duplicates rather than creating a second card', () => {
    const note = buildNote(item(), CONFIG);
    assert.equal(note.options.allowDuplicate, false);
    assert.equal(note.options.duplicateScope, 'deck');
  });
});

describe('buildBack escaping', () => {
  it('includes the reading and meaning', () => {
    const back = buildBack(item());
    assert.match(back, /Neko ga suki desu/);
    assert.match(back, /ねこがすきです/);
    assert.match(back, /I like cats\./);
  });

  it('escapes HTML in saved text so a card cannot carry markup', () => {
    const back = buildBack(item({ translation: '<img src=x onerror=alert(1)>' }));
    assert.ok(!back.includes('<img'), 'raw tag survived into the card');
    assert.match(back, /&lt;img/);
  });

  it('escapes the source URL and title', () => {
    const back = buildBack(
      item({ url: 'https://e.com/?a="b"&c=<d>', title: '<b>title</b>' }),
    );
    assert.ok(!back.includes('<b>title</b>'));
    assert.match(back, /&quot;b&quot;/);
  });

  it('records which model produced the meaning', () => {
    const back = buildBack(
      item({ translationSource: 'ai', translationModel: 'claude-opus-5', url: 'https://e.com' }),
    );
    assert.match(back, /claude-opus-5/);
    // Provenance sits with the source link rather than in its own block.
    assert.match(back, /e\.com[\s\S]*claude-opus-5|claude-opus-5[\s\S]*e\.com/);
  });

  it('does not label a word-by-word gloss with a model', () => {
    const back = buildBack(item({ translationSource: 'gloss', translationModel: undefined }));
    assert.ok(!back.includes('claude'));
  });

  it('carries the literal rendering and grammar note onto the card', () => {
    const back = buildBack(
      item({ literal: 'cat-SUBJ liked is', note: '好き takes が, not を.' }),
    );
    assert.match(back, /cat-SUBJ liked is/);
    assert.match(back, /好き takes が/);
  });

  it('omits sections that have no content', () => {
    const back = buildBack({ id: 'a', text: '猫', romaji: 'neko', kana: '', savedAt: 1, reviewCount: 0 });
    assert.match(back, /neko/);
    assert.ok(!back.includes('<a href'));
  });
});

describe('sendToAnki', () => {
  it('creates the deck before adding notes', async () => {
    responder = (body) => ({
      result: body.action === 'createDeck' ? 1 : [101, 102],
      error: null,
    });

    await sendToAnki([item({ id: 'a' }), item({ id: 'b', text: '犬' })], CONFIG);

    assert.deepEqual(calls.map((c) => c.body.action), ['createDeck', 'addNotes']);
    assert.equal(calls[0].body.params.deck, 'Hodoku');
    assert.equal(calls[1].body.params.notes.length, 2);
  });

  it('counts nulls as skipped, which is how Anki reports a duplicate', async () => {
    responder = (body) => ({
      result: body.action === 'createDeck' ? 1 : [101, null, 103],
      error: null,
    });

    const result = await sendToAnki(
      [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })],
      CONFIG,
    );

    assert.equal(result.added, 2);
    assert.equal(result.skipped, 1);
    assert.deepEqual(result.noteIds, [101, null, 103]);
  });

  it('keeps note ids aligned with the input order', async () => {
    responder = (body) => ({ result: body.action === 'createDeck' ? 1 : [null, 202], error: null });
    const result = await sendToAnki([item({ id: 'first' }), item({ id: 'second' })], CONFIG);
    assert.equal(result.noteIds[0], null);
    assert.equal(result.noteIds[1], 202);
  });

  it('does not call Anki at all for an empty list', async () => {
    const result = await sendToAnki([], CONFIG);
    assert.deepEqual(result, { added: 0, skipped: 0, noteIds: [] });
    assert.equal(calls.length, 0);
  });
});


describe('furiganaHtml', () => {
  it('wraps annotated segments in ruby and leaves the rest alone', () => {
    assert.equal(
      furiganaHtml(FURIGANA),
      '<ruby>猫<rt>ねこ</rt></ruby>が<ruby>好<rt>す</rt></ruby>きです',
    );
  });

  it('returns plain text when nothing carries a reading', () => {
    assert.equal(furiganaHtml([{ text: 'ねこ' }, { text: 'です' }]), 'ねこです');
  });

  it('escapes both the base text and the reading', () => {
    const html = furiganaHtml([{ text: '<b>', ruby: '"&"' }]);
    assert.ok(!html.includes('<b>'), 'raw markup survived into the ruby base');
    assert.match(html, /&lt;b&gt;/);
    assert.match(html, /&quot;&amp;&quot;/);
  });

  it('handles an empty list', () => {
    assert.equal(furiganaHtml([]), '');
  });
});

describe('furigana on the card', () => {
  it('puts the annotated sentence at the top of the back', () => {
    const back = buildBack(item(), FURIGANA);
    assert.match(back, /<ruby>猫<rt>ねこ<\/rt><\/ruby>/);
    // It leads, so the answer reads: what it says, how it sounds, what it means.
    assert.ok(back.indexOf('<ruby>') < back.indexOf('Neko ga suki desu'));
  });

  it('drops the plain kana line, which ruby makes redundant', () => {
    const withRuby = buildBack(item(), FURIGANA);
    const without = buildBack(item());
    assert.ok(without.includes('ねこがすきです'), 'kana line missing without furigana');
    assert.ok(!withRuby.includes('<div>ねこがすきです</div>'), 'kana line duplicated under ruby');
  });

  it('falls back to the kana line when no reading is available', () => {
    const back = buildBack(item(), [{ text: 'ねこがすきです' }]);
    assert.ok(!back.includes('<ruby>'));
    assert.ok(back.includes('ねこがすきです'));
  });

  it('never puts furigana on the front — that would give the answer away', () => {
    const note = buildNote(item(), CONFIG, FURIGANA);
    assert.equal(note.fields.Front, '猫が好きです');
    assert.ok(!note.fields.Front.includes('<ruby>'));
    assert.ok(note.fields.Back.includes('<ruby>'));
  });

  it('honours the setting being off', () => {
    const note = buildNote(item(), { ...CONFIG, furigana: false }, FURIGANA);
    assert.ok(!note.fields.Back.includes('<ruby>'));
    assert.ok(note.fields.Back.includes('ねこがすきです'), 'kana line should come back');
  });

  it('sends ruby through to Anki, per item', async () => {
    responder = (body) => ({
      result: body.action === 'createDeck' ? 1 : [101, 102],
      error: null,
    });

    const byId = new Map([['a', FURIGANA]]);
    await sendToAnki([item({ id: 'a' }), item({ id: 'b', text: '犬' })], CONFIG, undefined, byId);

    const notes = calls.find((c) => c.body.action === 'addNotes').body.params.notes;
    assert.ok(notes[0].fields.Back.includes('<ruby>'), 'first note lost its ruby');
    assert.ok(!notes[1].fields.Back.includes('<ruby>'), 'second note gained ruby it had no data for');
  });

  it('still sends a card when alignment is unavailable', async () => {
    responder = (body) => ({ result: body.action === 'createDeck' ? 1 : [101], error: null });
    const result = await sendToAnki([item({ id: 'a' })], CONFIG, undefined, new Map());
    assert.equal(result.added, 1);
  });
});
