/**
 * Options page. Settings are written to chrome.storage.local, which the content
 * script and service worker both watch.
 */

import { getProvider, PROVIDER_IDS, PROVIDERS, type ProviderId } from '../lib/providers/registry';
import { kanaToRomaji, type RomajiStyle } from '../lib/romaji';
import { ANKI_ORIGINS } from '../lib/anki';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';

/** Words that show the difference between the four romaji styles. */
const PREVIEW_WORDS: Array<{ label: string; written: string; spoken: string }> = [
  { label: '東京', written: 'トウキョウ', spoken: 'トーキョー' },
  { label: '学校', written: 'ガッコウ', spoken: 'ガッコー' },
  { label: 'ビール', written: 'ビール', spoken: 'ビール' },
];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const fields = {
  romajiStyle: $<HTMLSelectElement>('romajiStyle'),
  theme: $<HTMLSelectElement>('theme'),
  provider: $<HTMLSelectElement>('provider'),
  apiModel: $<HTMLInputElement>('apiModel'),
  apiKey: $<HTMLInputElement>('apiKey'),
  showFurigana: $<HTMLInputElement>('showFurigana'),
  showSelectionButton: $<HTMLInputElement>('showSelectionButton'),
  autoAnalyze: $<HTMLInputElement>('autoAnalyze'),
  aiTranslation: $<HTMLInputElement>('aiTranslation'),
  ankiEnabled: $<HTMLInputElement>('ankiEnabled'),
  ankiUrl: $<HTMLInputElement>('ankiUrl'),
  ankiDeck: $<HTMLInputElement>('ankiDeck'),
  ankiModel: $<HTMLInputElement>('ankiModel'),
  ankiFrontField: $<HTMLInputElement>('ankiFrontField'),
  ankiBackField: $<HTMLInputElement>('ankiBackField'),
  ankiTags: $<HTMLInputElement>('ankiTags'),
  ankiFurigana: $<HTMLInputElement>('ankiFurigana'),
};

/**
 * Per-provider key and model live here while the page is open, so switching
 * provider does not wipe what was typed for the other one.
 */
const credentials: Record<ProviderId, { apiKey: string; model: string }> = {
  anthropic: { apiKey: '', model: PROVIDERS.anthropic.defaultModel },
  openai: { apiKey: '', model: PROVIDERS.openai.defaultModel },
};

let currentProvider: ProviderId = 'anthropic';

void init();

async function init(): Promise<void> {
  const settings = await getSettings();

  fields.romajiStyle.value = settings.romajiStyle;
  fields.theme.value = settings.theme;
  fields.showFurigana.checked = settings.showFurigana;
  fields.showSelectionButton.checked = settings.showSelectionButton;
  fields.autoAnalyze.checked = settings.autoAnalyze;
  fields.aiTranslation.checked = settings.aiTranslation;

  fields.ankiEnabled.checked = settings.ankiEnabled;
  fields.ankiUrl.value = settings.ankiUrl;
  fields.ankiDeck.value = settings.ankiDeck;
  fields.ankiModel.value = settings.ankiModel;
  fields.ankiFrontField.value = settings.ankiFrontField;
  fields.ankiBackField.value = settings.ankiBackField;
  fields.ankiTags.value = settings.ankiTags;
  fields.ankiFurigana.checked = settings.ankiFurigana;
  // AnkiConnect matches on the exact extension origin, which is only knowable
  // at runtime.
  $<HTMLInputElement>('anki-origin').value = `chrome-extension://${chrome.runtime.id}`;

  credentials.anthropic = {
    apiKey: settings.anthropicApiKey,
    model: settings.anthropicModel || PROVIDERS.anthropic.defaultModel,
  };
  credentials.openai = {
    apiKey: settings.openaiApiKey,
    model: settings.openaiModel || PROVIDERS.openai.defaultModel,
  };

  currentProvider = PROVIDER_IDS.includes(settings.provider) ? settings.provider : 'anthropic';
  fields.provider.value = currentProvider;
  renderProvider();

  fields.romajiStyle.addEventListener('change', renderPreview);
  fields.aiTranslation.addEventListener('change', () => void onAiToggled());
  fields.provider.addEventListener('change', () => void onProviderChanged());
  // Remember edits against the provider they were typed for.
  fields.apiKey.addEventListener('input', () => {
    credentials[currentProvider].apiKey = fields.apiKey.value;
  });
  fields.apiModel.addEventListener('input', () => {
    credentials[currentProvider].model = fields.apiModel.value;
  });

  fields.ankiEnabled.addEventListener('change', () => void onAnkiToggled());
  fields.ankiModel.addEventListener('change', () => void loadAnkiFields());
  $('anki-test').addEventListener('click', () => void testAnki());
  $('cache-clear').addEventListener('click', () => void clearTranslationCache());
  void refreshCacheStats();
  $('anki-copy').addEventListener('click', () => {
    const input = $<HTMLInputElement>('anki-origin');
    input.select();
    void navigator.clipboard.writeText(input.value);
    setStatus($('anki-status'), 'ok', 'Copied');
  });
  updateAnkiVisibility();
  if (settings.ankiEnabled) void testAnki();

  $('save').addEventListener('click', () => void save());
  $('test').addEventListener('click', () => void testConnection());

  renderPreview();
  updateAiVisibility();
  void refreshEngineStatus();
}

