import type { RomajiStyle } from './romaji';
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from './providers/registry';
import { DEFAULT_ANKI_CONFIG, type AnkiConfig } from './anki';
import type { Explanation } from './explanation';

export type { RomajiStyle, ProviderId, Explanation };

export interface FuriganaSegment {
  text: string;
  ruby?: string;
}

export interface DictionaryEntry {
  /** Headword as written in the dictionary. */
  word: string;
  /** Kana reading of the headword. */
  reading: string;
  /** English senses, most common first. */
  senses: Array<{ pos: string[]; glosses: string[] }>;
  /** True when JMdict marks the entry as a common word. */
  common: boolean;
}

export interface WordToken {
  /** Text exactly as it appears in the source. */
  surface: string;
  /** Katakana reading as written. */
  reading: string;
  /** Hiragana reading, for display. */
  kana: string;
  /** Romaji for this token alone. */
  romaji: string;
  /** Kanji-to-kana alignment used to render furigana. */
  furigana: FuriganaSegment[];

  /** Human-readable part of speech, e.g. "Verb". */
  pos: string;
  /** Original IPADIC part of speech, e.g. "動詞". */
  posJa: string;
  /** Finer-grained label, e.g. "Case-marking particle". */
  posDetail?: string;

  /** Plain/dictionary form, when the token is inflected. */
  dictionaryForm?: string;
  dictionaryFormKana?: string;
  dictionaryFormRomaji?: string;
  /** Human-readable inflection, e.g. "Past (plain)". */
  inflection?: string;

  /** English meanings from the bundled dictionary, or a curated note. */
  glosses: string[];
  /** Short usage note, used for particles and auxiliaries. */
  note?: string;

  /** True when this token should be joined to the previous one in romaji. */
  attachToPrevious: boolean;
  /** Punctuation and symbols are rendered differently in the breakdown. */
  isPunctuation: boolean;
  /** JMdict marks this as a common word. */
  common?: boolean;
}

export interface Translation {
  text: string;
  /** 'ai' when produced by a model, 'gloss' for the offline literal rendering. */
  source: 'ai' | 'gloss';
  model?: string;
  /** True when served from the local cache rather than a fresh API call. */
  cached?: boolean;
}

/**
 * One entry of a model-produced breakdown — the raw shape the model returns,
 * before it is turned into a WordToken.
 *
 * As much of this as possible is carried by the output schema rather than by
 * instructions: the part of speech is an enum, the inflection is a small
 * object of enums and flags, and the pronunciation is a list of romaji words.
 * The output schema requires every key, so "not applicable" is an empty
 * string, an empty list, or the enum's "none".
 */
export interface AiWord {
  /** Text exactly as it appears in the sentence. */
  surface: string;
  /** Hiragana reading as written; empty for punctuation. */
  reading: string;
  /**
   * Katakana reading as pronounced, with ー for long vowels, one element per
   * romaji word (勉強しています → ["ベンキョー", "シテ", "イマス"]). Empty for
   * punctuation.
   */
  pronunciation: string[];
  /** Dictionary form when the surface is inflected, otherwise empty. */
  dictionaryForm: string;
  pos: AiPos;
  inflection: AiInflection;
  /** What the word means in this sentence. */
  meaning: string;
  /** Short usage note, or empty. */
  note: string;
}

/** Parts of speech the model may assign, as the schema enumerates them. */
export const AI_POS = [
  'noun',
  'pronoun',
  'number',
  'counter',
  'verb',
  'i-adjective',
  'na-adjective',
  'adverb',
  'particle',
  'auxiliary',
  'copula',
  'conjunction',
  'prefix',
  'suffix',
  'expression',
  'interjection',
  'punctuation',
  'other',
] as const;
export type AiPos = (typeof AI_POS)[number];

/** Conjugations of the main word, as the schema enumerates them. */
export const AI_FORMS = [
  'none',
  'dictionary',
  'stem',
  'te',
  'ta',
  'nai',
  'ba',
  'tara',
  'volitional',
  'imperative',
  'potential',
  'passive',
  'causative',
  'causative-passive',
  'other',
] as const;
export type AiForm = (typeof AI_FORMS)[number];

