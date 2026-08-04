/**
 * Toolbar popup: engine status, the three settings people flip most often, and
 * a scratch pad for pages where a content script cannot run (chrome:// pages,
 * the Web Store, PDF viewer).
 */

import { DEFAULT_SETTINGS, type Analysis, type Settings } from '../lib/types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const statusDot = $('status-dot');
const statusText = $('status-text');
const engine = $('engine');
const scratch = $<HTMLTextAreaElement>('scratch');
const result = $('result');

const TOGGLES = ['showSelectionButton', 'autoAnalyze', 'showFurigana'] as const;

void init();

async function init(): Promise<void> {
  const settings = await getSettings();

  for (const key of TOGGLES) {
    const input = $<HTMLInputElement>(key);
    input.checked = Boolean(settings[key]);
    input.addEventListener('change', () => {
      void chrome.runtime.sendMessage({
        type: 'setSettings',
        settings: { [key]: input.checked },
      });
    });
  }

  $('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('review').addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'openReview' });
    window.close();
  });
  void refreshSavedCount();
  $('analyze').addEventListener('click', () => void analyseScratch());
  $('clear').addEventListener('click', () => {
    scratch.value = '';
    result.classList.add('hidden');
    scratch.focus();
  });
  scratch.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void analyseScratch();
  });

  void refreshStatus();
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

async function refreshSavedCount(): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'listSaved' })) as {
      ok: boolean;
      items?: unknown[];
    };
    const count = response?.ok ? (response.items?.length ?? 0) : 0;
    $('saved-count').textContent = count ? `(${count})` : '';
  } catch {
    // Background asleep; the button still opens the page.
  }
}

async function refreshStatus(): Promise<void> {
  setStatus('warn', 'Loading dictionaries…');
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'status' })) as
      | { ok: true; ready: boolean; dictionaryHeadwords: number; dictionaryError: string | null }
      | { ok: false; error: string };

    if (!response) throw new Error('No response');
    if (!response.ok) {
      // Still warming up: `error` carries the current progress line.
      setStatus('warn', response.error || 'Starting…');
      setTimeout(() => void refreshStatus(), 1200);
      return;
    }

    setStatus('ok', 'Ready');
    engine.textContent = response.dictionaryError
      ? 'Dictionary unavailable — romaji only'
      : `${response.dictionaryHeadwords.toLocaleString()} dictionary entries`;
  } catch (err) {
    setStatus('', err instanceof Error ? err.message : 'Unavailable');
  }
}

function setStatus(kind: 'ok' | 'warn' | '', text: string): void {
  statusDot.className = `dot${kind ? ` dot--${kind}` : ''}`;
  statusText.textContent = text;
}

async function analyseScratch(): Promise<void> {
  const text = scratch.value.trim();
  if (!text) return;

  result.classList.remove('hidden');
  result.textContent = 'Analysing…';

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'analyze',
      text,
      requestId: 'popup',
    })) as { ok: true; analysis: Analysis } | { ok: false; error: string };

    if (!response?.ok) throw new Error(response?.error ?? 'No response');
    renderResult(response.analysis);
  } catch (err) {
    result.textContent = err instanceof Error ? err.message : String(err);
  }
}

function renderResult(analysis: Analysis): void {
  result.textContent = '';

  const romaji = document.createElement('div');
  romaji.className = 'romaji';
  romaji.textContent = analysis.romaji;
  result.appendChild(romaji);

  if (analysis.kana) {
    const kana = document.createElement('div');
    kana.className = 'kana';
    kana.lang = 'ja';
    kana.textContent = analysis.kana;
    result.appendChild(kana);
  }

  if (analysis.translation) {
    const meaning = document.createElement('div');
    meaning.className = 'meaning';
    meaning.textContent = analysis.translation.text;
    result.appendChild(meaning);
  }

  for (const warning of analysis.warnings) {
    const notice = document.createElement('div');
    notice.className = 'notice';
    notice.style.marginTop = '8px';
    notice.textContent = warning;
    result.appendChild(notice);
  }
}
