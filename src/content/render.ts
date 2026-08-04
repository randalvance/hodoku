/**
 * Pure DOM rendering for the analysis panel.
 *
 * Kept free of chrome.* APIs and module-level side effects so the same code
 * renders the live panel, and the store preview pages built by
 * scripts/build-screenshots.mjs. Screenshots therefore show the real UI.
 */

import type { Analysis, AvailableProvider, WordToken } from '../lib/types';

export interface RenderOptions {
  showFurigana: boolean;
  /**
   * Providers with a key configured. Only these are offered for regeneration —
   * listing one without a key would just produce an error on click.
   */
  providers?: AvailableProvider[];
  /** Supplied only by the live panel; store previews omit it and get no control. */
  onRegenerate?: (provider: string) => void;
  /** Set while a regeneration is in flight. */
  regenerating?: boolean;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * Icon paths, drawn on a 16×16 grid.
 *
 * Drawn rather than typed: glyphs like ⧉ and ✕ are missing from plenty of font
 * stacks and fall back to a tofu box. These render identically everywhere.
 */
const ICON_PATHS: Record<string, string> = {
  copy: 'M6 6h7v7H6z M10 6V3H3v7h3',
  close: 'M4 4l8 8 M12 4l-8 8',
  check: 'M3.5 8.5l3 3 6-7',
  bookmark: 'M4 2.5h8v11l-4-3-4 3z',
};

function iconSvg(name: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', ICON_PATHS[name] ?? '');
  svg.appendChild(path);
  return svg;
}

/**
 * A square icon button. `icon` is either a key in ICON_PATHS or a literal
 * character (used for the furigana toggle, where "ふ" is the clearest label).
 */
export function iconButton(icon: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-btn';
  button.title = title;
  button.setAttribute('aria-label', title);
  if (ICON_PATHS[icon]) button.appendChild(iconSvg(icon));
  else button.textContent = icon;
  return button;
}

/** Swap a button's icon, e.g. to flash a tick after copying. */
export function setButtonIcon(button: HTMLButtonElement, icon: string): void {
  button.textContent = '';
  if (ICON_PATHS[icon]) button.appendChild(iconSvg(icon));
  else button.textContent = icon;
}

/** Kanji with their readings as <ruby>, or plain text when furigana is off. */
export function renderFurigana(token: WordToken, options: RenderOptions): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (!options.showFurigana || token.isPunctuation) {
    fragment.appendChild(document.createTextNode(token.surface));
    return fragment;
  }
  for (const segment of token.furigana) {
    if (segment.ruby) {
      const ruby = document.createElement('ruby');
      ruby.appendChild(document.createTextNode(segment.text));
      const rt = document.createElement('rt');
      rt.textContent = segment.ruby;
      ruby.appendChild(rt);
      fragment.appendChild(ruby);
    } else {
      fragment.appendChild(document.createTextNode(segment.text));
    }
  }
  return fragment;
}

/** The original sentence, with furigana, as shown in the panel header. */
export function renderSource(analysis: Analysis, options: RenderOptions): HTMLElement {
  const source = el('div', 'panel__source');
  source.lang = 'ja';
  if (options.showFurigana) {
    for (const token of analysis.tokens) source.appendChild(renderFurigana(token, options));
  } else {
    source.textContent = analysis.text;
  }
  return source;
}

/** Everything between the header and the footer. */
export function renderBody(analysis: Analysis, options: RenderOptions): HTMLElement[] {
  const nodes: HTMLElement[] = [];

  const romaji = el('div', 'romaji');
  const row = el('div', 'romaji__row');
  const romajiText = el('div', 'romaji__text');
  romajiText.textContent = analysis.romaji || '—';
  row.appendChild(romajiText);
  romaji.appendChild(row);

  if (analysis.kana && analysis.kana !== analysis.text) {
    const kana = el('div', 'romaji__kana');
    kana.lang = 'ja';
    kana.textContent = analysis.kana;
    romaji.appendChild(kana);
  }
  nodes.push(romaji);

  if (analysis.translation) {
    const section = el('div', 'section');
    const label = el('span', 'section__label');
    label.textContent = 'Meaning';
    section.appendChild(label);

    const isGloss = analysis.translation.source === 'gloss';
    const meaning = el('div', isGloss ? 'meaning meaning--gloss' : 'meaning');
    meaning.textContent = analysis.translation.text;

    const badge = el('span', 'badge-source');
    badge.textContent = isGloss ? 'word-by-word' : (analysis.translation.model ?? 'AI');
    badge.title = isGloss
      ? 'Built from dictionary glosses. Turn on AI translation in the options for a fluent sentence translation.'
      : analysis.translation.cached
        ? `Translated by ${analysis.translation.model} — reused from the local cache, no API call`
        : `Translated by ${analysis.translation.model}`;
    if (analysis.translation.cached) badge.classList.add('badge-source--cached');
    meaning.appendChild(badge);
    section.appendChild(meaning);

    if (analysis.literalTranslation) {
      const literal = el('div', 'meaning__literal');
      literal.textContent = analysis.literalTranslation;
      section.appendChild(literal);
    }
    if (analysis.grammarNote) {
      const note = el('div', 'meaning__note');
      note.textContent = analysis.grammarNote;
      section.appendChild(note);
    }

    const actions = renderRegenerate(options);
    if (actions) section.appendChild(actions);

    nodes.push(section);
  }

  if (analysis.warnings.length) {
    const wrap = el('div', 'warnings');
    for (const message of analysis.warnings) {
      const warning = el('div', 'warning');
      warning.textContent = message;
      wrap.appendChild(warning);
    }
    nodes.push(wrap);
  }

  const breakdownLabel = el('div', 'section');
  breakdownLabel.style.paddingBottom = '0';
  breakdownLabel.style.borderBottom = '0';
  const label = el('span', 'section__label');
  const wordCount = analysis.tokens.filter((t) => !t.isPunctuation).length;
  label.textContent = `Breakdown · ${wordCount} word${wordCount === 1 ? '' : 's'}`;
  breakdownLabel.appendChild(label);
  nodes.push(breakdownLabel);

  const words = el('div', 'words');
  for (const token of analysis.tokens) words.appendChild(renderWord(token, options));
  nodes.push(words);

  return nodes;
}

