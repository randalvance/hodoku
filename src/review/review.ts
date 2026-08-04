/**
 * The saved-items page: browse, search, study, export.
 *
 * Saved records hold only what the panel displayed. The full word breakdown is
 * re-derived through the background analyser when an item is expanded, so the
 * store stays small and old items benefit from analyser improvements.
 */

import {
  clearSaved,
  listSaved,
  recordReview,
  removeSaved,
  studyOrder,
  toJson,
  toTsv,
  type SavedItem,
} from '../lib/saved';
import { DEFAULT_SETTINGS, type Analysis, type Settings } from '../lib/types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let items: SavedItem[] = [];
let settings: Settings = { ...DEFAULT_SETTINGS };
/** Breakdowns already fetched, keyed by item id. */
const breakdowns = new Map<string, Analysis>();

void init();

async function init(): Promise<void> {
  $('search').addEventListener('input', render);
  $('sort').addEventListener('change', render);
  $('study').addEventListener('click', () => void startStudy());
  $('export-tsv').addEventListener('click', () =>
    download('hodoku-saved.tsv', toTsv(visibleItems()), 'text/tab-separated-values'),
  );
  $('export-json').addEventListener('click', () =>
    download('hodoku-saved.json', toJson(visibleItems()), 'application/json'),
  );
  $('clear').addEventListener('click', () => void clearAll());
  $('anki-send').addEventListener('click', () => void sendToAnki());

  settings = await getSettings();
  $('anki-send').classList.toggle('hidden', !settings.ankiEnabled);

  await reload();
}

async function reload(): Promise<void> {
  items = await listSaved();
  render();
}

function visibleItems(): SavedItem[] {
  const query = $<HTMLInputElement>('search').value.trim().toLowerCase();
  const sort = $<HTMLSelectElement>('sort').value;

  let result = items;
  if (query) {
    result = result.filter((item) =>
      [item.text, item.romaji, item.kana, item.translation, item.title]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query)),
    );
  }

  if (sort === 'oldest') return result.slice().sort((a, b) => a.savedAt - b.savedAt);
  if (sort === 'least') return studyOrder(result);
  return result.slice().sort((a, b) => b.savedAt - a.savedAt);
}

async function getSettings(): Promise<Settings> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'getSettings' })) as {
      ok: boolean;
      settings?: Settings;
    };
    if (response?.ok && response.settings) return response.settings;
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * Push everything currently listed that has not already reached Anki.
 *
 * Anki itself rejects duplicates, but tracking `ankiNoteId` means the button
 * reports honestly rather than claiming to have added cards that were refused.
 */
async function sendToAnki(): Promise<void> {
  const status = $('anki-status');
  const pending = visibleItems().filter((item) => !item.ankiNoteId);

  status.classList.remove('hidden');
  if (!pending.length) {
    status.textContent = 'Everything listed is already in Anki.';
    return;
  }

  status.textContent = `Sending ${pending.length} to Anki…`;
  const button = $<HTMLButtonElement>('anki-send');
  button.disabled = true;

  try {
    const response = (await chrome.runtime.sendMessage({ type: 'ankiSend', items: pending })) as
      | { ok: true; added: number; skipped: number }
      | { ok: false; error: string };

    if (!response?.ok) {
      status.textContent = response?.error ?? 'Sending to Anki failed.';
      return;
    }
    const parts = [`Added ${response.added} card${response.added === 1 ? '' : 's'} to Anki`];
    if (response.skipped) parts.push(`${response.skipped} already existed`);
    status.textContent = `${parts.join(' · ')}.`;
    await reload();
  } finally {
    button.disabled = false;
  }
}

/* --------------------------------- list ---------------------------------- */

function render(): void {
  const list = $('list');
  const shown = visibleItems();

  $('summary').textContent = items.length
    ? `${items.length} saved${shown.length !== items.length ? ` · ${shown.length} matching` : ''}`
    : 'Nothing saved yet';
  $<HTMLButtonElement>('study').disabled = items.length === 0;
  $('toolbar').classList.toggle('hidden', items.length === 0);

  list.textContent = '';

  if (!shown.length) {
    list.appendChild(emptyState(items.length > 0));
    return;
  }

  for (const item of shown) list.appendChild(renderItem(item));
}

function emptyState(filtered: boolean): HTMLElement {
  const empty = el('div', 'empty');
  const title = document.createElement('strong');
  title.textContent = filtered ? 'No matches' : 'Nothing saved yet';
  empty.appendChild(title);
  const body = document.createElement('span');
  body.textContent = filtered
    ? 'Try a different search.'
    : 'Highlight Japanese on any page, open the panel, and click the bookmark to save it here.';
  empty.appendChild(body);
  return empty;
}