async function getSettings(): Promise<Settings> {
  const response = (await chrome.runtime.sendMessage({ type: 'getSettings' })) as {
    ok: boolean;
    settings?: Settings;
  };
  return response?.settings ?? { ...DEFAULT_SETTINGS };
}

function renderPreview(): void {
  const style = fields.romajiStyle.value as RomajiStyle;
  const parts = PREVIEW_WORDS.map(({ label, written, spoken }) => {
    const source = style === 'wapuro' ? written : spoken;
    return `${label} → <b>${kanaToRomaji(source, style)}</b>`;
  });
  $('preview').innerHTML = parts.join(' &nbsp;·&nbsp; ');
}

/** Point the key and model fields at the selected provider. */
function renderProvider(): void {
  const provider = getProvider(currentProvider);
  const saved = credentials[currentProvider];

  fields.apiKey.value = saved.apiKey;
  fields.apiKey.placeholder = provider.keyPlaceholder;
  fields.apiModel.value = saved.model;

  $('key-label').textContent = `${provider.label} API key`;
  $('key-host').textContent = new URL(provider.origin.replace('/*', '')).host;

  const link = $<HTMLAnchorElement>('console-link');
  link.href = provider.consoleUrl;
  link.textContent = new URL(provider.consoleUrl).host;

  const list = $('model-suggestions');
  list.textContent = '';
  for (const { id, hint } of provider.suggestedModels) {
    const option = document.createElement('option');
    option.value = id;
    option.label = hint;
    list.appendChild(option);
  }

  $('model-hint').textContent =
    `Suggestions come from the list this build knows about — any model your account can use ` +
    `can be typed in. Default: ${provider.defaultModel}.`;
}

function updateAiVisibility(): void {
  const on = fields.aiTranslation.checked;
  $('ai-fields').classList.toggle('hidden', !on);
  $('permission-notice-wrap').classList.toggle('hidden', on);
}

/**
 * Host permissions have to be requested inside the user gesture that asked for
 * them, so this runs on the change event rather than in save().
 */
async function requestProviderPermission(id: ProviderId): Promise<boolean> {
  return chrome.permissions.request({ origins: [getProvider(id).origin] }).catch(() => false);
}

async function onAiToggled(): Promise<void> {
  if (!fields.aiTranslation.checked) {
    updateAiVisibility();
    await dropUnusedPermissions(null);
    return;
  }

  if (!(await requestProviderPermission(currentProvider))) {
    fields.aiTranslation.checked = false;
    setStatus($('save-status'), 'warn', 'Permission for the provider host was declined.');
  }
  updateAiVisibility();
}

