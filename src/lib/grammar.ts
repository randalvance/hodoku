/**
 * Translation of IPADIC's Japanese grammatical labels into terms a learner can
 * actually use, plus curated notes for the function words that a dictionary
 * lookup explains poorly.
 */

/** Top-level part of speech. */
const POS_LABELS: Record<string, string> = {
  名詞: 'Noun',
  動詞: 'Verb',
  形容詞: 'I-adjective',
  副詞: 'Adverb',
  助詞: 'Particle',
  助動詞: 'Auxiliary',
  接続詞: 'Conjunction',
  連体詞: 'Adnominal',
  感動詞: 'Interjection',
  接頭詞: 'Prefix',
  フィラー: 'Filler',
  記号: 'Symbol',
  その他: 'Other',
};

/** pos_detail_1, keyed by "<pos>/<detail>" so the same word means different things. */
const POS_DETAIL_LABELS: Record<string, string> = {
  '名詞/固有名詞': 'Proper noun',
  '名詞/代名詞': 'Pronoun',
  '名詞/数': 'Number',
  '名詞/サ変接続': 'Noun (forms a verb with する)',
  '名詞/形容動詞語幹': 'Na-adjective stem',
  '名詞/副詞可能': 'Noun (can act as an adverb)',
  '名詞/非自立': 'Dependent noun',
  '名詞/接尾': 'Noun suffix',
  '名詞/接続詞的': 'Connective noun',
  '名詞/動詞非自立的': 'Dependent verbal noun',
  '名詞/ナイ形容詞語幹': 'Nai-adjective stem',
  '名詞/引用文字列': 'Quoted string',
  '名詞/一般': 'Common noun',

  '動詞/自立': 'Verb',
  '動詞/非自立': 'Helper verb',
  '動詞/接尾': 'Verb suffix',

  '形容詞/自立': 'I-adjective',
  '形容詞/非自立': 'Helper adjective',
  '形容詞/接尾': 'Adjective suffix',

  '助詞/格助詞': 'Case-marking particle',
  '助詞/係助詞': 'Topic/binding particle',
  '助詞/副助詞': 'Adverbial particle',
  '助詞/接続助詞': 'Conjunctive particle',
  '助詞/終助詞': 'Sentence-ending particle',
  '助詞/連体化': 'Attributive particle',
  '助詞/並立助詞': 'Coordinating particle',
  '助詞/副詞化': 'Adverbialising particle',
  '助詞/間投助詞': 'Interjectory particle',
  '助詞/副助詞／並立助詞／終助詞': 'Multi-purpose particle',
  '助詞/特殊': 'Special particle',

  '接頭詞/名詞接続': 'Noun prefix',
  '接頭詞/動詞接続': 'Verb prefix',
  '接頭詞/形容詞接続': 'Adjective prefix',
  '接頭詞/数接続': 'Numeric prefix',

  '記号/句点': 'Full stop',
  '記号/読点': 'Comma',
  '記号/括弧開': 'Opening bracket',
  '記号/括弧閉': 'Closing bracket',
  '記号/空白': 'Whitespace',
  '記号/一般': 'Symbol',
  '記号/アルファベット': 'Latin letter',
};

/** conjugated_form -> learner-facing description. */
const INFLECTION_LABELS: Record<string, string> = {
  基本形: 'Dictionary form',
  未然形: 'Irrealis stem (precedes ない/よう)',
  ' 未然ウ接続': 'Volitional stem',
  未然ウ接続: 'Volitional stem',
  未然ヌ接続: 'Negative stem (precedes ぬ)',
  未然レル接続: 'Passive/potential stem',
  未然特殊: 'Irrealis stem',
  連用形: 'Stem form (precedes ます)',
  連用タ接続: 'Stem before た/て',
  連用テ接続: 'Stem before て',
  連用ゴザイ接続: 'Polite stem',
  連用デ接続: 'Stem before で',
  連用ニ接続: 'Stem before に',
  体言接続: 'Attributive (before a noun)',
  体言接続特殊: 'Attributive (before a noun)',
  体言接続特殊２: 'Attributive (before a noun)',
  連体形: 'Attributive (before a noun)',
  仮定形: 'Conditional (ば) form',
  仮定縮約１: 'Contracted conditional',
  仮定縮約２: 'Contracted conditional',
  命令ｅ: 'Imperative',
  命令ｉ: 'Imperative',
  命令ｒｏ: 'Imperative',
  命令ｙｏ: 'Imperative',
  音便基本形: 'Euphonic form',
  現代基本形: 'Modern dictionary form',
  ガル接続: 'Stem before がる',
};

