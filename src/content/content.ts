/**
 * In-page UI: watches the selection, offers to analyse Japanese text, and
 * renders the result in a panel.
 *
 * Everything lives in a shadow root attached to <html>, so the host page's CSS
 * can't affect it and our styles can't affect the page.
 */

import { containsJapanese } from '../lib/kana';
import {
  DEFAULT_SETTINGS,
  type Analysis,
  type AvailableProvider,
  type Settings,
} from '../lib/types';
import {
  el,
  errorState,
  iconButton,
  loadingState,
  setButtonIcon,
  renderBody,
  renderFooter,
  renderSource,
} from './render';
import { PANEL_STYLES } from './styles';

/** Longer selections are almost always an accident (select-all, whole article). */
const MAX_ANALYZE_LENGTH = 400;

let settings: Settings = { ...DEFAULT_SETTINGS };
let shadow: ShadowRoot | null = null;
/** The element in the page DOM that carries our shadow root. */
let host: HTMLElement | null = null;
let root: HTMLElement | null = null;
let trigger: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;

/** Selection the trigger currently refers to. */
let pendingText = '';
let pendingRect: DOMRect | null = null;
/** Anchor the open panel is positioned against. */
let panelAnchor: DOMRect | null = null;
/** Bumped on every open and every close; invalidates stale analysis results. */
let panelToken = 0;
let showFurigana = true;
/** Providers with a key configured, as reported by the background worker. */
let providers: AvailableProvider[] = [];
/** True while a regeneration is in flight, so the control can show progress. */
let regenerating = false;

/* ------------------------------- bootstrap -------------------------------- */

void (async () => {
  settings = await loadSettings();
  showFurigana = settings.showFurigana;
  install();
})();

async function loadSettings(): Promise<Settings> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'getSettings' })) as
      | { ok: true; settings: Settings; providers?: AvailableProvider[] }
      | { ok: false };
    if (response?.ok) {
      providers = response.providers ?? [];
      return response.settings;
    }
  } catch {
    // Service worker asleep or extension reloading; defaults are fine.
  }
  return { ...DEFAULT_SETTINGS };
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, change] of Object.entries(changes)) {
    (settings as unknown as Record<string, unknown>)[key] = change.newValue;
  }
  if ('showFurigana' in changes) showFurigana = settings.showFurigana;
  if ('theme' in changes) applyTheme();
  // A key or provider edit changes what the regenerate dropdown may offer.
  if (['anthropicApiKey', 'openaiApiKey', 'aiTranslation'].some((key) => key in changes)) {
    void loadSettings().then((next) => {
      settings = next;
    });
  }
});

function install(): void {
  document.addEventListener('mouseup', onSelectionSettled, true);
  document.addEventListener('keyup', onSelectionSettled, true);
  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange, true);

  chrome.runtime.onMessage.addListener((message: { type: string; text?: string }) => {
    if (message?.type !== 'showPanel') return;
    const text = (message.text ?? window.getSelection()?.toString() ?? '').trim();
    if (!text || !containsJapanese(text)) return;
    const rect = selectionRect() ?? centreRect();
    hideTrigger();
    void openPanel(text, rect);
  });
}

/* ------------------------------- selection -------------------------------- */

function selectionRect(): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const rects = selection.getRangeAt(0).getClientRects();
  if (rects.length === 0) return null;
  // Anchor to the end of the selection, which is where the cursor was released.
  return rects[rects.length - 1];
}

function centreRect(): DOMRect {
  return new DOMRect(window.innerWidth / 2, window.innerHeight / 3, 0, 0);
}

function onSelectionSettled(event: Event): void {
  if (isOurs(event)) return;

  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? '';

  if (!text || !containsJapanese(text) || text.length > MAX_ANALYZE_LENGTH) {
    hideTrigger();
    return;
  }

  const rect = selectionRect();
  if (!rect) {
    hideTrigger();
    return;
  }

  pendingText = text;
  pendingRect = rect;

  if (settings.autoAnalyze) {
    hideTrigger();
    void openPanel(text, rect);
  } else if (settings.showSelectionButton) {
    showTrigger(rect);
  }
}

