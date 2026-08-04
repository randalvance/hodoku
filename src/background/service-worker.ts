/**
 * Coordinates the extension: owns settings, keeps the offscreen analyser
 * alive, and adds the optional model translation on top of the offline result.
 */

import {
  DEFAULT_SETTINGS,
  ankiConfigFor,
  availableProviders,
  credentialsFor,
  migrateSettings,
  type Analysis,
  type FuriganaSegment,
  type ProviderId,
  type Settings,
} from '../lib/types';
import type { OffscreenRequest, OffscreenResponse } from '../offscreen/offscreen';
import { getProvider, glossTranslation, translateSentence } from '../lib/translate';
import {
  cacheStats,
  clearCache,
  getCached,
  putCached,
  type CacheValue,
} from '../lib/translation-cache';
import {
  findSavedByText,
  listSaved,
  markSynced,
  removeSaved,
  saveAnalysis,
  updateTranslation,
  type SavedItem,
  type SaveSource,
} from '../lib/saved';
import {
  ANKI_ORIGINS,
  AnkiError,
  getVersion,
  listDecks,
  listModelFields,
  listModels,
  sendToAnki,
} from '../lib/anki';

const OFFSCREEN_PATH = 'offscreen/offscreen.html';
const REVIEW_PATH = 'review/review.html';
const CONTEXT_MENU_ID = 'hodoku-analyze';
const SAVE_MENU_ID = 'hodoku-save';

/* ------------------------------- settings -------------------------------- */

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(null);
  // A profile saved before multi-provider support keeps its key and model.
  const migration = migrateSettings(stored);
  if (migration) {
    await chrome.storage.local.set(migration);
    await chrome.storage.local.remove(['apiKey', 'apiModel']);
    Object.assign(stored, migration);
  }
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  await chrome.storage.local.set(patch);
  return getSettings();
}

/* ---------------------------- offscreen host ----------------------------- */

let creatingOffscreen: Promise<void> | null = null;

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  // Concurrent lookups can both miss the check above; createDocument throws if
  // a second call arrives while the first is still in flight.
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['WORKERS' as chrome.offscreen.Reason],
      justification:
        'Runs the Japanese morphological analyser in a Web Worker so the loaded dictionaries stay in memory between lookups.',
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

async function askOffscreen(request: OffscreenRequest): Promise<OffscreenResponse> {
  await ensureOffscreenDocument();
  return (await chrome.runtime.sendMessage(request)) as OffscreenResponse;
}

/* ------------------------------- analysis -------------------------------- */

/** Requests currently in flight, so a new selection cancels the previous one. */
const inFlight = new Map<string, AbortController>();

/** Translations in flight, keyed by provider+model+text, to collapse duplicates. */
const pendingTranslations = new Map<string, Promise<{ translation: { text: string }; literal?: string; note?: string }>>();

/** Attach a translation to an analysis, however it was obtained. */
function applyTranslation(
  analysis: Analysis,
  model: string,
  value: CacheValue,
  fromCache: boolean,
): void {
  analysis.translation = { text: value.translation, source: 'ai', model, cached: fromCache };
  if (value.literal) analysis.literalTranslation = value.literal;
  if (value.note) analysis.grammarNote = value.note;
}