function renderItem(item: SavedItem): HTMLElement {
  const node = el('div', 'item');

  const head = el('div', 'item__head');
  const main = el('div', 'item__ja');
  main.lang = 'ja';
  main.textContent = item.text;

  const romaji = el('div', 'item__romaji');
  romaji.textContent = item.romaji;
  main.appendChild(romaji);

  if (item.kana && item.kana !== item.text) {
    const kana = el('div', 'item__kana');
    kana.lang = 'ja';
    kana.textContent = item.kana;
    main.appendChild(kana);
  }

  // The whole snapshot as it was captured, not just the headline translation.
  if (item.translation) {
    const isGloss = item.translationSource !== 'ai';
    const meaning = el('div', isGloss ? 'item__meaning item__meaning--gloss' : 'item__meaning');
    meaning.textContent = item.translation;
    main.appendChild(meaning);
  }

  if (item.literal) {
    const literal = el('div', 'item__literal');
    literal.textContent = item.literal;
    main.appendChild(literal);
  }

  if (item.note) {
    const note = el('div', 'item__note');
    note.textContent = item.note;
    main.appendChild(note);
  }

  main.appendChild(renderMeta(item));
  head.appendChild(main);

  const actions = el('div', 'item__actions');

  const expand = iconButton('▾', 'Show the word breakdown');
  const detail = el('div', 'item__detail');
  detail.classList.add('hidden');
  expand.addEventListener('click', () => void toggleDetail(item, detail, expand));
  actions.appendChild(expand);

  const remove = iconButton('✕', 'Remove from saved');
  remove.addEventListener('click', () => void removeItem(item.id));
  actions.appendChild(remove);

  head.appendChild(actions);
  node.appendChild(head);
  node.appendChild(detail);
  return node;
}

function renderMeta(item: SavedItem): HTMLElement {
  const meta = el('div', 'item__meta');

  const saved = document.createElement('span');
  saved.textContent = `Saved ${formatDate(item.savedAt)}`;
  meta.appendChild(saved);

  if (item.translationSource === 'ai' && item.translationModel) {
    const model = document.createElement('span');
    model.textContent = item.translationModel;
    model.title = 'The model that produced this translation';
    meta.appendChild(model);
  }

  if (item.ankiNoteId) {
    const anki = document.createElement('span');
    anki.textContent = 'In Anki';
    anki.title = `Anki note ${item.ankiNoteId}`;
    meta.appendChild(anki);
  }

  if (item.reviewCount > 0) {
    const reviewed = document.createElement('span');
    reviewed.textContent = `Reviewed ${item.reviewCount}×`;
    meta.appendChild(reviewed);
  }

  if (item.url) {
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener';
    // Page titles can be long; the host is enough to recognise the source.
    link.textContent = item.title?.slice(0, 60) || safeHost(item.url);
    meta.appendChild(link);
  }

  return meta;
}

async function toggleDetail(
  item: SavedItem,
  detail: HTMLElement,
  button: HTMLButtonElement,
): Promise<void> {
  const opening = detail.classList.contains('hidden');
  detail.classList.toggle('hidden', !opening);
  button.textContent = opening ? '▴' : '▾';
  if (!opening) return;

  const cached = breakdowns.get(item.id);
  if (cached) {
    renderBreakdown(detail, cached);
    return;
  }

  detail.textContent = 'Loading breakdown…';
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'analyze',
      text: item.text,
      requestId: `review-${item.id}`,
    })) as { ok: true; analysis: Analysis } | { ok: false; error: string };
    if (!response?.ok) throw new Error(response?.error ?? 'No response');
    breakdowns.set(item.id, response.analysis);
    renderBreakdown(detail, response.analysis);
  } catch (err) {
    detail.textContent = err instanceof Error ? err.message : String(err);
  }
}

function renderBreakdown(detail: HTMLElement, analysis: Analysis): void {
  detail.textContent = '';
  for (const token of analysis.tokens) {
    if (token.isPunctuation) continue;
    const row = el('div', 'breakdown-row');

    const ja = el('div', 'ja');
    ja.lang = 'ja';
    for (const segment of token.furigana) {
      if (segment.ruby) {
        const ruby = document.createElement('ruby');
        ruby.appendChild(document.createTextNode(segment.text));
        const rt = document.createElement('rt');
        rt.textContent = segment.ruby;
        ruby.appendChild(rt);
        ja.appendChild(ruby);
      } else {
        ja.appendChild(document.createTextNode(segment.text));
      }
    }
    row.appendChild(ja);

    const info = document.createElement('div');
    const ro = el('div', 'ro');
    ro.textContent = token.romaji;
    info.appendChild(ro);

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = token.posDetail ?? token.pos;
    info.appendChild(tag);

    if (token.dictionaryForm) {
      const dict = document.createElement('span');
      dict.className = 'tag';
      dict.lang = 'ja';
      dict.textContent = `from ${token.dictionaryForm}`;
      info.appendChild(dict);
    }

    if (token.glosses.length) {
      const gloss = el('div', 'gl');
      gloss.textContent = token.glosses.slice(0, 4).join('; ');
      info.appendChild(gloss);
    }

    row.appendChild(info);
    detail.appendChild(row);
  }
}

