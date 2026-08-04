import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  containsJapanese,
  furiganaSegments,
  isKanji,
  normalizeJapanese,
  toHiragana,
  toKatakana,
  widenHalfwidthKatakana,
} from '../.cache/lib.mjs';

describe('script detection', () => {
  it('detects kana and kanji', () => {
    assert.equal(containsJapanese('こんにちは'), true);
    assert.equal(containsJapanese('東京'), true);
    assert.equal(containsJapanese('カタカナ'), true);
  });

  it('ignores plain Latin text', () => {
    assert.equal(containsJapanese('hello world'), false);
    assert.equal(containsJapanese('123 — ok'), false);
  });

  it('finds Japanese embedded in Latin text', () => {
    assert.equal(containsJapanese('the word 猫 means cat'), true);
  });

  it('recognises the iteration mark as kanji', () => {
    assert.equal(isKanji('々'), true);
  });
});

describe('kana conversion', () => {
  it('round-trips hiragana and katakana', () => {
    assert.equal(toKatakana('にほんご'), 'ニホンゴ');
    assert.equal(toHiragana('ニホンゴ'), 'にほんご');
  });

  it('leaves kanji and punctuation alone', () => {
    assert.equal(toKatakana('日本語です。'), '日本語デス。');
  });

  it('widens halfwidth katakana, including voicing marks', () => {
    assert.equal(widenHalfwidthKatakana('ｶﾀｶﾅ'), 'カタカナ');
    assert.equal(widenHalfwidthKatakana('ｶﾞｯｺｳ'), 'ガッコウ');
    assert.equal(widenHalfwidthKatakana('ﾊﾟﾝ'), 'パン');
  });

  it('normalises halfwidth input', () => {
    assert.equal(normalizeJapanese('ﾆﾎﾝ'), 'ニホン');
  });
});

describe('furigana alignment', () => {
  it('annotates a bare kanji compound', () => {
    assert.deepEqual(furiganaSegments('東京', 'トウキョウ'), [
      { text: '東京', ruby: 'とうきょう' },
    ]);
  });

  it('keeps okurigana outside the ruby', () => {
    assert.deepEqual(furiganaSegments('食べる', 'タベル'), [
      { text: '食', ruby: 'た' },
      { text: 'べる' },
    ]);
  });

  it('strips a shared kana prefix', () => {
    assert.deepEqual(furiganaSegments('お茶', 'オチャ'), [
      { text: 'お' },
      { text: '茶', ruby: 'ちゃ' },
    ]);
  });

  it('does not annotate kana-only words', () => {
    assert.deepEqual(furiganaSegments('こんにちは', 'コンニチハ'), [{ text: 'こんにちは' }]);
  });

  it('falls back to the plain surface when there is no reading', () => {
    assert.deepEqual(furiganaSegments('東京', ''), [{ text: '東京' }]);
  });
});