/**
 * Curated notes for function words. These outrank the dictionary because
 * JMdict's particle entries are long and hard to skim mid-sentence.
 */
const FUNCTION_WORD_NOTES: Record<string, { glosses: string[]; note: string }> = {
  は: { glosses: ['topic marker'], note: 'Marks the topic: “as for X…”. Pronounced “wa”.' },
  が: { glosses: ['subject marker', 'but'], note: 'Marks the grammatical subject, or introduces new information.' },
  を: { glosses: ['direct object marker'], note: 'Marks the thing the verb acts on. Pronounced “o”.' },
  に: { glosses: ['to', 'at', 'in', 'for'], note: 'Destination, point in time, indirect object, or place of existence.' },
  で: { glosses: ['at', 'by', 'with', 'using'], note: 'Location of an action, or the means used to do it.' },
  へ: { glosses: ['to', 'toward'], note: 'Direction of movement. Pronounced “e”.' },
  と: { glosses: ['and', 'with', 'that (quotation)'], note: 'Joins nouns exhaustively, marks a companion, or quotes speech/thought.' },
  も: { glosses: ['also', 'too', 'even'], note: 'Replaces は/が/を to mean “also” or “even”.' },
  の: { glosses: ['of', 'possessive marker'], note: 'Links two nouns: A の B is “B of A”. Also nominalises clauses.' },
  から: { glosses: ['from', 'because'], note: 'Starting point in space or time, or a reason.' },
  まで: { glosses: ['until', 'as far as'], note: 'End point in space or time.' },
  より: { glosses: ['than', 'from'], note: 'Marks the standard in a comparison.' },
  か: { glosses: ['question marker', 'or'], note: 'Turns a statement into a question, or offers alternatives.' },
  ね: { glosses: ['right?', "isn't it?"], note: 'Seeks agreement or softens a statement.' },
  よ: { glosses: ['you know', 'I tell you'], note: 'Asserts new information to the listener.' },
  な: { glosses: ['don’t', 'sentence-ending particle'], note: 'Emphasis, or a blunt negative command after a dictionary-form verb.' },
  ば: { glosses: ['if'], note: 'Conditional: “if X, then Y”.' },
  て: { glosses: ['and then', 'linking form'], note: 'Joins clauses, or attaches to helper verbs like いる and しまう.' },
  や: { glosses: ['and (among others)'], note: 'Lists examples non-exhaustively.' },
  だけ: { glosses: ['only', 'just'], note: 'Limits the preceding word.' },
  しか: { glosses: ['only (with a negative)'], note: 'Used with a negative verb: “nothing but…”.' },
  ながら: { glosses: ['while'], note: 'Two actions by the same person at once.' },
  ので: { glosses: ['because', 'since'], note: 'States a reason, softer than から.' },
  のに: { glosses: ['even though'], note: 'Marks an unexpected or contrary result.' },
  けど: { glosses: ['but', 'although'], note: 'Casual contrast, softer than が.' },
  ます: { glosses: ['polite verb ending'], note: 'Makes the verb polite. Attaches to the stem form.' },
  ました: { glosses: ['polite past'], note: 'Polite past tense.' },
  です: { glosses: ['to be (polite)'], note: 'Polite copula, or politeness on an adjective.' },
  だ: { glosses: ['to be (plain)'], note: 'Plain copula.' },
  た: { glosses: ['past tense marker'], note: 'Marks completed action or past state.' },
  ない: { glosses: ['not'], note: 'Plain negative ending.' },
  ぬ: { glosses: ['not (archaic)'], note: 'Classical negative ending.' },
  たい: { glosses: ['want to'], note: 'Expresses the speaker’s desire. Conjugates like an i-adjective.' },
  れる: { glosses: ['passive', 'potential', 'honorific'], note: 'Passive, potential, or respectful depending on context.' },
  られる: { glosses: ['passive', 'potential', 'honorific'], note: 'Passive, potential, or respectful depending on context.' },
  せる: { glosses: ['causative'], note: 'Make or let someone do something.' },
  させる: { glosses: ['causative'], note: 'Make or let someone do something.' },
  そう: { glosses: ['seems', 'looks like'], note: 'Appearance based on what the speaker observes.' },
  よう: { glosses: ['seems like', 'as if'], note: 'Resemblance or conjecture.' },
  らしい: { glosses: ['apparently', 'seems'], note: 'Hearsay, or behaviour typical of something.' },
  ん: { glosses: ['explanatory の'], note: 'Contraction of の: gives background or explanation.' },
  いる: { glosses: ['to be (animate)', 'progressive helper'], note: 'After て, marks an ongoing action or resulting state.' },
  ある: { glosses: ['to be (inanimate)', 'to exist'], note: 'After て, marks a state someone has set up.' },
  しまう: { glosses: ['to finish', 'to do regrettably'], note: 'After て, marks completion or regret.' },
  くる: { glosses: ['to come'], note: 'After て, movement toward the speaker or a change over time.' },
  いく: { glosses: ['to go'], note: 'After て, movement away or a change continuing onward.' },
  みる: { glosses: ['to try'], note: 'After て, means “try doing”.' },
  おく: { glosses: ['to do in advance'], note: 'After て, means “do something ahead of time”.' },
};

