/**
 * Persistent cache for model translations.
 *
 * A translation is a pure function of (text, provider, model), so there is no
 * reason to pay for the same sentence twice — and re-reading a page, or
 * re-opening something saved for review, hits the same text constantly.
 *
 * It lives in chrome.storage.local rather than memory because the MV3 service
 * worker is torn down whenever it goes idle, which would throw away an
 * in-memory cache within seconds.
 */

const STORAGE_KEY = 'translationCache';

/**
 * Entries are small (a few hundred bytes), so this cap is about keeping reads
 * and writes of the whole map cheap, not about the 10 MB storage quota.
 */
export const MAX_ENTRIES = 500;

export interface CacheEntry {
  /** The exact text this translation was produced for. */
  text: string;
  provider: string;
  model: string;
  translation: string;
  literal?: string;
  note?: string;
  createdAt: number;
  lastUsedAt: number;
  hits: number;
}

type CacheMap = Record<string, CacheEntry>;

/**
 * FNV-1a. Keys are hashed rather than stored verbatim because the raw text can
 * be 400 characters, and the map is read and written whole.
 */
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function cacheKey(text: string, provider: string, model: string): string {
  // Provider and model are part of the key: switching either should produce a
  // fresh translation rather than silently reusing the other one's output.
  return `${provider}:${model}:${hash(text)}`;
}

async function readAll(): Promise<CacheMap> {
  const stored = (await chrome.storage.local.get(STORAGE_KEY)) as {
    translationCache?: CacheMap;
  };
  return stored.translationCache ?? {};
}

async function writeAll(cache: CacheMap): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: cache });
}

/**
 * Look up a cached translation.
 *
 * The stored text is compared against the request because the key is a hash:
 * a collision must miss rather than return someone else's sentence.
 */
export async function getCached(
  text: string,
  provider: string,
  model: string,
): Promise<CacheEntry | undefined> {
  const cache = await readAll();
  const entry = cache[cacheKey(text, provider, model)];
  if (!entry || entry.text !== text) return undefined;

  entry.lastUsedAt = Date.now();
  entry.hits += 1;
  await writeAll(cache);
  return entry;
}

export interface CacheValue {
  translation: string;
  literal?: string;
  note?: string;
}

export async function putCached(
  text: string,
  provider: string,
  model: string,
  value: CacheValue,
): Promise<void> {
  const cache = await readAll();
  const now = Date.now();

  cache[cacheKey(text, provider, model)] = {
    text,
    provider,
    model,
    translation: value.translation,
    literal: value.literal,
    note: value.note,
    createdAt: now,
    lastUsedAt: now,
    hits: 0,
  };

  evict(cache);
  await writeAll(cache);
}

/** Drop the least recently used entries once the map is over the cap. */
function evict(cache: CacheMap): void {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_ENTRIES) return;

  const byAge = keys.sort((a, b) => cache[a].lastUsedAt - cache[b].lastUsedAt);
  for (const key of byAge.slice(0, keys.length - MAX_ENTRIES)) delete cache[key];
}

export interface CacheStats {
  entries: number;
  hits: number;
  /** Approximate size of the serialised cache. */
  bytes: number;
}

export async function cacheStats(): Promise<CacheStats> {
  const cache = await readAll();
  const values = Object.values(cache);
  return {
    entries: values.length,
    hits: values.reduce((sum, entry) => sum + entry.hits, 0),
    bytes: JSON.stringify(cache).length,
  };
}

export async function clearCache(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}
