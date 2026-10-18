/**
 * Turning a model-produced breakdown into WordTokens: matching entries to
 * the sentence, deriving romaji in the user's style, and refusing output that
 * does not line up.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { applyAiFields, aiInflectionLabel, tokensFromAiWords } = await import('../.cache/lib.mjs');

const UNINFLECTED = {
  form: 'none',
  polite: false,
  negative: false,
  past: false,
  progressive: false,
  auxiliary: '',
};

/** A word as the schema shapes it; pronunciation is one element per romaji word. */
const word = (surface, reading, pronunciation, extra = {}) => ({
  surface,
  reading,
  pronunciation: pronunciation ? pronunciation.split(' ') : [],
  dictionaryForm: '',
  pos: 'noun',
  inflection: UNINFLECTED,
  meaning: '',
  note: '',
  ...extra,
});

const SENTENCE = '東京は日本語を勉強しています。';
const WORDS = [
  word('東京', 'とうきょう', 'トーキョー', { meaning: 'Tokyo' }),
  word('は', 'は', 'ワ', { pos: 'particle', meaning: 'topic marker', note: 'Marks the topic.' }),
  word('日本語', 'にほんご', 'ニホンゴ', { meaning: 'Japanese' }),
  word('を', 'を', 'ヲ', { pos: 'particle', meaning: 'object marker' }),
  word('勉強しています', 'べんきょうしています', 'ベンキョー シテ イマス', {
    pos: 'verb',
    dictionaryForm: '勉強する',
    inflection: { ...UNINFLECTED, form: 'te', progressive: true, polite: true },
    meaning: 'am studying',
  }),
  word('。', '', '', { pos: 'punctuation' }),
];

describe('tokensFromAiWords', () => {
  it('builds one token per entry, in sentence order', () => {
    const tokens = tokensFromAiWords(SENTENCE, WORDS, 'macron');
    assert.deepEqual(
      tokens.map((t) => t.surface),
      ['東京', 'は', '日本語', 'を', '勉強しています', '。'],
    );
  });

  it('romanises from the pronunciation, so long vowels and particles come out right', () => {
    const tokens = tokensFromAiWords(SENTENCE, WORDS, 'macron');
    const romaji = Object.fromEntries(tokens.map((t) => [t.surface, t.romaji]));
    assert.equal(romaji['東京'], 'tōkyō');
    assert.equal(romaji['は'], 'wa');
    assert.equal(romaji['を'], 'o', 'the particle を is "o" in Hepburn');
    // One pronunciation element per romaji word, joined with spaces.
    assert.equal(romaji['勉強しています'], 'benkyō shite imasu');
  });

  it('follows the written reading for keyboard spelling', () => {
    const tokens = tokensFromAiWords(SENTENCE, WORDS, 'wapuro');
    const romaji = Object.fromEntries(tokens.map((t) => [t.surface, t.romaji]));
    assert.equal(romaji['東京'], 'toukyou');
    assert.equal(romaji['は'], 'ha');
    assert.equal(romaji['を'], 'wo');
  });

  it('keeps the hiragana reading and derives furigana from it', () => {
    const [tokyo, , nihongo] = tokensFromAiWords(SENTENCE, WORDS, 'macron');
    assert.equal(tokyo.kana, 'とうきょう');
    assert.deepEqual(tokyo.furigana, [{ text: '東京', ruby: 'とうきょう' }]);
    assert.equal(nihongo.reading, 'ニホンゴ', 'the katakana form is kept for consistency with IPADIC');
  });

  it('turns the structured fields into learner-facing labels', () => {
    const tokens = tokensFromAiWords(SENTENCE, WORDS, 'macron');
    const verb = tokens.find((t) => t.surface === '勉強しています');
    assert.equal(verb.pos, 'Verb');
    assert.equal(verb.dictionaryForm, '勉強する');
    assert.equal(verb.inflection, 'Te-form + いる, polite');
    const noun = tokens.find((t) => t.surface === '日本語');
    assert.equal(noun.inflection, undefined, 'an uninflected word should carry no inflection tag');
    assert.deepEqual(verb.glosses, ['am studying']);
    const wa = tokens.find((t) => t.surface === 'は');
    assert.equal(wa.note, 'Marks the topic.');
    assert.equal(wa.attachToPrevious, false);
  });

  it('treats punctuation as punctuation, attached to the previous word', () => {
    const tokens = tokensFromAiWords(SENTENCE, WORDS, 'macron');
    const stop = tokens.at(-1);
    assert.equal(stop.isPunctuation, true);
    assert.equal(stop.attachToPrevious, true);
    assert.equal(stop.romaji, '.');
    assert.equal(stop.kana, '');
  });

  it('recognises punctuation by its characters even if the model did not label it', () => {
    const tokens = tokensFromAiWords('猫、犬', [
      word('猫', 'ねこ', 'ネコ'),
      word('、', '', '', { pos: 'noun' }),
      word('犬', 'いぬ', 'イヌ'),
    ]);
    assert.equal(tokens[1].isPunctuation, true);
  });

  it('fills a gap the model skipped with a plain token', () => {
    const tokens = tokensFromAiWords('猫が好きです。', [
      word('猫', 'ねこ', 'ネコ'),
      // が is missing.
      word('好き', 'すき', 'スキ', { pos: 'na-adjective' }),
      word('です', 'です', 'デス', { pos: 'copula' }),
      word('。', '', ''),
    ], 'macron');
    assert.deepEqual(
      tokens.map((t) => t.surface),
      ['猫', 'が', '好き', 'です', '。'],
    );
    const ga = tokens[1];
    assert.equal(ga.kana, 'が', 'a kana gap should still get its reading');
    assert.equal(ga.romaji, 'ga');
    assert.deepEqual(ga.glosses, []);
  });

  it('drops an entry that is not in the sentence', () => {
    const tokens = tokensFromAiWords('猫が好きです', [
      word('猫', 'ねこ', 'ネコ'),
      word('が', 'が', 'ガ'),
      word('大', 'だい', 'ダイ'), // invented
      word('好き', 'すき', 'スキ'),
      word('です', 'です', 'デス'),
    ], 'macron');
    assert.deepEqual(tokens.map((t) => t.surface), ['猫', 'が', '好き', 'です']);
  });

  it('refuses output that mostly does not match the sentence', () => {
    const tokens = tokensFromAiWords('猫が好きです', [
      word('犬', 'いぬ', 'イヌ'),
      word('を', 'を', 'ヲ'),
      word('見た', 'みた', 'ミタ'),
      word('猫', 'ねこ', 'ネコ'),
    ], 'macron');
    assert.equal(tokens, null);
  });

  it('refuses an empty breakdown', () => {
    assert.equal(tokensFromAiWords('猫', [], 'macron'), null);
    assert.equal(tokensFromAiWords('猫', [word('', '', '')], 'macron'), null);
  });

  it('gives a kana dictionary form its romaji', () => {
    const [token] = tokensFromAiWords('食べた', [
      word('食べた', 'たべた', 'タベタ', { pos: 'verb', dictionaryForm: 'たべる' }),
    ], 'macron');
    assert.equal(token.dictionaryFormRomaji, 'taberu');
  });
});

