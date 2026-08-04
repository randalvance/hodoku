/**
 * Storage for sentences the user saves to review later.
 *
 * Records are deliberately compact: the source text plus what the panel showed,
 * not the full token breakdown. The breakdown is re-derived on demand when an
 * item is opened, which keeps the store small enough to live in
 * chrome.storage.local without an unlimitedStorage permission, and means
 * improvements to the analyser apply retroactively to everything already saved.
 */

import type { Analysis } from './types';

const STORAGE_KEY = 'savedItems';

/**
 * chrome.storage.local allows ~10 MB. Records run well under 1 KB, so this cap
 * exists to keep the review page responsive rather than to stay under quota.
 */
export const MAX_ITEMS = 2000;

export interface SavedItem {
  id: string;
  /** The Japanese exactly as it was selected. */
  text: string;
  romaji: string;
  kana: string;
  /** Whatever the Meaning section showed at save time. */
  translation?: string;
  translationSource?: 'ai' | 'gloss';
  /** Which model produced it, when the snapshot came from one. */
  translationModel?: string;
  literal?: string;
  note?: string;
  /** Where it was found, for context when reviewing. */
  url?: string;
  title?: string;
  savedAt: number;
  /** Times the item has been through study mode. */
  reviewCount: number;
  lastReviewedAt?: number;
  /** Set once the item has been pushed into Anki, so it is not sent twice. */
  ankiNoteId?: number;
  ankiSyncedAt?: number;
}

/** Context the content script attaches when saving. */
export interface SaveSource {
  url?: string;
  title?: string;
}