const PUNCTUATION_ROMAJI: Record<string, string> = {
  '。': '.',
  '、': ',',
  '，': ',',
  '．': '.',
  '！': '!',
  '？': '?',
  '「': '“',
  '」': '”',
  '『': '“',
  '』': '”',
  '（': '(',
  '）': ')',
  '・': '·',
  '…': '…',
  '〜': '~',
  '～': '~',
  '：': ':',
  '；': ';',
};

export function posLabel(pos: string): string {
  return POS_LABELS[pos] ?? pos;
}

export function posDetailLabel(pos: string, detail: string): string | undefined {
  if (!detail || detail === '*') return undefined;
  return POS_DETAIL_LABELS[`${pos}/${detail}`] ?? detail;
}

export function inflectionLabel(form: string): string | undefined {
  if (!form || form === '*') return undefined;
  return INFLECTION_LABELS[form] ?? form;
}

export function functionWordNote(
  surface: string,
  basicForm: string,
): { glosses: string[]; note: string } | undefined {
  return FUNCTION_WORD_NOTES[basicForm] ?? FUNCTION_WORD_NOTES[surface];
}

export function punctuationRomaji(surface: string): string | undefined {
  return PUNCTUATION_ROMAJI[surface];
}

/** The copula is written as its own word: "gakusei desu", not "gakuseidesu". */
const STANDALONE_AUXILIARIES = new Set(['です', 'だ']);

/**
 * Decide whether a token joins the previous one when writing the sentence in
 * romaji. Hepburn convention: particles and the copula stand alone, but
 * inflectional auxiliaries, suffixes and the て/で connectors bind to the word
 * they modify.
 */
export function attachesToPrevious(
  pos: string,
  detail: string,
  surface: string,
  basicForm: string,
): boolean {
  if (pos === '記号') return true;
  if (pos === '助動詞') return !STANDALONE_AUXILIARIES.has(basicForm);
  if (detail === '接尾') return true;
  if (pos === '助詞' && detail === '接続助詞') {
    return surface === 'て' || surface === 'で' || surface === 'ば' || surface === 'たら';
  }
  return false;
}
