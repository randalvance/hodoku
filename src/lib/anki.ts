/**
 * Client for AnkiConnect — the local HTTP API the AnkiConnect add-on exposes
 * from a running Anki desktop.
 *
 * This is why the extension can offer real spaced repetition without a server:
 * cards go straight into the user's own Anki collection over loopback, and
 * Anki's own sync carries them to their other devices. Nothing leaves the
 * machine.
 *
 * Protocol: POST a {action, version, params} envelope; the reply is always
 * HTTP 200 with {result, error}, so failures have to be read out of the body
 * rather than the status code.
 */

import type { SavedItem } from './saved';
import type { FuriganaSegment } from './types';

export const ANKI_DEFAULT_URL = 'http://127.0.0.1:8765';

/**
 * Loopback only. Ports are allowed in match patterns, but pinning 8765 would
 * strand anyone running AnkiConnect on a custom port, and the security
 * difference across loopback ports is negligible.
 */
export const ANKI_ORIGINS = ['http://127.0.0.1/*', 'http://localhost/*'];

/** The API version this client speaks. */
const ANKI_VERSION = 6;

export interface AnkiConfig {
  url: string;
  deck: string;
  model: string;
  frontField: string;
  backField: string;
  tags: string[];
  /** Put readings above the kanji on the back of the card. */
  furigana: boolean;
}

export const DEFAULT_ANKI_CONFIG: AnkiConfig = {
  url: ANKI_DEFAULT_URL,
  deck: 'Hodoku',
  model: 'Basic',
  frontField: 'Front',
  backField: 'Back',
  tags: ['hodoku'],
  furigana: true,
};

interface Envelope<T> {
  result: T | null;
  error: string | null;
}

/** Raised for problems the user can act on, with wording that says how. */
export class AnkiError extends Error {}

export async function invoke<T>(
  url: string,
  action: string,
  params: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: ANKI_VERSION, params }),
      signal,
    });
  } catch {
    throw new AnkiError(
      'Could not reach Anki. Check that Anki is running and the AnkiConnect add-on is installed.',
    );
  }

  if (response.status === 403) {
    // AnkiConnect checks the Origin header against its webCorsOriginList and
    // refuses anything not listed.
    throw new AnkiError(
      'Anki refused the connection. Add this extension to AnkiConnect’s webCorsOriginList — the options page shows the exact value to paste.',
    );
  }
  if (!response.ok) {
    throw new AnkiError(`Anki returned HTTP ${response.status}.`);
  }

  let envelope: Envelope<T>;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    throw new AnkiError('Anki sent a response this extension could not read.');
  }

  if (envelope.error) throw new AnkiError(`Anki: ${envelope.error}`);
  return envelope.result as T;
}

/* ------------------------------- discovery -------------------------------- */

export async function getVersion(url: string, signal?: AbortSignal): Promise<number> {
  return invoke<number>(url, 'version', {}, signal);
}

export async function listDecks(url: string, signal?: AbortSignal): Promise<string[]> {
  return invoke<string[]>(url, 'deckNames', {}, signal);
}

export async function listModels(url: string, signal?: AbortSignal): Promise<string[]> {
  return invoke<string[]>(url, 'modelNames', {}, signal);
}

export async function listModelFields(
  url: string,
  modelName: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return invoke<string[]>(url, 'modelFieldNames', { modelName }, signal);
}

export async function createDeck(url: string, deck: string, signal?: AbortSignal): Promise<void> {
  // Idempotent in AnkiConnect: an existing deck is returned, not an error.
  await invoke<number>(url, 'createDeck', { deck }, signal);
}