/** Two selections of the same text are the same item, however it was reached. */
function dedupeKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function newId(): string {
  // randomUUID needs a secure context; extension pages and workers qualify.
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.floor(performance.now())}`;
}

export async function listSaved(): Promise<SavedItem[]> {
  const stored = (await chrome.storage.local.get(STORAGE_KEY)) as { savedItems?: SavedItem[] };
  const items = stored.savedItems ?? [];
  return items.slice().sort((a, b) => b.savedAt - a.savedAt);
}

async function writeAll(items: SavedItem[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: items.slice(0, MAX_ITEMS) });
}

/** The parts of a record that always reflect the latest analysis. */
function baseFields(analysis: Analysis, source: SaveSource) {
  return {
    text: analysis.text,
    romaji: analysis.romaji,
    kana: analysis.kana,
    url: source.url,
    title: source.title,
  };
}

/** The meaning as it stood when the sentence was saved. */
export interface TranslationSnapshot {
  translation?: string;
  translationSource?: 'ai' | 'gloss';
  translationModel?: string;
  literal?: string;
  note?: string;
}

function translationSnapshot(analysis: Analysis): TranslationSnapshot {
  return {
    translation: analysis.translation?.text,
    translationSource: analysis.translation?.source,
    translationModel: analysis.translation?.model,
    literal: analysis.literalTranslation,
    note: analysis.grammarNote,
  };
}

/**
 * A model translation is never replaced by a word-by-word gloss.
 *
 * Re-saving a sentence while AI translation is off — or after the API failed —
 * would otherwise quietly destroy a snapshot the user had already paid for.
 * An AI result always wins; gloss only overwrites gloss.
 */
function shouldReplaceTranslation(
  existing: TranslationSnapshot,
  incoming: TranslationSnapshot,
): boolean {
  if (!incoming.translation) return false;
  if (incoming.translationSource === 'ai') return true;
  return existing.translationSource !== 'ai';
}

export function toSavedItem(
  analysis: Analysis,
  source: SaveSource = {},
): Omit<SavedItem, 'id' | 'savedAt' | 'reviewCount'> {
  return { ...baseFields(analysis, source), ...translationSnapshot(analysis) };
}

export interface SaveResult {
  item: SavedItem;
  /** False when an existing entry for the same text was refreshed instead. */
  created: boolean;
  total: number;
}

/**
 * Save a sentence, or refresh the existing entry for the same text.
 *
 * Re-saving keeps the original `savedAt` and review history — the user is
 * updating a card they already have, not starting over.
 */
export async function saveAnalysis(analysis: Analysis, source: SaveSource = {}): Promise<SaveResult> {
  const items = await listSaved();
  const key = dedupeKey(analysis.text);
  const existing = items.find((item) => dedupeKey(item.text) === key);
  const fields = toSavedItem(analysis, source);

  if (existing) {
    // Readings and source always refresh; the meaning only if it is not a
    // downgrade of what is already stored.
    Object.assign(existing, baseFields(analysis, source));
    const incoming = translationSnapshot(analysis);
    if (shouldReplaceTranslation(existing, incoming)) Object.assign(existing, incoming);
    await writeAll(items);
    return { item: existing, created: false, total: items.length };
  }

  const item: SavedItem = { id: newId(), savedAt: Date.now(), reviewCount: 0, ...fields };
  const next = [item, ...items];
  await writeAll(next);
  return { item, created: true, total: Math.min(next.length, MAX_ITEMS) };
}

/**
 * Replace the stored meaning for a sentence, if it is saved.
 *
 * Used after a regenerate so the saved card reflects the translation the user
 * just asked for. Subject to the same no-downgrade rule as saving.
 */
export async function updateTranslation(
  text: string,
  snapshot: TranslationSnapshot,
): Promise<SavedItem | undefined> {
  const items = await listSaved();
  const key = dedupeKey(text);
  const item = items.find((entry) => dedupeKey(entry.text) === key);
  if (!item) return undefined;
  if (!shouldReplaceTranslation(item, snapshot)) return item;

  Object.assign(item, snapshot);
  await writeAll(items);
  return item;
}

export async function removeSaved(id: string): Promise<number> {
  const items = await listSaved();
  const next = items.filter((item) => item.id !== id);
  await writeAll(next);
  return next.length;
}

export async function clearSaved(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

/** Is this exact text already saved? Drives the panel's save-button state. */
export async function findSavedByText(text: string): Promise<SavedItem | undefined> {
  const key = dedupeKey(text);
  return (await listSaved()).find((item) => dedupeKey(item.text) === key);
}

/** Record which items reached Anki, so the review page can skip them next time. */
export async function markSynced(ids: Array<{ id: string; noteId: number }>): Promise<void> {
  if (!ids.length) return;
  const items = await listSaved();
  const byId = new Map(ids.map((entry) => [entry.id, entry.noteId]));
  for (const item of items) {
    const noteId = byId.get(item.id);
    if (noteId === undefined) continue;
    item.ankiNoteId = noteId;
    item.ankiSyncedAt = Date.now();
  }
  await writeAll(items);
}

export async function recordReview(id: string, remembered: boolean): Promise<void> {
  const items = await listSaved();
  const item = items.find((entry) => entry.id === id);
  if (!item) return;
  item.reviewCount = remembered ? item.reviewCount + 1 : 0;
  item.lastReviewedAt = Date.now();
  await writeAll(items);
}

/**
 * Order for study mode: never-reviewed first, then longest-since-reviewed.
 *
 * Deliberately not a spaced-repetition schedule — this is a review list, and
 * pretending to be Anki would mean inventing intervals the user did not ask for.
 */
export function studyOrder(items: SavedItem[]): SavedItem[] {
  return items.slice().sort((a, b) => {
    if (a.reviewCount !== b.reviewCount) return a.reviewCount - b.reviewCount;
    return (a.lastReviewedAt ?? 0) - (b.lastReviewedAt ?? 0);
  });
}

/* --------------------------------- export --------------------------------- */

function escapeTsv(value: string | undefined): string {
  // Anki reads tab-separated files; tabs and newlines inside a field break it.
  return (value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

/** Tab-separated, which is what Anki's importer expects by default. */
export function toTsv(items: SavedItem[]): string {
  const header = ['Japanese', 'Reading', 'Romaji', 'Meaning', 'Notes', 'Source'];
  const rows = items.map((item) =>
    [
      escapeTsv(item.text),
      escapeTsv(item.kana),
      escapeTsv(item.romaji),
      escapeTsv(item.translation),
      escapeTsv([item.literal, item.note].filter(Boolean).join(' — ')),
      escapeTsv(item.url),
    ].join('\t'),
  );
  return [header.join('\t'), ...rows].join('\n');
}

export function toJson(items: SavedItem[]): string {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), count: items.length, items },
    null,
    2,
  );
}