describe('inflectionLabel', () => {
  it('says nothing for an uninflected word', () => {
    assert.equal(aiInflectionLabel(UNINFLECTED), undefined);
  });

  it('names the form, then what is attached, then the qualifiers', () => {
    assert.equal(
      aiInflectionLabel({ ...UNINFLECTED, form: 'te', progressive: true, polite: true }),
      'Te-form + いる, polite',
    );
    assert.equal(
      aiInflectionLabel({ ...UNINFLECTED, form: 'ta', negative: true, past: true }),
      'Ta-form, past, negative',
    );
    assert.equal(
      aiInflectionLabel({ ...UNINFLECTED, form: 'te', auxiliary: 'しまう', past: true }),
      'Te-form + しまう, past',
    );
  });

  it('labels politeness alone, for ます on a plain stem', () => {
    assert.equal(aiInflectionLabel({ ...UNINFLECTED, form: 'stem', polite: true }), 'Stem, polite');
    assert.equal(aiInflectionLabel({ ...UNINFLECTED, polite: true }), 'polite');
  });
});

describe('applyAiFields', () => {
  const offline = () => ({
    text: SENTENCE,
    romaji: 'Tōkyō wa nihongo o benkyō shite imasu.',
    kana: 'とうきょうはにほんごをべんきょうしています。',
    tokens: [{ surface: 'offline', isPunctuation: false }],
    warnings: [],
  });

  it('replaces the reading, romaji and breakdown', () => {
    const analysis = offline();
    assert.equal(applyAiFields(analysis, WORDS, 'macron'), true);
    assert.equal(analysis.aiFields, true);
    assert.equal(analysis.romaji, 'Tōkyō wa nihongo o benkyō shite imasu.');
    assert.equal(analysis.kana, 'とうきょうはにほんごをべんきょうしています。');
    assert.equal(analysis.tokens.length, 6);
  });

  it('leaves the analysis untouched when the breakdown is unusable', () => {
    const analysis = offline();
    assert.equal(applyAiFields(analysis, [word('犬', 'いぬ', 'イヌ')], 'macron'), false);
    assert.equal(analysis.aiFields, undefined);
    assert.equal(analysis.tokens[0].surface, 'offline');
    assert.equal(analysis.romaji, 'Tōkyō wa nihongo o benkyō shite imasu.');
  });
});
