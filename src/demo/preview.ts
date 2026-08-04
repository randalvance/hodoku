/**
 * Renders a store preview page from real analyser output.
 *
 * The page is built by scripts/build-screenshots.mjs, which runs the actual
 * analyser over the sample sentences and injects the results as
 * `window.__PREVIEW__`. Rendering goes through the same functions as the live
 * panel, so a screenshot of this page is a screenshot of the real UI.
 */

import { renderBody, renderFooter, renderSource, iconButton, el } from '../content/render';
import { PANEL_STYLES } from '../content/styles';
import type { Analysis } from '../lib/types';

interface PreviewData {
  /** Paragraph shown behind the panel. */
  passage: string;
  /** The part of the passage that is "selected". */
  selection: string;
  /** Caption strip at the top of the shot. */
  headline: string;
  subhead: string;
  theme: 'light' | 'dark';
  analysis: Analysis;
}

declare global {
  interface Window {
    __PREVIEW__: PreviewData;
  }
}

const data = window.__PREVIEW__;

/* --------------------------- page behind the panel ------------------------- */

const article = document.getElementById('article') as HTMLElement;
const [before, ...rest] = data.passage.split(data.selection);
const after = rest.join(data.selection);

article.appendChild(document.createTextNode(before));
const mark = document.createElement('mark');
mark.textContent = data.selection;
article.appendChild(mark);
article.appendChild(document.createTextNode(after));

(document.getElementById('headline') as HTMLElement).textContent = data.headline;
(document.getElementById('subhead') as HTMLElement).textContent = data.subhead;

/* -------------------------------- the panel -------------------------------- */

const host = document.getElementById('panel-host') as HTMLElement;
const shadow = host.attachShadow({ mode: 'open' });

const style = document.createElement('style');
style.textContent = PANEL_STYLES;
shadow.appendChild(style);

const root = el('div', 'root');
root.dataset.theme = data.theme;
shadow.appendChild(root);

const panel = el('div', 'panel');
// The live panel is positioned against the selection; here the page lays it
// out. A percentage max-height would not resolve (no ancestor has a height), so
// the cap is explicit — it matches what the panel gets in a 800px-tall window.
panel.style.position = 'static';
panel.style.maxHeight = '620px';
panel.style.animation = 'none';

const options = { showFurigana: true };

const head = el('div', 'panel__head');
head.appendChild(renderSource(data.analysis, options));
const actions = el('div', 'panel__actions');
const furigana = iconButton('ふ', 'Toggle furigana');
furigana.setAttribute('aria-pressed', 'true');
actions.append(furigana, iconButton('copy', 'Copy romaji'), iconButton('close', 'Close'));
head.appendChild(actions);
panel.appendChild(head);

const body = el('div', 'panel__body');
renderBody(data.analysis, options).forEach((node) => body.appendChild(node));
panel.appendChild(body);

panel.appendChild(renderFooter(data.analysis));
root.appendChild(panel);
