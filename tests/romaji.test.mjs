import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { endsWithSokuon, geminationFor, kanaToRomaji } from '../.cache/lib.mjs';

describe('kanaToRomaji — Hepburn basics', () => {
  const cases = [
    ['ニホン', 'nihon'],
    ['サクラ', 'sakura'],
    ['シンブン', 'shinbun'],
    ['チカテツ', 'chikatetsu'],
    ['ツナミ', 'tsunami'],
    ['フジサン', 'fujisan'],
    ['ヤマ', 'yama'],
    ['オンガク', 'ongaku'],
  ];

  for (const [kana, expected] of cases) {
    it(`${kana} -> ${expected}`, () => {
      assert.equal(kanaToRomaji(kana), expected);
    });
  }

  it('accepts hiragana as well as katakana', () => {
    assert.equal(kanaToRomaji('にほんご'), 'nihongo');
  });
});

describe('kanaToRomaji — digraphs', () => {
  const cases = [
    ['キョク', 'kyoku'],
    ['シャシン', 'shashin'],
    ['ジュース', 'jūsu'],
    ['チャワン', 'chawan'],
    ['ビョーキ', 'byōki'],
    ['リョーリ', 'ryōri'],
    ['ジェット', 'jetto'],
    ['ファイル', 'fairu'],
    ['ヴァイオリン', 'vaiorin'],
  ];

  for (const [kana, expected] of cases) {
    it(`${kana} -> ${expected}`, () => {
      assert.equal(kanaToRomaji(kana), expected);
    });
  }
});

describe('kanaToRomaji — sokuon', () => {
  it('doubles the following consonant', () => {
    assert.equal(kanaToRomaji('キッテ'), 'kitte');
    assert.equal(kanaToRomaji('ガッコー'), 'gakkō');
  });

  it('writes っち as tch, not cch', () => {
    assert.equal(kanaToRomaji('マッチャ'), 'matcha');
    assert.equal(kanaToRomaji('コッチ'), 'kotchi');
  });
});

describe('kanaToRomaji — trailing sokuon', () => {
  // The analyser splits 行った into 行っ + た, so a token can end in っ. It has
  // no sound of its own and must never be spelled out.
  it('emits nothing for a sokuon with nothing to double', () => {
    assert.equal(kanaToRomaji('イッ'), 'i');
    assert.equal(kanaToRomaji('ウシナッ'), 'ushina');
    assert.equal(kanaToRomaji('アッ'), 'a');
  });

  it('never produces the IME escape for a small tsu', () => {
    for (const kana of ['イッ', 'ウシナッ', 'カッ', 'マッ', 'アッ']) {
      assert.ok(!kanaToRomaji(kana).includes('ltsu'), `${kana} produced an ltsu`);
      assert.ok(!kanaToRomaji(kana, 'wapuro').includes('ltsu'), `${kana} produced an ltsu (wapuro)`);
    }
  });
});

describe('endsWithSokuon', () => {
  it('detects a trailing small tsu in either script', () => {
    assert.equal(endsWithSokuon('イッ'), true);
    assert.equal(endsWithSokuon('いっ'), true);
    assert.equal(endsWithSokuon('イチ'), false);
    assert.equal(endsWithSokuon(''), false);
  });

  it('is false when the sokuon is not last', () => {
    assert.equal(endsWithSokuon('キッテ'), false);
  });
});

describe('geminationFor', () => {
  it('doubles a following consonant', () => {
    assert.equal(geminationFor('ta'), 't');
    assert.equal(geminationFor('ka'), 'k');
    assert.equal(geminationFor('shi'), 's');
  });

  it('writes っち as tch, matching the matcha rule', () => {
    assert.equal(geminationFor('chi'), 't');
    assert.equal(geminationFor('cha'), 't');
  });

  it('contributes nothing before a vowel', () => {
    assert.equal(geminationFor('a'), '');
    assert.equal(geminationFor('iru'), '');
  });

  it('contributes nothing before punctuation or nothing at all', () => {
    assert.equal(geminationFor('.'), '');
    assert.equal(geminationFor(''), '');
  });
});

describe('kanaToRomaji — moraic n', () => {
  it('adds an apostrophe before a vowel', () => {
    assert.equal(kanaToRomaji('キンエン'), "kin'en");
  });

  it('adds an apostrophe before y', () => {
    assert.equal(kanaToRomaji('ホンヤ'), "hon'ya");
  });

  it('leaves n alone before a consonant', () => {
    assert.equal(kanaToRomaji('ホンダ'), 'honda');
  });
});

describe('kanaToRomaji — long vowels', () => {
  it('turns the prolonged sound mark into a macron', () => {
    assert.equal(kanaToRomaji('トーキョー'), 'tōkyō');
    assert.equal(kanaToRomaji('ビール'), 'bīru');
    assert.equal(kanaToRomaji('コーヒー'), 'kōhī');
  });

  it('merges repeated vowels except i', () => {
    assert.equal(kanaToRomaji('オオサカ'), 'ōsaka');
    assert.equal(kanaToRomaji('オイシイ'), 'oishii');
  });

  it('leaves えい alone — modern Hepburn writes sensei, not sensē', () => {
    assert.equal(kanaToRomaji('センセイ'), 'sensei');
    assert.equal(kanaToRomaji('トケイ'), 'tokei');
  });

  it('transcribes オウ literally rather than guessing a long o', () => {
    // 王 and 追う are both オウ when written but differ when spoken. The
    // analyser resolves this by passing IPADIC's pronunciation (オー vs オウ),
    // so the converter must not second-guess the kana it is handed.
    assert.equal(kanaToRomaji('オウ'), 'ou');
    assert.equal(kanaToRomaji('オー'), 'ō');
  });
});

describe('kanaToRomaji — styles', () => {
  it('doubled keeps length without macrons', () => {
    assert.equal(kanaToRomaji('トーキョー', 'doubled'), 'tookyoo');
    assert.equal(kanaToRomaji('ビール', 'doubled'), 'biiru');
  });

  it('none drops length entirely', () => {
    assert.equal(kanaToRomaji('トーキョー', 'none'), 'tokyo');
    assert.equal(kanaToRomaji('ガッコー', 'none'), 'gakko');
  });

  it('wapuro transcribes what you would type', () => {
    assert.equal(kanaToRomaji('トウキョウ', 'wapuro'), 'toukyou');
    assert.equal(kanaToRomaji('ガッコウ', 'wapuro'), 'gakkou');
    assert.equal(kanaToRomaji('ビール', 'wapuro'), 'biiru');
  });
});

describe('kanaToRomaji — edge cases', () => {
  it('returns an empty string for empty input', () => {
    assert.equal(kanaToRomaji(''), '');
  });

  it('passes non-kana characters through', () => {
    assert.equal(kanaToRomaji('ABC'), 'ABC');
  });

  it('handles a trailing sokuon without crashing', () => {
    assert.equal(typeof kanaToRomaji('アッ'), 'string');
  });
});