function onPointerDown(event: Event): void {
  if (isOurs(event)) return;
  hideTrigger();
  closePanel();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && panel) {
    closePanel();
    hideTrigger();
  }
}

function onViewportChange(): void {
  // The anchor rect is viewport-relative, so it goes stale the moment anything
  // scrolls. Recompute from the live selection when we still can.
  if (trigger) {
    const rect = selectionRect();
    if (rect) {
      pendingRect = rect;
      positionTrigger(rect);
    } else {
      hideTrigger();
    }
  }
  if (panel) {
    const rect = selectionRect() ?? panelAnchor;
    if (rect) {
      panelAnchor = rect;
      positionPanel(rect);
    }
  }
}

/**
 * Did this event come from our own UI?
 *
 * The panel lives in a shadow root, and an event from inside a shadow tree is
 * retargeted by the time it reaches a listener on `document` — `event.target`
 * becomes the shadow *host*, not the button that was actually clicked. So this
 * has to test against the host, and `composedPath()` is the reliable way to do
 * it because it reports the real path through the shadow boundary.
 */
function isOurs(event: Event): boolean {
  if (!host) return false;
  const path = event.composedPath?.();
  if (path?.length) return path.includes(host);
  // composedPath is empty for events already dispatched; fall back to the
  // retargeted node, which is the host itself.
  const target = event.target;
  return target instanceof Node && (target === host || host.contains(target));
}

/* --------------------------------- shell ---------------------------------- */

function ensureShadow(): ShadowRoot {
  if (shadow) return shadow;

  host = document.createElement('div');
  host.id = 'hodoku-host';
  host.style.cssText = 'all: initial; position: static;';
  document.documentElement.appendChild(host);

  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_STYLES;
  shadow.appendChild(style);

  root = document.createElement('div');
  root.className = 'root';
  shadow.appendChild(root);
  applyTheme();

  return shadow;
}

function applyTheme(): void {
  if (!root) return;
  const dark =
    settings.theme === 'dark' ||
    (settings.theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
}

/* -------------------------------- trigger --------------------------------- */

function showTrigger(rect: DOMRect): void {
  ensureShadow();
  if (!trigger) {
    trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'trigger';
    trigger.innerHTML = '<span class="mark">ほ</span><span>Romaji</span>';
    trigger.title = 'Show romaji and word breakdown';
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = pendingText;
      const anchor = pendingRect ?? centreRect();
      hideTrigger();
      void openPanel(text, anchor);
    });
    root!.appendChild(trigger);
  }
  positionTrigger(rect);
}

function positionTrigger(rect: DOMRect): void {
  if (!trigger) return;
  const width = 92;
  const left = clamp(rect.right - width / 2, 8, window.innerWidth - width - 8);
  const below = rect.bottom + 8;
  const top = below + 34 > window.innerHeight ? Math.max(8, rect.top - 40) : below;
  trigger.style.left = `${left}px`;
  trigger.style.top = `${top}px`;
}

function hideTrigger(): void {
  trigger?.remove();
  trigger = null;
}

/* --------------------------------- panel ---------------------------------- */