async function onProviderChanged(): Promise<void> {
  const next = fields.provider.value as ProviderId;

  if (fields.aiTranslation.checked && !(await requestProviderPermission(next))) {
    // Keep the UI on the provider that is actually usable.
    fields.provider.value = currentProvider;
    setStatus($('save-status'), 'warn', 'Permission for that provider was declined.');
    return;
  }

  currentProvider = next;
  renderProvider();
  await dropUnusedPermissions(next);
  setStatus($('test-status'), '', '');
}

/** Give back host permissions for providers that are not in use. */
async function dropUnusedPermissions(keep: ProviderId | null): Promise<void> {
  for (const id of PROVIDER_IDS) {
    if (id === keep) continue;
    await chrome.permissions.remove({ origins: [getProvider(id).origin] }).catch(() => undefined);
  }
}

function collectSettings(): Partial<Settings> {
  return {
    romajiStyle: fields.romajiStyle.value as RomajiStyle,
    theme: fields.theme.value as Settings['theme'],
    provider: currentProvider,
    anthropicApiKey: credentials.anthropic.apiKey.trim(),
    anthropicModel: credentials.anthropic.model.trim() || PROVIDERS.anthropic.defaultModel,
    openaiApiKey: credentials.openai.apiKey.trim(),
    openaiModel: credentials.openai.model.trim() || PROVIDERS.openai.defaultModel,
    showFurigana: fields.showFurigana.checked,
    showSelectionButton: fields.showSelectionButton.checked,
    autoAnalyze: fields.autoAnalyze.checked,
    aiTranslation: fields.aiTranslation.checked,
    ankiEnabled: fields.ankiEnabled.checked,
    ankiUrl: fields.ankiUrl.value.trim(),
    ankiDeck: fields.ankiDeck.value.trim(),
    ankiModel: fields.ankiModel.value.trim(),
    ankiFrontField: fields.ankiFrontField.value.trim(),
    ankiBackField: fields.ankiBackField.value.trim(),
    ankiTags: fields.ankiTags.value.trim(),
    ankiFurigana: fields.ankiFurigana.checked,
  };
}

/* --------------------------- translation cache ---------------------------- */

async function refreshCacheStats(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({ type: 'cacheStats' })) as
    | { ok: true; entries: number; hits: number; bytes: number }
    | { ok: false };
  if (!response?.ok) return;

  const summary = $('cache-summary');
  if (!response.entries) {
    summary.textContent =
      'Translations are reused for the same sentence, so a repeat costs nothing. Nothing cached yet.';
    return;
  }
  const kb = Math.max(1, Math.round(response.bytes / 1024));
  summary.textContent =
    `${response.entries} translation${response.entries === 1 ? '' : 's'} cached (${kb} KB), ` +
    `reused ${response.hits} time${response.hits === 1 ? '' : 's'}. ` +
    'Cached results cost nothing and work without a network connection.';
}

async function clearTranslationCache(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'clearCache' });
  setStatus($('cache-status'), 'ok', 'Cleared');
  await refreshCacheStats();
  setTimeout(() => setStatus($('cache-status'), '', ''), 2000);
}

/* ---------------------------------- Anki ---------------------------------- */

function updateAnkiVisibility(): void {
  $('anki-fields').classList.toggle('hidden', !fields.ankiEnabled.checked);
}

async function onAnkiToggled(): Promise<void> {
  if (!fields.ankiEnabled.checked) {
    updateAnkiVisibility();
    await chrome.permissions.remove({ origins: ANKI_ORIGINS }).catch(() => undefined);
    return;
  }
  // Must be inside the click that flipped the checkbox.
  const granted = await chrome.permissions.request({ origins: ANKI_ORIGINS }).catch(() => false);
  if (!granted) {
    fields.ankiEnabled.checked = false;
    setStatus($('anki-status'), 'warn', 'Permission to reach Anki was declined.');
  }
  updateAnkiVisibility();
  if (granted) void testAnki();
}

function fillDatalist(id: string, values: string[]): void {
  const list = $(id);
  list.textContent = '';
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    list.appendChild(option);
  }
}

