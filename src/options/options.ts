/**
 * Options page. Settings are written to chrome.storage.local, which the content
 * script and service worker both watch.
 */

import { listModels, listingNeedsKey, type ModelOption } from '../lib/providers/models';
import { getProvider, PROVIDER_IDS, PROVIDERS, type ProviderId } from '../lib/providers/registry';
import { kanaToRomaji, type RomajiStyle } from '../lib/romaji';
import { ANKI_ORIGINS } from '../lib/anki';
import { DEFAULT_SETTINGS, credentialsFor, credentialsPatch, type Settings } from '../lib/types';

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
  apiModel: $<HTMLSelectElement>('apiModel'),
  modelFilter: $<HTMLInputElement>('model-filter'),
  modelCustom: $<HTMLInputElement>('model-custom'),
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
const credentials = Object.fromEntries(
  PROVIDER_IDS.map((id) => [id, { apiKey: '', model: PROVIDERS[id].defaultModel }]),
) as Record<ProviderId, { apiKey: string; model: string }>;

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

  for (const id of PROVIDER_IDS) {
    const saved = credentialsFor(settings, id);
    credentials[id] = { apiKey: saved.apiKey, model: saved.model || PROVIDERS[id].defaultModel };
  }

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
  // A new key can unlock a different model list.
  fields.apiKey.addEventListener('change', () => void loadModels());
  fields.apiModel.addEventListener('change', onModelPicked);
  fields.modelCustom.addEventListener('input', () => {
    credentials[currentProvider].model = fields.modelCustom.value;
    renderModelHint();
  });
  fields.modelFilter.addEventListener('input', applyModelFilter);
  $('model-refresh').addEventListener('click', () => void loadModels(true));

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

  $('key-label').textContent = `${provider.label} API key`;
  $('key-host').textContent = new URL(provider.origin.replace('/*', '')).host;

  const link = $<HTMLAnchorElement>('console-link');
  link.href = provider.consoleUrl;
  link.textContent = new URL(provider.consoleUrl).host;

  fields.modelFilter.value = '';
  void loadModels();
}

/* ---------- Model selector ---------- */

/** Select value that reveals the free-text field. */
const OTHER_MODEL = '__other__';
/** Past this many models, the list gets a filter box. */
const FILTER_THRESHOLD = 15;

/** Fetched lists, so switching provider back and forth does not refetch. */
const modelCache = new Map<string, ModelOption[]>();
let modelAbort: AbortController | null = null;
let modelStatus = '';

function suggestedModels(id: ProviderId): ModelOption[] {
  return getProvider(id).suggestedModels.map(({ id: model, hint }) => ({ id: model, label: model, hint }));
}

/**
 * Fill the selector from the provider's own model list. Falls back to the
 * suggestions this build ships with whenever the list cannot be had — no key
 * yet, offline, or a key without list access — so the field is never empty.
 */
async function loadModels(force = false): Promise<void> {
  const id = currentProvider;
  const provider = getProvider(id);
  const apiKey = credentials[id].apiKey.trim();
  const host = new URL(provider.origin.replace('/*', '')).host;

  modelAbort?.abort();
  modelAbort = null;

  // No host permission until AI translation is on, and no point asking then.
  if (!fields.aiTranslation.checked) {
    renderModelSelect(suggestedModels(id), 'Showing suggestions.');
    return;
  }
  if (listingNeedsKey(id) && !apiKey) {
    renderModelSelect(suggestedModels(id), `Enter an API key to load the full list from ${host}.`);
    return;
  }

  // OpenRouter's catalogue is the same for everyone; the others depend on the key.
  const cacheKey = listingNeedsKey(id) ? `${id}\n${apiKey}` : id;
  const cached = modelCache.get(cacheKey);
  if (cached && !force) {
    renderModelSelect(cached, `${cached.length} models from ${host}.`);
    return;
  }

  const controller = new AbortController();
  modelAbort = controller;
  renderModelSelect(cached ?? suggestedModels(id), `Loading models from ${host}\u2026`);

  try {
    const models = await listModels(id, apiKey, controller.signal);
    if (controller.signal.aborted || id !== currentProvider) return;
    if (!models.length) throw new Error('no usable models came back');
    modelCache.set(cacheKey, models);
    renderModelSelect(models, `${models.length} models from ${host}.`);
  } catch (err) {
    if (controller.signal.aborted || id !== currentProvider) return;
    const reason = (err as Error)?.message ?? String(err);
    renderModelSelect(
      suggestedModels(id),
      `Could not load the model list (${reason.replace(/\.$/, '')}). Showing suggestions.`,
    );
  } finally {
    if (modelAbort === controller) modelAbort = null;
  }
}

function renderModelSelect(models: ModelOption[], status: string): void {
  const selected = credentials[currentProvider].model;
  const select = fields.apiModel;
  select.textContent = '';

  // A saved model the list does not know (retired, or typed by hand) stays
  // selectable rather than silently changing.
  const list =
    selected && !models.some((m) => m.id === selected)
      ? [{ id: selected, label: selected, hint: 'not in list' }, ...models]
      : models;

  const groups = new Map<string, HTMLOptGroupElement>();
  for (const model of list) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.hint ? `${model.label} \u00b7 ${model.hint}` : model.label;
    option.title = model.id;

    if (!model.group) {
      select.appendChild(option);
      continue;
    }
    let group = groups.get(model.group);
    if (!group) {
      group = document.createElement('optgroup');
      group.label = model.group;
      groups.set(model.group, group);
      select.appendChild(group);
    }
    group.appendChild(option);
  }

  const other = document.createElement('option');
  other.value = OTHER_MODEL;
  other.textContent = 'Other\u2026';
  select.appendChild(other);

  select.value = selected || OTHER_MODEL;
  fields.modelCustom.classList.toggle('hidden', select.value !== OTHER_MODEL);
  fields.modelCustom.value = selected;
  fields.modelFilter.classList.toggle('hidden', list.length <= FILTER_THRESHOLD);
  applyModelFilter();

  modelStatus = status;
  renderModelHint();
}

function onModelPicked(): void {
  const custom = fields.apiModel.value === OTHER_MODEL;
  fields.modelCustom.classList.toggle('hidden', !custom);
  if (custom) {
    fields.modelCustom.value = credentials[currentProvider].model;
    fields.modelCustom.focus();
  } else {
    credentials[currentProvider].model = fields.apiModel.value;
  }
  renderModelHint();
}

/** Hide options that do not match the filter; the current choice always stays. */
function applyModelFilter(): void {
  const query = fields.modelFilter.value.trim().toLowerCase();
  const select = fields.apiModel;
  for (const option of Array.from(select.options)) {
    const keep =
      !query ||
      option.selected ||
      option.value === OTHER_MODEL ||
      option.value.toLowerCase().includes(query) ||
      (option.textContent ?? '').toLowerCase().includes(query);
    option.hidden = !keep;
  }
  for (const group of Array.from(select.querySelectorAll('optgroup'))) {
    group.hidden = Array.from(group.children).every((child) => (child as HTMLOptionElement).hidden);
  }
}

function renderModelHint(): void {
  const model = credentials[currentProvider].model.trim();
  $('model-hint').textContent = [model ? `Model id: ${model}.` : '', modelStatus]
    .filter(Boolean)
    .join(' ');
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
  if (fields.aiTranslation.checked) void loadModels();
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
    ...Object.assign(
      {},
      ...PROVIDER_IDS.map((id) =>
        credentialsPatch(id, {
          apiKey: credentials[id].apiKey.trim(),
          model: credentials[id].model.trim() || PROVIDERS[id].defaultModel,
        }),
      ),
    ),
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