async function openPanel(text: string, anchor: DOMRect): Promise<void> {
  ensureShadow();
  panelAnchor = anchor;
  // Bumped by both a new lookup and by closing. Analysis is asynchronous and
  // the first one loads the dictionaries, so a result can easily arrive after
  // the user has moved on — without this the panel would render itself back
  // open after being dismissed.
  const token = ++panelToken;
  const requestId = `req-${token}`;

  renderPanel({ state: 'loading', text });
  positionPanel(anchor);

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'analyze',
      text,
      requestId,
    })) as { ok: true; analysis: Analysis } | { ok: false; error: string };

    if (token !== panelToken) return;

    if (!response) throw new Error('No response from the extension background.');
    if (!response.ok) throw new Error(response.error);

    renderPanel({ state: 'done', text, analysis: response.analysis });
  } catch (err) {
    if (token !== panelToken) return;
    renderPanel({
      state: 'error',
      text,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (panelAnchor) positionPanel(panelAnchor);
}

function closePanel(): void {
  // Invalidate any analysis still in flight for the panel being closed.
  panelToken++;
  panel?.remove();
  panel = null;
  panelAnchor = null;
}

function positionPanel(rect: DOMRect): void {
  if (!panel) return;
  const width = panel.offsetWidth || 400;
  const height = panel.offsetHeight || 320;
  const gap = 10;

  const left = clamp(rect.left, 12, Math.max(12, window.innerWidth - width - 12));
  const spaceBelow = window.innerHeight - rect.bottom;
  const top =
    spaceBelow >= height + gap || spaceBelow >= rect.top
      ? Math.min(rect.bottom + gap, window.innerHeight - height - 12)
      : Math.max(12, rect.top - height - gap);

  panel.style.left = `${left}px`;
  panel.style.top = `${Math.max(12, top)}px`;
}

type PanelState =
  | { state: 'loading'; text: string }
  | { state: 'done'; text: string; analysis: Analysis }
  | { state: 'error'; text: string; error: string };

function renderPanel(view: PanelState): void {
  ensureShadow();
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Japanese analysis');
    root!.appendChild(panel);
  }

  panel.textContent = '';
  panel.appendChild(buildHead(view));

  const body = el('div', 'panel__body');
  if (view.state === 'loading') {
    body.appendChild(loadingState());
  } else if (view.state === 'error') {
    body.appendChild(errorState(view.error));
  } else {
    renderBody(view.analysis, panelOptions(view)).forEach((node) => body.appendChild(node));
  }
  panel.appendChild(body);

  if (view.state === 'done') panel.appendChild(buildFoot(view.analysis));
}

function buildHead(view: PanelState): HTMLElement {
  const head = el('div', 'panel__head');

  if (view.state === 'done') {
    head.appendChild(renderSource(view.analysis, panelOptions(view)));
  } else {
    const source = el('div', 'panel__source');
    source.lang = 'ja';
    source.textContent = view.text;
    head.appendChild(source);
  }

  const actions = el('div', 'panel__actions');

  if (view.state === 'done') {
    const saveBtn = iconButton('bookmark', 'Save for review');
    saveBtn.dataset.saved = 'false';
    // Reflect whatever is already stored before the user touches anything.
    void refreshSavedState(saveBtn, view.analysis.text);
    saveBtn.addEventListener('click', () => void toggleSaved(saveBtn, view.analysis));
    actions.appendChild(saveBtn);

    const furiganaBtn = iconButton('ふ', 'Toggle furigana');
    furiganaBtn.setAttribute('aria-pressed', String(showFurigana));
    furiganaBtn.addEventListener('click', () => {
      showFurigana = !showFurigana;
      renderPanel(view);
    });
    actions.appendChild(furiganaBtn);

    const copyBtn = iconButton('copy', 'Copy romaji');
    copyBtn.addEventListener('click', () => {
      void copyText(view.analysis.romaji, copyBtn);
    });
    actions.appendChild(copyBtn);
  }

  const closeBtn = iconButton('close', 'Close');
  closeBtn.addEventListener('click', () => closePanel());
  actions.appendChild(closeBtn);

  head.appendChild(actions);
  return head;
}


function buildFoot(analysis: Analysis): HTMLElement {
  const foot = renderFooter(analysis);

  // Only the live panel gets an Options link; the store previews do not.
  const review = document.createElement('button');
  review.type = 'button';
  review.className = 'link-btn';
  review.textContent = 'Saved';
  review.title = 'Open the review list';
  review.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'openReview' });
  });
  foot.appendChild(review);

  const options = document.createElement('button');
  options.type = 'button';
  options.className = 'link-btn';
  options.textContent = 'Options';
  options.addEventListener('click', () => {
    // chrome.runtime.openOptionsPage does not exist in a content script — the
    // API surface here is limited to messaging and getURL. The background
    // worker has to do the opening.
    void chrome.runtime.sendMessage({ type: 'openOptions' });
  });
  foot.appendChild(options);

  return foot;
}