async function analyze(text: string, requestId: string): Promise<Analysis> {
  const settings = await getSettings();

  const response = await askOffscreen({
    target: 'offscreen',
    type: 'analyze',
    text,
    style: settings.romajiStyle,
  });

  if (!response.ok) throw new Error(response.error);
  if (!('analysis' in response)) throw new Error('Analyzer returned no result');

  const analysis = response.analysis;

  // Always attach the offline gloss so the panel has something to show even if
  // the model call fails or is disabled.
  analysis.translation = glossTranslation(analysis.tokens);

  const provider = getProvider(settings.provider);
  const { apiKey, model } = credentialsFor(settings);

  if (!settings.aiTranslation || !apiKey) return analysis;

  // Checked before the permission and the network call: a translation already
  // paid for costs nothing to reuse.
  const cached = await getCached(analysis.text, settings.provider, model);
  if (cached) {
    applyTranslation(analysis, model, cached, true);
    return analysis;
  }

  const hasPermission = await chrome.permissions.contains({ origins: [provider.origin] });
  if (!hasPermission) {
    const host = new URL(provider.origin.replace('/*', '')).host;
    analysis.warnings.push(
      `AI translation needs permission for ${host} — re-enable it in the extension options.`,
    );
    return analysis;
  }

  const controller = new AbortController();
  inFlight.get(requestId)?.abort();
  inFlight.set(requestId, controller);

  try {
    // Two tabs analysing the same sentence at once should make one API call.
    const key = `${settings.provider}:${model}:${analysis.text}`;
    let pending = pendingTranslations.get(key);
    if (!pending) {
      pending = translateSentence({
        provider: settings.provider,
        apiKey,
        model,
        text: analysis.text,
        tokens: analysis.tokens,
        signal: controller.signal,
      }).finally(() => pendingTranslations.delete(key));
      pendingTranslations.set(key, pending);
    }
    const result = await pending;

    const value: CacheValue = {
      translation: result.translation.text,
      literal: result.literal,
      note: result.note,
    };
    applyTranslation(analysis, model, value, false);
    await putCached(analysis.text, settings.provider, model, value);
  } catch (err) {
    if (!controller.signal.aborted) {
      analysis.warnings.push(
        `Translation unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } finally {
    inFlight.delete(requestId);
  }

  return analysis;
}

/* ---------------------------------- Anki ---------------------------------- */

const ANKI_PERMISSION_HINT =
  'Anki access has not been granted. Turn Anki export on in the extension options.';

async function hasAnkiPermission(): Promise<boolean> {
  return chrome.permissions.contains({ origins: ANKI_ORIGINS });
}

function ankiFailure(err: unknown): { ok: false; error: string } {
  if (err instanceof AnkiError) return { ok: false, error: err.message };
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/** Connectivity check plus the lists the options page needs to populate. */
async function ankiProbe(): Promise<Record<string, unknown>> {
  if (!(await hasAnkiPermission())) return { ok: false, error: ANKI_PERMISSION_HINT };
  const settings = await getSettings();
  const config = ankiConfigFor(settings);
  try {
    const version = await getVersion(config.url);
    const [decks, models] = await Promise.all([listDecks(config.url), listModels(config.url)]);
    return { ok: true, version, decks, models };
  } catch (err) {
    return ankiFailure(err);
  }
}

async function ankiFields(model: string): Promise<Record<string, unknown>> {
  if (!(await hasAnkiPermission())) return { ok: false, error: ANKI_PERMISSION_HINT };
  const config = ankiConfigFor(await getSettings());
  try {
    return { ok: true, fields: await listModelFields(config.url, model) };
  } catch (err) {
    return ankiFailure(err);
  }
}

/**
 * Kanji-to-kana alignment for each item, re-derived at send time.
 *
 * Saved records stay compact and do not store the breakdown, so this asks the
 * analyser again — which also means items saved before furigana existed get it
 * too. A failure here just costs that card its ruby, never the send.
 */
async function furiganaForItems(
  items: SavedItem[],
  settings: Settings,
): Promise<Map<string, FuriganaSegment[]>> {
  const byId = new Map<string, FuriganaSegment[]>();
  for (const item of items) {
    try {
      const response = await askOffscreen({
        target: 'offscreen',
        type: 'analyze',
        text: item.text,
        style: settings.romajiStyle,
      });
      if (response.ok && 'analysis' in response) {
        byId.set(
          item.id,
          response.analysis.tokens.flatMap((token) => token.furigana),
        );
      }
    } catch {
      // Leave this item without ruby rather than failing the whole export.
    }
  }
  return byId;
}

async function ankiSend(items: SavedItem[]): Promise<Record<string, unknown>> {
  if (!(await hasAnkiPermission())) return { ok: false, error: ANKI_PERMISSION_HINT };
  const settings = await getSettings();
  const config = ankiConfigFor(settings);
  try {
    const furigana = config.furigana ? await furiganaForItems(items, settings) : undefined;
    const result = await sendToAnki(items, config, undefined, furigana);
    // Remember which ones landed so they are not offered again.
    await markSynced(
      result.noteIds
        .map((noteId, index) => ({ id: items[index]?.id, noteId }))
        .filter((entry): entry is { id: string; noteId: number } =>
          Boolean(entry.id) && entry.noteId !== null,
        ),
    );
    return { ok: true, ...result };
  } catch (err) {
    return ankiFailure(err);
  }
}

/* ------------------------------ regeneration ------------------------------ */

/**
 * Translate again, ignoring the cache, optionally on a different provider.
 *
 * The fresh result replaces the cache entry and, if the sentence is saved, its
 * stored snapshot — a user regenerates because the last answer was not good
 * enough, so the old one should not linger anywhere.
 */
async function regenerate(
  analysis: Analysis,
  requested?: ProviderId,
): Promise<Record<string, unknown>> {
  const settings = await getSettings();
  const id = requested ?? settings.provider;
  const provider = getProvider(id);
  const { apiKey, model } = credentialsFor(settings, id);

  if (!apiKey) return { ok: false, error: `No API key configured for ${provider.label}.` };

  const hasPermission = await chrome.permissions.contains({ origins: [provider.origin] });
  if (!hasPermission) {
    const host = new URL(provider.origin.replace('/*', '')).host;
    return { ok: false, error: `Permission for ${host} has not been granted.` };
  }

  try {
    const result = await translateSentence({
      provider: id,
      apiKey,
      model,
      text: analysis.text,
      tokens: analysis.tokens,
    });

    const value: CacheValue = {
      translation: result.translation.text,
      literal: result.literal,
      note: result.note,
    };
    await putCached(analysis.text, id, model, value);
    await updateTranslation(analysis.text, {
      translation: value.translation,
      translationSource: 'ai',
      translationModel: model,
      literal: value.literal,
      note: value.note,
    });

    return { ok: true, provider: id, model, ...value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------- messaging ------------------------------- */

interface AnalyzeMessage {
  type: 'analyze';
  text: string;
  requestId: string;
}
interface SettingsMessage {
  type: 'getSettings' | 'setSettings';
  settings?: Partial<Settings>;
}
interface StatusMessage {
  type: 'status';
}
/** Content scripts cannot call chrome.runtime.openOptionsPage themselves. */
interface OpenOptionsMessage {
  type: 'openOptions';
}
/**
 * Saving is centralised here rather than done from the content script so that
 * two tabs saving at once cannot clobber each other's write.
 */
interface SaveMessage {
  type: 'saveItem';
  analysis: Analysis;
  source?: SaveSource;
}
interface SavedQueryMessage {
  type: 'isSaved';
  text: string;
}
interface RemoveSavedMessage {
  type: 'removeSaved';
  id: string;
}
interface OpenReviewMessage {
  type: 'openReview';
}
interface ListSavedMessage {
  type: 'listSaved';
}
/**
 * Anki traffic is proxied through here so the host-permission check lives in
 * one place and pages get a single, readable error shape.
 */
interface AnkiProbeMessage {
  type: 'ankiProbe';
}
interface AnkiFieldsMessage {
  type: 'ankiFields';
  model: string;
}
interface AnkiSendMessage {
  type: 'ankiSend';
  items: SavedItem[];
}
interface CacheStatsMessage {
  type: 'cacheStats';
}
interface ClearCacheMessage {
  type: 'clearCache';
}
interface RegenerateMessage {
  type: 'regenerate';
  analysis: Analysis;
  provider?: ProviderId;
}

type BackgroundMessage =
  | AnalyzeMessage
  | SettingsMessage
  | StatusMessage
  | OpenOptionsMessage
  | SaveMessage
  | SavedQueryMessage
  | RemoveSavedMessage
  | OpenReviewMessage
  | ListSavedMessage
  | AnkiProbeMessage
  | AnkiFieldsMessage
  | AnkiSendMessage
  | CacheStatsMessage
  | ClearCacheMessage
  | RegenerateMessage;

/** Settings with the API keys stripped, for contexts that must not see them. */
function redactKeys(settings: Settings): Settings {
  return { ...settings, anthropicApiKey: '', openaiApiKey: '' };
}

chrome.runtime.onMessage.addListener((message: BackgroundMessage & { target?: string }, sender, sendResponse) => {
  // Offscreen traffic rides the same channel; leave it alone.
  if (message?.target === 'offscreen') return undefined;

  void (async () => {
    try {
      switch (message.type) {
        case 'analyze':
          sendResponse({ ok: true, analysis: await analyze(message.text, message.requestId) });
          return;
        case 'getSettings': {
          const settings = await getSettings();
          sendResponse({
            ok: true,
            // A content script has no use for the keys, so it does not get them.
            settings: sender.tab ? redactKeys(settings) : settings,
            providers: availableProviders(settings),
          });
          return;
        }
        case 'setSettings':
          sendResponse({ ok: true, settings: await setSettings(message.settings ?? {}) });
          return;
        case 'status': {
          const status = await askOffscreen({ target: 'offscreen', type: 'status' });
          sendResponse(status);
          return;
        }
        case 'openOptions':
          await chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          return;
        case 'openReview':
          await chrome.tabs.create({ url: chrome.runtime.getURL(REVIEW_PATH) });
          sendResponse({ ok: true });
          return;
        case 'saveItem': {
          const result = await saveAnalysis(message.analysis, message.source ?? {});
          sendResponse({ ok: true, ...result });
          return;
        }
        case 'isSaved': {
          const item = await findSavedByText(message.text);
          sendResponse({ ok: true, saved: Boolean(item), item });
          return;
        }
        case 'removeSaved': {
          const remaining = await removeSaved(message.id);
          sendResponse({ ok: true, total: remaining });
          return;
        }
        case 'listSaved':
          sendResponse({ ok: true, items: await listSaved() });
          return;
        case 'ankiProbe':
          sendResponse(await ankiProbe());
          return;
        case 'ankiFields':
          sendResponse(await ankiFields(message.model));
          return;
        case 'ankiSend':
          sendResponse(await ankiSend(message.items));
          return;
        case 'cacheStats':
          sendResponse({ ok: true, ...(await cacheStats()) });
          return;
        case 'clearCache':
          await clearCache();
          sendResponse({ ok: true });
          return;
        case 'regenerate':
          sendResponse(await regenerate(message.analysis, message.provider));
          return;
        default:
          sendResponse({ ok: false, error: 'Unknown message' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();

  return true;
});

/* ------------------------- entry points into a page ---------------------- */

async function triggerInActiveTab(tabId: number, text?: string): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'showPanel', text });
  } catch {
    // No content script on this page (chrome:// pages, the Web Store, PDFs).
    // Nothing useful to do; the popup explains this case.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Show romaji and breakdown',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: SAVE_MENU_ID,
      title: 'Save for review',
      contexts: ['selection'],
    });
  });
  // Warm the analyser so the first real lookup is fast.
  void ensureOffscreenDocument();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureOffscreenDocument();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === CONTEXT_MENU_ID) {
    void triggerInActiveTab(tab.id, info.selectionText);
    return;
  }
  if (info.menuItemId === SAVE_MENU_ID && info.selectionText) {
    // Analyse first — a saved item without romaji would be useless to review.
    void (async () => {
      const analysis = await analyze(info.selectionText!, 'context-menu-save');
      await saveAnalysis(analysis, { url: info.pageUrl, title: tab.title });
    })();
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'analyze-selection') return;
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await triggerInActiveTab(tab.id);
  })();
});
