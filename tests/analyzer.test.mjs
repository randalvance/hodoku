/**
 * End-to-end test over the real dictionaries.
 *
 * The analyser fetches its data files, which in the extension are packaged
 * URLs. Here `fetch` is shimmed to read from disk so the same code path runs
 * unmodified against the actual IPADIC and JMdict data.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { before, describe, it } from 'node:test';

import { Analyzer, assembleRomaji } from '../.cache/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KUROMOJI_DICT = path.join(ROOT, 'node_modules', 'kuromoji', 'dict');
const JMDICT = path.join(ROOT, 'public', 'dict', 'jmdict.bin');

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('file://')) return realFetch(input, init);
  const buffer = await fs.readFile(fileURLToPath(url));
  return new Response(buffer, { status: 200 });
};

const exists = (target) => fs.stat(target).then(() => true, () => false);

const hasKuromoji = await exists(path.join(KUROMOJI_DICT, 'base.dat.gz'));
const hasJmdict = await exists(JMDICT);

describe('Analyzer', { skip: hasKuromoji ? false : 'kuromoji dictionary not installed' }, () => {
  const analyzer = new Analyzer();

  before(async () => {
    await analyzer.init({
      tokenizerBaseUrl: pathToFileURL(KUROMOJI_DICT + path.sep).href,
      dictionaryUrl: hasJmdict ? pathToFileURL(JMDICT).href : null,
    });
  });

  it('romanises a full sentence with Hepburn word spacing', () => {
    const result = analyzer.analyze('日本語を勉強しています。');
    assert.equal(result.romaji, 'Nihongo o benkyō shite imasu.');
  });

  it('reads the topic particle は as wa', () => {
    const result = analyzer.analyze('私は学生です');
    assert.equal(result.romaji, 'Watashi wa gakusei desu');
  });

  it('reads the direction particle へ as e', () => {
    const result = analyzer.analyze('東京へ行きました');
    assert.equal(result.romaji, 'Tōkyō e ikimashita');
  });

  it('writes the copula as its own word', () => {
    // です is an auxiliary, but Hepburn spaces it: "gakusei desu", never
    // "gakuseidesu". Inflectional auxiliaries like ます and た still attach.
    assert.equal(analyzer.analyze('学生です').romaji, 'Gakusei desu');
    assert.equal(analyzer.analyze('寒いです').romaji, 'Samui desu');
    assert.equal(analyzer.analyze('学生でした').romaji, 'Gakusei deshita');
    assert.equal(analyzer.analyze('食べたいです').romaji, 'Tabetai desu');
  });

  it('resolves long vowels from pronunciation, not spelling', () => {
    // 王 and 追う are both written オウ; only the pronunciation field tells
    // them apart. えい stays "ei" in modern Hepburn.
    assert.equal(analyzer.analyze('王').romaji, 'Ō');
    assert.equal(analyzer.analyze('追う').romaji, 'Ou');
    assert.equal(analyzer.analyze('先生').romaji, 'Sensei');
    assert.equal(analyzer.analyze('時計').romaji, 'Tokei');
  });

  it('carries gemination across the token boundary', () => {
    // The 促音便 verb forms all tokenise as [stem + っ][た/て], so the doubled
    // consonant belongs to a different token than the っ that causes it.
    assert.equal(analyzer.analyze('うしなった').romaji, 'Ushinatta');
    assert.equal(analyzer.analyze('失った').romaji, 'Ushinatta');
    assert.equal(analyzer.analyze('行った').romaji, 'Itta');
    assert.equal(analyzer.analyze('買った').romaji, 'Katta');
    assert.equal(analyzer.analyze('待って').romaji, 'Matte');
    assert.equal(analyzer.analyze('言って').romaji, 'Itte');
    assert.equal(analyzer.analyze('持っている').romaji, 'Motte iru');
  });

  it('never spells a small tsu out as an IME escape', () => {
    for (const text of ['行った', '買った', '待って', '持っている', 'あっ', '一緒に行った']) {
      const result = analyzer.analyze(text);
      assert.ok(!result.romaji.includes('ltsu'), `${text} produced ${result.romaji}`);
      for (const token of result.tokens) {
        assert.ok(!token.romaji.includes('ltsu'), `${text} token produced ${token.romaji}`);
      }
    }
  });

  it('still doubles correctly inside a single token', () => {
    assert.equal(analyzer.analyze('ちょっと').romaji, 'Chotto');
    assert.equal(analyzer.analyze('やっぱり').romaji, 'Yappari');
    assert.equal(analyzer.analyze('抹茶').romaji, 'Matcha');
  });

  it('drops a sentence-final sokuon, which has no Hepburn spelling', () => {
    assert.equal(analyzer.analyze('あっ').romaji, 'A');
  });

  it('exposes the kana reading of the whole sentence', () => {
    const result = analyzer.analyze('東京へ行きました');
    assert.equal(result.kana, 'とうきょうへいきました');
  });

  it('splits the sentence into annotated words', () => {
    const { tokens } = analyzer.analyze('猫が好きです');
    assert.deepEqual(
      tokens.map((t) => t.surface),
      ['猫', 'が', '好き', 'です'],
    );

    const [neko, ga] = tokens;
    assert.equal(neko.romaji, 'neko');
    assert.equal(neko.kana, 'ねこ');
    assert.equal(neko.pos, 'Noun');
    assert.equal(ga.pos, 'Particle');
    assert.equal(ga.posDetail, 'Case-marking particle');
  });

  it('reports the dictionary form of an inflected verb', () => {
    const { tokens } = analyzer.analyze('食べました');
    const verb = tokens.find((t) => t.posJa === '動詞');
    assert.equal(verb.surface, '食べ');
    assert.equal(verb.dictionaryForm, '食べる');
    assert.equal(verb.inflection, 'Stem form (precedes ます)');
  });

  it('attaches furigana only to the kanji part of a word', () => {
    const { tokens } = analyzer.analyze('食べる');
    assert.deepEqual(tokens[0].furigana, [{ text: '食', ruby: 'た' }, { text: 'べる' }]);
  });

  it('explains particles with a curated note', () => {
    const { tokens } = analyzer.analyze('私は猫が好きです');
    const wa = tokens.find((t) => t.surface === 'は');
    assert.deepEqual(wa.glosses, ['topic marker']);
    assert.match(wa.note, /topic/i);
  });

  it('marks punctuation so it is not spaced as a word', () => {
    const { tokens } = analyzer.analyze('はい。');
    const period = tokens.at(-1);
    assert.equal(period.isPunctuation, true);
    assert.equal(period.romaji, '.');
    assert.equal(period.attachToPrevious, true);
  });

  it('respects the romaji style setting', () => {
    assert.equal(analyzer.analyze('東京', 'macron').romaji, 'Tōkyō');
    assert.equal(analyzer.analyze('東京', 'doubled').romaji, 'Tookyoo');
    assert.equal(analyzer.analyze('東京', 'none').romaji, 'Tokyo');
    assert.equal(analyzer.analyze('東京', 'wapuro').romaji, 'Toukyou');
  });

  it('returns an empty analysis for blank input', () => {
    const result = analyzer.analyze('   ');
    assert.equal(result.romaji, '');
    assert.deepEqual(result.tokens, []);
  });

  it('handles text with no Japanese without throwing', () => {
    const result = analyzer.analyze('hello');
    assert.equal(typeof result.romaji, 'string');
  });

  it('normalises halfwidth katakana before analysing', () => {
    const result = analyzer.analyze('ｱﾒﾘｶ');
    assert.equal(result.romaji, 'Amerika');
  });
});

describe('Analyzer with dictionary', { skip: hasJmdict ? false : 'run `npm run build:dict` first' }, () => {
  const analyzer = new Analyzer();

  before(async () => {
    await analyzer.init({
      tokenizerBaseUrl: pathToFileURL(KUROMOJI_DICT + path.sep).href,
      dictionaryUrl: pathToFileURL(JMDICT).href,
    });
  });

  it('loads a substantial number of headwords', () => {
    assert.equal(analyzer.stats.dictionaryError, null);
    assert.ok(analyzer.stats.dictionaryHeadwords > 100_000);
  });

  it('attaches English meanings to content words', () => {
    const { tokens } = analyzer.analyze('猫が好きです');
    const neko = tokens[0];
    assert.ok(neko.glosses.length > 0);
    assert.ok(neko.glosses.some((g) => /cat/i.test(g)));
    assert.equal(neko.common, true);
  });

  it('looks meanings up by dictionary form, not the inflected surface', () => {
    const { tokens } = analyzer.analyze('食べました');
    const verb = tokens.find((t) => t.posJa === '動詞');
    assert.ok(verb.glosses.some((g) => /eat/i.test(g)));
  });

  it('reports the reading of the dictionary form', () => {
    const { tokens } = analyzer.analyze('行きました');
    const verb = tokens.find((t) => t.posJa === '動詞');
    assert.equal(verb.dictionaryForm, '行く');
    assert.equal(verb.dictionaryFormKana, 'いく');
    assert.equal(verb.dictionaryFormRomaji, 'iku');
  });
});

describe('assembleRomaji', () => {
  const word = (surface, romaji, extra = {}) => ({
    surface,
    romaji,
    attachToPrevious: false,
    isPunctuation: false,
    ...extra,
  });

  it('capitalises the first word', () => {
    assert.equal(assembleRomaji([word('ねこ', 'neko')]), 'Neko');
  });

  it('joins attached tokens without a space', () => {
    const tokens = [word('食べ', 'tabe'), word('ます', 'masu', { attachToPrevious: true })];
    assert.equal(assembleRomaji(tokens), 'Tabemasu');
  });

  it('starts a new sentence after a full stop', () => {
    const tokens = [
      word('はい', 'hai'),
      word('。', '.', { attachToPrevious: true, isPunctuation: true }),
      word('ねこ', 'neko'),
    ];
    assert.equal(assembleRomaji(tokens), 'Hai. Neko');
  });

  it('skips tokens with no romaji', () => {
    assert.equal(assembleRomaji([word('ねこ', 'neko'), word('？', '')]), 'Neko');
  });
});
