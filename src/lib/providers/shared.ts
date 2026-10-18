/**
 * Provider-agnostic pieces of the model requests.
 *
 * Every provider gets the same instructions and the same output contract, so the
 * panel renders identically whichever one is configured and switching provider
 * is not a change in behaviour.
 *
 * Two kinds of request live here: the structured translation (JSON, against a
 * schema) and the free-form "ask about this sentence" exchange (plain text).
 */

import {
  AI_FORMS,
  AI_POS,
  type AiForm,
  type AiPos,
  type AiWord,
  type AskTurn,
  type Explanation,
  type WordToken,
} from '../types';

export const SYSTEM_PROMPT = `You translate Japanese into natural English for a language learner.

You are given one Japanese sentence or phrase, plus the morphological analysis the extension already computed. Return:
- "translation": fluent, idiomatic English. Match the register of the original (casual stays casual, keigo reads as polite).
- "literal": a close, structure-preserving rendering that shows how the Japanese is put together. Keep Japanese word order where English tolerates it.
- "explanation": notes for a learner, in three lists. Each item is one short sentence that names the Japanese it is about. Use an empty list when there is nothing worth saying; never restate the translation.
  - "grammar": the grammar in use — conjugations, particles doing something notable, sentence patterns such as 〜ている or 〜なければならない — and what each one does in this sentence.
  - "exceptions": anything that does not follow the usual rules — idioms, set phrases, colloquial contractions, irregular or unexpected usage, and words whose meaning here differs from their dictionary meaning.
  - "readings": readings a learner could get wrong — irregular kanji readings, rendaku, ateji, counters, and particles read differently from their spelling (は as わ, へ as え).

Translate only what is present. If the text is a fragment, translate it as a fragment rather than inventing a subject or completing the sentence.`;

/**
 * Appended to the system prompt when the user has asked the model to produce
 * the standard fields as well. Kept separate so a plain translation request
 * does not pay for output it will not use.
 *
 * The shape is enforced by the schema (see WORD_SCHEMA); this only explains
 * what goes in each slot, and the conventions a schema cannot express.
 */
export const FIELDS_PROMPT = `
Also return "words": the sentence split into the units a learner would look up, in order, covering the whole text. Keep a verb or adjective together with its conjugation endings and auxiliaries (食べています is one entry, from 食べる), keep each particle separate, and include punctuation as its own entry.
- "surface" is the text exactly as it appears in the sentence, with nothing added or changed.
- "reading" is hiragana as written (勉強 → べんきょう; the particle は stays は); katakana words keep their katakana. Empty for punctuation.
- "pronunciation" is katakana as said, ー for long vowels, particles as pronounced (は → ワ, へ → エ), one element per romaji word: 勉強しています → ["ベンキョー", "シテ", "イマス"], 東京 → ["トーキョー"]. Empty for punctuation.
- "dictionaryForm" is given only when the surface is inflected (食べています → 食べる).
- "inflection" describes the surface as facts: the conjugation of the main word ("form"), whether it is polite, negative or past, whether ている is attached ("progressive"), and any other auxiliary in Japanese ("auxiliary": しまう, たい, そう…). Words that do not conjugate use form "none" with every flag false.
- "meaning" is what it means in this sentence, in a few words.
- "note" is one short sentence of usage guidance when it helps (what the particle is doing, the nuance of the auxiliary), otherwise empty.`;

const STRING_LIST = { type: 'array', items: { type: 'string' } } as const;

const EXPLANATION_SCHEMA = {
  type: 'object',
  properties: {
    grammar: STRING_LIST,
    exceptions: STRING_LIST,
    readings: STRING_LIST,
  },
  required: ['grammar', 'exceptions', 'readings'],
  additionalProperties: false,
} as const;

const INFLECTION_SCHEMA = {
  type: 'object',
  properties: {
    form: { type: 'string', enum: AI_FORMS },
    polite: { type: 'boolean' },
    negative: { type: 'boolean' },
    past: { type: 'boolean' },
    progressive: { type: 'boolean' },
    auxiliary: { type: 'string' },
  },
  required: ['form', 'polite', 'negative', 'past', 'progressive', 'auxiliary'],
  additionalProperties: false,
} as const;