/* --------------------------------- notes ---------------------------------- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Anki fields hold HTML, so everything user-supplied has to be escaped. */
export function buildBack(item: SavedItem, furigana?: FuriganaSegment[]): string {
  const lines: string[] = [];

  // The annotated sentence leads, so the answer side reads top to bottom:
  // what it says, how it sounds, what it means.
  if (hasReadings(furigana)) {
    lines.push(
      `<div lang="ja" style="font-size:1.35em;line-height:2">${furiganaHtml(furigana)}</div>`,
    );
  }

  lines.push(`<div><b>${escapeHtml(item.romaji)}</b></div>`);

  // A plain kana line is redundant once the readings sit above the kanji.
  if (!hasReadings(furigana) && item.kana && item.kana !== item.text) {
    lines.push(`<div>${escapeHtml(item.kana)}</div>`);
  }
  if (item.translation) {
    lines.push(`<div style="margin-top:8px">${escapeHtml(item.translation)}</div>`);
  }
  if (item.literal) {
    lines.push(
      `<div style="margin-top:6px;opacity:.75;font-size:.9em">${escapeHtml(item.literal)}</div>`,
    );
  }
  if (item.note) {
    lines.push(
      `<div style="margin-top:6px;opacity:.75;font-size:.9em">${escapeHtml(item.note)}</div>`,
    );
  }
  // Provenance, so a card carries a record of where its meaning came from.
  const footer: string[] = [];
  if (item.url) {
    // href is escaped too; a saved URL is attacker-influenced in principle.
    footer.push(
      `<a href="${escapeHtml(item.url)}">${escapeHtml(item.title || item.url)}</a>`,
    );
  }
  if (item.translationSource === 'ai' && item.translationModel) {
    footer.push(escapeHtml(item.translationModel));
  }
  if (footer.length) {
    lines.push(
      `<div style="margin-top:8px;font-size:.8em;opacity:.7">${footer.join(' · ')}</div>`,
    );
  }
  return lines.join('\n');
}

/**
 * Render kanji-to-kana alignment as ruby.
 *
 * Anki fields hold HTML and every Anki client is webview-based, so <ruby>
 * displays as real furigana on the stock note types — no card-template change
 * and no add-on. (Anki's own ` 漢字[かんじ]` bracket notation is the ecosystem
 * convention, but it only becomes ruby if the template calls {{furigana:…}},
 * and shows literal brackets otherwise.)
 */
export function furiganaHtml(segments: FuriganaSegment[]): string {
  return segments
    .map((segment) =>
      segment.ruby
        ? `<ruby>${escapeHtml(segment.text)}<rt>${escapeHtml(segment.ruby)}</rt></ruby>`
        : escapeHtml(segment.text),
    )
    .join('');
}

/** True when at least one segment actually carries a reading. */
function hasReadings(segments: FuriganaSegment[] | undefined): segments is FuriganaSegment[] {
  return Boolean(segments?.some((segment) => segment.ruby));
}

export interface AnkiNote {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  options: { allowDuplicate: boolean; duplicateScope: string };
  tags: string[];
}

export function buildNote(
  item: SavedItem,
  config: AnkiConfig,
  furigana?: FuriganaSegment[],
): AnkiNote {
  return {
    deckName: config.deck,
    modelName: config.model,
    fields: {
      // The front stays plain: readings there would give the answer away.
      [config.frontField]: escapeHtml(item.text),
      [config.backField]: buildBack(item, config.furigana ? furigana : undefined),
    },
    // Let Anki reject duplicates rather than creating a second copy of a card
    // the user already has.
    options: { allowDuplicate: false, duplicateScope: 'deck' },
    tags: config.tags,
  };
}

export interface SendResult {
  added: number;
  /** Notes Anki declined, almost always because the card already exists. */
  skipped: number;
  /** Note ids, aligned with the input order; null where nothing was added. */
  noteIds: Array<number | null>;
}

/**
 * Push items into Anki, creating the deck first if it does not exist.
 *
 * `addNotes` returns one entry per note — an id on success, null when Anki
 * refused it — so a partial success is normal and reported rather than thrown.
 */
export async function sendToAnki(
  items: SavedItem[],
  config: AnkiConfig,
  signal?: AbortSignal,
  /** Per-item kanji alignment, keyed by item id. Missing entries just lose ruby. */
  furiganaById?: Map<string, FuriganaSegment[]>,
): Promise<SendResult> {
  if (!items.length) return { added: 0, skipped: 0, noteIds: [] };

  await createDeck(config.url, config.deck, signal);

  const notes = items.map((item) => buildNote(item, config, furiganaById?.get(item.id)));
  const noteIds = await invoke<Array<number | null>>(config.url, 'addNotes', { notes }, signal);

  const added = noteIds.filter((id) => id !== null).length;
  return { added, skipped: noteIds.length - added, noteIds };
}