/** Regenerate control: a button, plus a provider picker when there is a choice. */
function renderRegenerate(options: RenderOptions): HTMLElement | null {
  const providers = options.providers ?? [];
  if (!options.onRegenerate || !providers.length) return null;

  const row = el('div', 'meaning__actions');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mini-btn';
  button.disabled = Boolean(options.regenerating);
  button.textContent = options.regenerating ? 'Regenerating…' : 'Regenerate';
  button.title = 'Ask again, ignoring the cached result';

  // With one configured provider there is nothing to choose, so the button
  // simply says which one it will use.
  if (providers.length === 1) {
    button.addEventListener('click', () => options.onRegenerate?.(providers[0].id));
    row.append(button, labelFor(providers[0]));
    return row;
  }

  const select = document.createElement('select');
  select.className = 'mini-select';
  select.title = 'Which provider to ask';
  for (const provider of providers) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.label;
    option.title = provider.model;
    select.appendChild(option);
  }
  select.disabled = Boolean(options.regenerating);

  button.addEventListener('click', () => options.onRegenerate?.(select.value));
  row.append(button, select);
  return row;
}

function labelFor(provider: AvailableProvider): HTMLElement {
  const label = el('span', 'meaning__provider');
  label.textContent = provider.label;
  label.title = provider.model;
  return label;
}

export function renderWord(token: WordToken, options: RenderOptions): HTMLElement {
  const word = el('div', token.isPunctuation ? 'word word--punct' : 'word');

  const surface = el('div', 'word__surface');
  surface.lang = 'ja';
  surface.appendChild(renderFurigana(token, options));
  word.appendChild(surface);

  const main = el('div', 'word__main');

  const romaji = el('div', 'word__romaji');
  romaji.textContent = token.romaji || token.surface;
  main.appendChild(romaji);

  const meta = el('div', 'word__meta');
  const posTag = el('span', token.common ? 'tag tag--common' : 'tag');
  posTag.textContent = token.posDetail ?? token.pos;
  if (token.common) posTag.title = 'Common word in JMdict';
  meta.appendChild(posTag);

  if (token.inflection && token.inflection !== 'Dictionary form') {
    const infl = el('span', 'tag');
    infl.textContent = token.inflection;
    meta.appendChild(infl);
  }

  if (token.dictionaryForm) {
    const dict = el('span', 'tag tag--dict');
    dict.lang = 'ja';
    dict.textContent = token.dictionaryFormRomaji
      ? `from ${token.dictionaryForm} (${token.dictionaryFormRomaji})`
      : `from ${token.dictionaryForm}`;
    meta.appendChild(dict);
  }

  if (meta.childElementCount) main.appendChild(meta);

  if (token.glosses.length) {
    const glosses = el('div', 'word__glosses');
    glosses.textContent = token.glosses.slice(0, 4).join('; ');
    main.appendChild(glosses);
  }

  if (token.note) {
    const note = el('div', 'word__note');
    note.textContent = token.note;
    main.appendChild(note);
  }

  word.appendChild(main);
  return word;
}

export function renderFooter(analysis: Analysis): HTMLElement {
  const foot = el('div', 'panel__foot');
  const left = el('span');
  left.textContent = analysis.elapsedMs !== undefined ? `Analysed in ${analysis.elapsedMs} ms` : '';
  foot.appendChild(left);
  return foot;
}

export function loadingState(): HTMLElement {
  const state = el('div', 'state');
  state.appendChild(el('div', 'spinner'));
  const text = el('span');
  text.textContent = 'Analysing… the first lookup after a restart loads the dictionaries.';
  state.appendChild(text);
  return state;
}

export function errorState(message: string): HTMLElement {
  const state = el('div', 'state');
  const text = el('span');
  text.textContent = message;
  state.appendChild(text);
  return state;
}