const WORD_SCHEMA = {
  type: 'object',
  properties: {
    surface: { type: 'string' },
    reading: { type: 'string' },
    pronunciation: STRING_LIST,
    dictionaryForm: { type: 'string' },
    pos: { type: 'string', enum: AI_POS },
    inflection: INFLECTION_SCHEMA,
    meaning: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['surface', 'reading', 'pronunciation', 'dictionaryForm', 'pos', 'inflection', 'meaning', 'note'],
  additionalProperties: false,
} as const;

/**
 * The shape every provider is constrained to.
 *
 * `additionalProperties: false` plus every key listed in `required` is what
 * OpenAI's strict mode demands, and Anthropic accepts the same schema, so one
 * definition serves all. The breakdown is only part of the schema when it was
 * asked for.
 */
export function outputSchema(fields: boolean): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    translation: { type: 'string' },
    literal: { type: 'string' },
    explanation: EXPLANATION_SCHEMA,
  };
  const required = ['translation', 'literal', 'explanation'];
  if (fields) {
    properties.words = { type: 'array', items: WORD_SCHEMA };
    required.push('words');
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/** The system prompt for a translation request, with the breakdown section when wanted. */
export function systemPrompt(fields: boolean): string {
  return fields ? SYSTEM_PROMPT + '\n' + FIELDS_PROMPT : SYSTEM_PROMPT;
}

export interface TranslationRequest {
  apiKey: string;
  model: string;
  /** The Japanese being translated. */
  text: string;
  tokens: WordToken[];
  /** Ask for the reading and breakdown as well as the translation. */
  fields?: boolean;
  signal?: AbortSignal;
}

export interface TranslationOutput {
  translation: string;
  literal: string;
  explanation: Explanation;
  /** Present only when the request asked for the standard fields. */
  words?: AiWord[];
}

/**
 * Compact rendering of the analysis, so the model works from the same readings
 * the user is looking at rather than re-deriving them.
 */
export function describeTokens(tokens: WordToken[]): string {
  return tokens
    .filter((t) => !t.isPunctuation)
    .map((t) => {
      const parts = [t.surface];
      if (t.kana && t.kana !== t.surface) parts.push(t.kana);
      if (t.dictionaryForm) parts.push(`← ${t.dictionaryForm}`);
      parts.push(t.posDetail ?? t.pos);
      if (t.glosses.length) parts.push(t.glosses.slice(0, 3).join(', '));
      return parts.join(' | ');
    })
    .join('\n');
}

export function buildUserMessage(request: { text: string; tokens: WordToken[] }): string {
  return (
    `Japanese:\n${request.text}\n\n` +
    'Morphological analysis (surface | reading | dictionary form | part of speech | glosses):\n' +
    describeTokens(request.tokens)
  );
}

/**
 * A model that ignores the requested JSON format — possible on OpenRouter,
 * where not every routed provider enforces it — tends to wrap the JSON in a
 * Markdown fence. Unwrap it rather than fail on an otherwise good answer.
 */
function stripCodeFence(text: string): string {
  const match = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text);
  return match ? match[1] : text;
}

/** A list of trimmed, non-empty strings, however loosely the model typed it. */
function stringList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
  return items.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeExplanation(value: unknown): Explanation {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    grammar: stringList(raw.grammar),
    exceptions: stringList(raw.exceptions),
    readings: stringList(raw.readings),
  };
}

/** An enum value, or the fallback when the model strayed outside the list. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = text(value).toLowerCase();
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : fallback;
}

function normalizeInflection(value: unknown): AiWord['inflection'] {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    form: oneOf<AiForm>(raw.form, AI_FORMS, 'none'),
    polite: raw.polite === true,
    negative: raw.negative === true,
    past: raw.past === true,
    progressive: raw.progressive === true,
    auxiliary: text(raw.auxiliary),
  };
}

function normalizeWords(value: unknown): AiWord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      surface: typeof item.surface === 'string' ? item.surface : '',
      reading: text(item.reading),
      // A model that ignored the schema may still send one string; split it
      // on whitespace rather than lose the word breaks.
      pronunciation: stringList(item.pronunciation).flatMap((part) => part.split(/\s+/)).filter(Boolean),
      dictionaryForm: text(item.dictionaryForm),
      pos: oneOf<AiPos>(item.pos, AI_POS, 'other'),
      inflection: normalizeInflection(item.inflection),
      meaning: text(item.meaning),
      note: text(item.note),
    }))
    .filter((word) => word.surface.trim());
}

/** Parse and validate whatever the model returned. */
export function parseOutput(raw: string): TranslationOutput {
  if (!raw.trim()) throw new Error('The translation came back empty.');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripCodeFence(raw)) as Record<string, unknown>;
  } catch {
    // Structured outputs make this unlikely, but a response truncated by the
    // output-token cap would land here.
    throw new Error('Could not read the translation response.');
  }

  const translation = text(parsed?.translation);
  if (!translation) throw new Error('The translation came back empty.');

  const output: TranslationOutput = {
    translation,
    literal: text(parsed.literal),
    explanation: normalizeExplanation(parsed.explanation),
  };
  const words = normalizeWords(parsed.words);
  if (words) output.words = words;
  return output;
}

/* ------------------------------ asking more ------------------------------- */

export const ASK_SYSTEM_PROMPT = `You are a patient Japanese tutor. A learner highlighted one sentence on a web page and is asking you about it. The sentence, the extension's analysis of it, and its translation follow; treat them as the subject of every question unless the learner clearly asks about something else.

Answer in plain English prose: no Markdown, no headings, no bullet lists. Two to five short sentences unless the question genuinely needs more. Quote Japanese in its original script and add a reading in kana or romaji where it helps. If a question is not about this sentence or about Japanese, say so in a sentence and offer to explain the sentence instead.`;

export interface AskRequest {
  apiKey: string;
  model: string;
  /** The Japanese the question is about. */
  text: string;
  tokens: WordToken[];
  /** The translation the learner is looking at, when there is one. */
  translation?: string;
  /** Earlier exchanges in this thread, oldest first. */
  history: AskTurn[];
  question: string;
  signal?: AbortSignal;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** The tutor instructions plus the sentence under discussion. */
export function buildAskSystem(request: AskRequest): string {
  const context = [buildUserMessage(request)];
  if (request.translation) context.push(`Translation:\n${request.translation}`);
  return `${ASK_SYSTEM_PROMPT}\n\n${context.join('\n\n')}`;
}

/** The thread so far, ending with the new question. */
export function buildAskMessages(request: AskRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of request.history) {
    if (!turn.question.trim() || !turn.answer.trim()) continue;
    messages.push({ role: 'user', content: turn.question });
    messages.push({ role: 'assistant', content: turn.answer });
  }
  messages.push({ role: 'user', content: request.question });
  return messages;
}

/** Tidy a free-form answer for a panel that renders plain text. */
export function parseAnswer(raw: string): string {
  const answer = raw.trim();
  if (!answer) throw new Error('The answer came back empty.');
  return answer;
}