/**
 * How a word is inflected, as a set of facts rather than a phrase. The
 * learner-facing label ("Te-form + いる, polite") is built from these.
 */
export interface AiInflection {
  /** Conjugation of the main word; "none" for anything that does not conjugate. */
  form: AiForm;
  /** ます / です politeness. */
  polite: boolean;
  negative: boolean;
  past: boolean;
  /** ている / てる attached. */
  progressive: boolean;
  /** Any other auxiliary attached, in Japanese (しまう, たい, そう), or empty. */
  auxiliary: string;
}

export interface Analysis {
  /** Source text after normalisation. */
  text: string;
  /** Full-sentence romaji. */
  romaji: string;
  /** Full-sentence kana reading. */
  kana: string;
  tokens: WordToken[];
  translation?: Translation;
  /** Structure-preserving rendering, when a model produced one. */
  literalTranslation?: string;
  /** Templated notes on grammar, exceptions and readings, when a model produced them. */
  explanation?: Explanation;
  /**
   * True when the reading and breakdown came from the translation model rather
   * than the offline analyser (the "AI standard fields" option).
   */
  aiFields?: boolean;
  /** Non-fatal problems worth surfacing (dictionary missing, API failed, ...). */
  warnings: string[];
  /** Milliseconds spent analysing, for the debug readout. */
  elapsedMs?: number;
}

export interface Settings {
  romajiStyle: RomajiStyle;
  /** Show the floating button when Japanese text is selected. */
  showSelectionButton: boolean;
  /** Automatically analyse on selection without the extra click. */
  autoAnalyze: boolean;
  /** Render furigana above kanji in the breakdown. */
  showFurigana: boolean;
  /** Use a model for a natural-sounding sentence translation. */
  aiTranslation: boolean;
  /**
   * Let the model also produce the standard fields — the reading and the
   * word-by-word breakdown — in place of the offline analyser's. Off by
   * default: the offline result is free, instant, and usually right.
   */
  aiStandardFields: boolean;
  /** Which provider the AI translation uses. */
  provider: ProviderId;
  /**
   * Keys and models are stored per provider so switching back and forth does
   * not make the user re-enter anything.
   */
  anthropicApiKey: string;
  anthropicModel: string;
  openaiApiKey: string;
  openaiModel: string;
  openrouterApiKey: string;
  openrouterModel: string;
  theme: 'auto' | 'light' | 'dark';

  /** Send saved sentences to Anki over AnkiConnect. */
  ankiEnabled: boolean;
  ankiUrl: string;
  ankiDeck: string;
  ankiModel: string;
  ankiFrontField: string;
  ankiBackField: string;
  ankiTags: string;
  /** Readings above kanji on the back of the Anki card. */
  ankiFurigana: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  romajiStyle: 'macron',
  showSelectionButton: true,
  autoAnalyze: false,
  showFurigana: true,
  aiTranslation: false,
  aiStandardFields: false,
  provider: 'anthropic',
  anthropicApiKey: '',
  anthropicModel: 'claude-opus-5',
  openaiApiKey: '',
  openaiModel: 'gpt-5.4',
  openrouterApiKey: '',
  openrouterModel: 'google/gemini-3.8-flash',
  theme: 'auto',
  ankiEnabled: false,
  ankiUrl: DEFAULT_ANKI_CONFIG.url,
  ankiDeck: DEFAULT_ANKI_CONFIG.deck,
  ankiModel: DEFAULT_ANKI_CONFIG.model,
  ankiFrontField: DEFAULT_ANKI_CONFIG.frontField,
  ankiBackField: DEFAULT_ANKI_CONFIG.backField,
  ankiTags: DEFAULT_ANKI_CONFIG.tags.join(', '),
  ankiFurigana: DEFAULT_ANKI_CONFIG.furigana,
};