/**
 * Render options for the live panel.
 *
 * The regenerate control only appears when AI translation is on and at least
 * one provider has a key, so it can never offer an action that would fail.
 */
function panelOptions(view: PanelState) {
  const canRegenerate = settings.aiTranslation && providers.length > 0;
  return {
    showFurigana,
    providers: canRegenerate ? providers : [],
    regenerating,
    onRegenerate:
      canRegenerate && view.state === 'done'
        ? (provider: string) => void regenerate(view, provider)
        : undefined,
  };
}

/** Ask again, ignoring the cache, optionally on a different provider. */
async function regenerate(view: PanelState & { state: 'done' }, provider: string): Promise<void> {
  if (regenerating) return;
  regenerating = true;
  renderPanel(view);

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'regenerate',
      analysis: view.analysis,
      provider,
    })) as
      | { ok: true; translation: string; literal?: string; note?: string; model: string }
      | { ok: false; error: string };

    if (!response?.ok) throw new Error(response?.error ?? 'No response');

    view.analysis.translation = { text: response.translation, source: 'ai', model: response.model };
    view.analysis.literalTranslation = response.literal;
    view.analysis.grammarNote = response.note;
    // A previous failure message no longer applies to this translation.
    view.analysis.warnings = view.analysis.warnings.filter(
      (warning) => !warning.startsWith('Translation unavailable'),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    view.analysis.warnings = [
      ...view.analysis.warnings.filter((w) => !w.startsWith('Could not regenerate')),
      `Could not regenerate: ${message}`,
    ];
  } finally {
    regenerating = false;
    renderPanel(view);
  }
}

/* --------------------------------- saving --------------------------------- */

/** The item id currently shown, so the button can toggle without a re-query. */
let savedItemId: string | null = null;

async function refreshSavedState(button: HTMLButtonElement, text: string): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'isSaved', text })) as {
      ok: boolean;
      saved?: boolean;
      item?: { id: string };
    };
    if (!response?.ok) return;
    savedItemId = response.item?.id ?? null;
    setSavedState(button, Boolean(response.saved));
  } catch {
    // Background asleep or reloading; leave the button in its default state.
  }
}

function setSavedState(button: HTMLButtonElement, saved: boolean): void {
  button.dataset.saved = String(saved);
  const label = saved ? 'Saved for review — click to remove' : 'Save for review';
  button.title = label;
  button.setAttribute('aria-label', label);
}

async function toggleSaved(button: HTMLButtonElement, analysis: Analysis): Promise<void> {
  const currentlySaved = button.dataset.saved === 'true';
  // Flip immediately; a failure re-reads the real state below.
  setSavedState(button, !currentlySaved);

  try {
    if (currentlySaved && savedItemId) {
      await chrome.runtime.sendMessage({ type: 'removeSaved', id: savedItemId });
      savedItemId = null;
      return;
    }
    const response = (await chrome.runtime.sendMessage({
      type: 'saveItem',
      analysis,
      source: { url: location.href, title: document.title },
    })) as { ok: boolean; item?: { id: string } };
    if (!response?.ok) throw new Error('save failed');
    savedItemId = response.item?.id ?? null;
  } catch {
    await refreshSavedState(button, analysis.text);
  }
}

/* -------------------------------- helpers --------------------------------- */

async function copyText(text: string, button: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setButtonIcon(button, 'check');
    setTimeout(() => setButtonIcon(button, 'copy'), 1200);
  } catch {
    button.title = 'Copying is blocked on this page';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