async function testAnki(): Promise<void> {
  const status = $('anki-status');
  setStatus(status, 'warn', 'Connecting to Anki…');
  // Persist first so the worker probes the address being tested.
  await chrome.runtime.sendMessage({ type: 'setSettings', settings: collectSettings() });

  const response = (await chrome.runtime.sendMessage({ type: 'ankiProbe' })) as
    | { ok: true; version: number; decks: string[]; models: string[] }
    | { ok: false; error: string };

  if (!response?.ok) {
    setStatus(status, 'warn', response?.error ?? 'Failed');
    return;
  }

  fillDatalist('anki-decks', response.decks);
  fillDatalist('anki-models', response.models);
  setStatus(
    status,
    'ok',
    `Connected — AnkiConnect v${response.version}, ${response.decks.length} decks`,
  );
  await loadAnkiFields();
}

async function loadAnkiFields(): Promise<void> {
  const model = fields.ankiModel.value.trim();
  if (!model) return;
  const response = (await chrome.runtime.sendMessage({ type: 'ankiFields', model })) as
    | { ok: true; fields: string[] }
    | { ok: false; error: string };
  if (!response?.ok) return;
  fillDatalist('anki-model-fields', response.fields);
}

async function save(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'setSettings', settings: collectSettings() });
  setStatus($('save-status'), 'ok', 'Saved');
  setTimeout(() => setStatus($('save-status'), '', ''), 2000);
}

async function testConnection(): Promise<void> {
  const status = $('test-status');
  if (!credentials[currentProvider].apiKey.trim()) {
    setStatus(status, 'warn', 'Enter an API key first.');
    return;
  }

  setStatus(status, 'warn', `Testing ${getProvider(currentProvider).label}…`);
  // Persist first so the background worker uses what is being tested.
  await chrome.runtime.sendMessage({
    type: 'setSettings',
    settings: { ...collectSettings(), aiTranslation: true },
  });

  const response = (await chrome.runtime.sendMessage({
    type: 'analyze',
    text: '猫が好きです',
    requestId: 'options-test',
  })) as
    | { ok: true; analysis: { translation?: { source: string }; warnings: string[] } }
    | { ok: false; error: string };

  if (!response?.ok) {
    setStatus(status, 'warn', response?.error ?? 'Failed');
    return;
  }
  const failure = response.analysis.warnings.find((w) => w.startsWith('Translation unavailable'));
  if (failure) {
    setStatus(status, 'warn', failure.replace('Translation unavailable: ', ''));
    return;
  }
  if (response.analysis.translation?.source === 'ai') {
    setStatus(status, 'ok', 'Working');
    return;
  }
  setStatus(status, 'warn', 'No translation came back.');
}

async function refreshEngineStatus(): Promise<void> {
  const dot = $('engine-dot');
  const text = $('engine-text');
  const detail = $('engine-detail');

  try {
    const response = (await chrome.runtime.sendMessage({ type: 'status' })) as
      | { ok: true; dictionaryHeadwords: number; dictionaryError: string | null }
      | { ok: false; error: string };

    if (!response.ok) {
      dot.className = 'dot dot--warn';
      text.textContent = response.error || 'Loading…';
      setTimeout(() => void refreshEngineStatus(), 1200);
      return;
    }

    dot.className = 'dot dot--ok';
    text.textContent = 'Analyser ready';
    detail.textContent = response.dictionaryError
      ? `Dictionary failed to load (${response.dictionaryError}). Romaji and readings still work.`
      : `${response.dictionaryHeadwords.toLocaleString()} headwords loaded.`;
  } catch (err) {
    dot.className = 'dot';
    text.textContent = err instanceof Error ? err.message : 'Unavailable';
  }
}

function setStatus(node: HTMLElement, kind: 'ok' | 'warn' | '', message: string): void {
  node.innerHTML = '';
  if (!message) return;
  const dot = document.createElement('span');
  dot.className = `dot${kind ? ` dot--${kind}` : ''}`;
  const label = document.createElement('span');
  label.textContent = message;
  node.append(dot, label);
}