/** Settings -> the shape the AnkiConnect client wants. */
export function ankiConfigFor(settings: Settings): AnkiConfig {
  return {
    url: settings.ankiUrl || DEFAULT_ANKI_CONFIG.url,
    deck: settings.ankiDeck || DEFAULT_ANKI_CONFIG.deck,
    model: settings.ankiModel || DEFAULT_ANKI_CONFIG.model,
    frontField: settings.ankiFrontField || DEFAULT_ANKI_CONFIG.frontField,
    backField: settings.ankiBackField || DEFAULT_ANKI_CONFIG.backField,
    tags: settings.ankiTags
      .split(',')
      .map((tag) => tag.trim().replace(/\s+/g, '-'))
      .filter(Boolean),
    furigana: settings.ankiFurigana,
  };
}

/** Settings as they were before multi-provider support. */
interface LegacySettings {
  apiKey?: string;
  apiModel?: string;
}

/**
 * Fold a single-provider profile into the per-provider shape.
 *
 * Returns only the keys that need writing, or null when there is nothing to
 * migrate, so the caller can skip a pointless storage write.
 */
export function migrateSettings(stored: Record<string, unknown>): Partial<Settings> | null {
  const legacy = stored as LegacySettings;
  if (!legacy.apiKey && !legacy.apiModel) return null;
  // Everything before this change was Claude-only.
  const patch: Partial<Settings> = { provider: 'anthropic' };
  if (legacy.apiKey) patch.anthropicApiKey = legacy.apiKey;
  if (legacy.apiModel) patch.anthropicModel = legacy.apiModel;
  return patch;
}

type StringSetting = { [K in keyof Settings]: Settings[K] extends string ? K : never }[keyof Settings];

/** Where each provider's key and model live in settings. */
const CREDENTIAL_KEYS: Record<ProviderId, { apiKey: StringSetting; model: StringSetting }> = {
  anthropic: { apiKey: 'anthropicApiKey', model: 'anthropicModel' },
  openai: { apiKey: 'openaiApiKey', model: 'openaiModel' },
  openrouter: { apiKey: 'openrouterApiKey', model: 'openrouterModel' },
};

/** Every setting that holds an API key, for redaction and change detection. */
export const API_KEY_SETTINGS: StringSetting[] = PROVIDER_IDS.map((id) => CREDENTIAL_KEYS[id].apiKey);

/** The key and model for a provider, defaulting to the selected one. */
export function credentialsFor(
  settings: Settings,
  provider: ProviderId = settings.provider,
): { apiKey: string; model: string } {
  const keys = CREDENTIAL_KEYS[provider] ?? CREDENTIAL_KEYS.anthropic;
  return { apiKey: settings[keys.apiKey], model: settings[keys.model] };
}

/** The settings patch that stores a key and model for a provider. */
export function credentialsPatch(
  provider: ProviderId,
  credentials: { apiKey: string; model: string },
): Partial<Settings> {
  const keys = CREDENTIAL_KEYS[provider];
  return { [keys.apiKey]: credentials.apiKey, [keys.model]: credentials.model };
}

/** A provider the user has actually configured a key for. */
export interface AvailableProvider {
  id: ProviderId;
  label: string;
  model: string;
}

/**
 * Providers that can serve a request right now.
 *
 * Drives the regenerate dropdown, which must only offer providers the user has
 * a key for — anything else would just produce an error on click.
 */
export function availableProviders(settings: Settings): AvailableProvider[] {
  return PROVIDER_IDS.filter((id) => credentialsFor(settings, id).apiKey.trim()).map((id) => ({
    id,
    label: PROVIDERS[id].label,
    model: credentialsFor(settings, id).model,
  }));
}

/* ---------- Messaging contract between content script and background ---------- */

/** One exchange in the "ask about this sentence" thread. */
export interface AskTurn {
  question: string;
  answer: string;
}

export type RequestMessage =
  | { type: 'analyze'; text: string; requestId: string }
  | { type: 'getSettings' }
  | { type: 'setSettings'; settings: Partial<Settings> }
  | { type: 'ping' };

export type ResponseMessage =
  | { ok: true; analysis: Analysis }
  | { ok: true; settings: Settings }
  | { ok: true }
  | { ok: false; error: string };