async function removeItem(id: string): Promise<void> {
  await removeSaved(id);
  breakdowns.delete(id);
  await reload();
}

async function clearAll(): Promise<void> {
  if (!items.length) return;
  if (!confirm(`Remove all ${items.length} saved items? This cannot be undone.`)) return;
  await clearSaved();
  breakdowns.clear();
  await reload();
}

/* --------------------------------- study --------------------------------- */

let queue: SavedItem[] = [];
let position = 0;

async function startStudy(): Promise<void> {
  queue = studyOrder(visibleItems());
  position = 0;
  if (!queue.length) return;
  $('list').classList.add('hidden');
  $('toolbar').classList.add('hidden');
  $('study-view').classList.remove('hidden');
  $<HTMLButtonElement>('study').textContent = 'Back to list';
  $('study').onclick = () => endStudy();
  renderCard();
}

function endStudy(): void {
  $('study-view').classList.add('hidden');
  $('list').classList.remove('hidden');
  $('toolbar').classList.remove('hidden');
  const button = $<HTMLButtonElement>('study');
  button.textContent = 'Study';
  button.onclick = () => void startStudy();
  void reload();
}

function renderCard(): void {
  const view = $('study-view');
  view.textContent = '';

  if (position >= queue.length) {
    const done = el('div', 'study__done');
    const title = document.createElement('strong');
    title.textContent = 'Done';
    done.appendChild(title);
    const body = el('p', 'muted');
    body.textContent = `You went through ${queue.length} item${queue.length === 1 ? '' : 's'}.`;
    done.appendChild(body);
    const back = document.createElement('button');
    back.className = 'primary';
    back.textContent = 'Back to list';
    back.style.marginTop = '14px';
    back.addEventListener('click', endStudy);
    done.appendChild(back);
    view.appendChild(done);
    return;
  }

  const item = queue[position];
  const card = el('div', 'study');

  const progress = el('div', 'study__progress');
  progress.textContent = `${position + 1} of ${queue.length}`;
  card.appendChild(progress);

  const ja = el('div', 'study__ja');
  ja.lang = 'ja';
  ja.textContent = item.text;
  card.appendChild(ja);

  const reveal = document.createElement('button');
  reveal.className = 'primary';
  reveal.textContent = 'Show reading and meaning';
  card.appendChild(reveal);

  reveal.addEventListener('click', () => {
    reveal.remove();
    card.appendChild(renderAnswer(item));
  });

  view.appendChild(card);
}

function renderAnswer(item: SavedItem): HTMLElement {
  const answer = el('div', 'study__answer');

  const romaji = el('div', 'study__romaji');
  romaji.textContent = item.romaji;
  answer.appendChild(romaji);

  if (item.kana && item.kana !== item.text) {
    const kana = el('div', 'study__kana');
    kana.lang = 'ja';
    kana.textContent = item.kana;
    answer.appendChild(kana);
  }

  if (item.translation) {
    const meaning = el('div', 'study__meaning');
    meaning.textContent = item.translation;
    answer.appendChild(meaning);
  }

  const buttons = el('div', 'study__buttons');

  const again = document.createElement('button');
  again.textContent = 'Again';
  again.title = 'Resets this item so it comes back first next time';
  again.addEventListener('click', () => void advance(item, false));
  buttons.appendChild(again);

  const got = document.createElement('button');
  got.className = 'primary';
  got.textContent = 'Got it';
  got.addEventListener('click', () => void advance(item, true));
  buttons.appendChild(got);

  answer.appendChild(buttons);
  return answer;
}

async function advance(item: SavedItem, remembered: boolean): Promise<void> {
  await recordReview(item.id, remembered);
  position++;
  renderCard();
}

/* -------------------------------- helpers -------------------------------- */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function iconButton(glyph: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-btn';
  button.textContent = glyph;
  button.title = title;
  button.setAttribute('aria-label', title);
  return button;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function download(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
