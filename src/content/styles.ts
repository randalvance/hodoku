/**
 * Styles for the in-page UI. These live inside a shadow root, so page CSS
 * cannot reach them and they cannot leak onto the page.
 */
export const PANEL_STYLES = /* css */ `
:host {
  all: initial;
}

*, *::before, *::after { box-sizing: border-box; }

.root {
  --rr-bg: #ffffff;
  --rr-bg-soft: #f6f7f9;
  --rr-fg: #16181d;
  --rr-fg-muted: #5f6672;
  --rr-fg-faint: #878e9a;
  --rr-border: #e2e5ea;
  --rr-accent: #4f46e5;
  --rr-accent-soft: #eef2ff;
  --rr-warn-bg: #fff7ed;
  --rr-warn-fg: #9a3412;
  --rr-shadow: 0 12px 32px -8px rgba(16, 18, 27, 0.22), 0 2px 8px rgba(16, 18, 27, 0.08);

  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--rr-fg);
  -webkit-font-smoothing: antialiased;
}

.root[data-theme="dark"] {
  --rr-bg: #1b1d24;
  --rr-bg-soft: #22252e;
  --rr-fg: #eceef2;
  --rr-fg-muted: #a5abb8;
  --rr-fg-faint: #7d8492;
  --rr-border: #32363f;
  --rr-accent: #a5b4fc;
  --rr-accent-soft: #2a2f45;
  --rr-warn-bg: #3a2a17;
  --rr-warn-fg: #fdba74;
  --rr-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.35);
}

/* --------------------------------- trigger -------------------------------- */

.trigger {
  position: fixed;
  z-index: 2147483646;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px 6px 9px;
  border: 1px solid var(--rr-border);
  border-radius: 999px;
  background: var(--rr-bg);
  color: var(--rr-fg);
  box-shadow: var(--rr-shadow);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  animation: rr-pop 120ms ease-out;
}

.trigger:hover { background: var(--rr-accent-soft); border-color: var(--rr-accent); }
.trigger:focus-visible { outline: 2px solid var(--rr-accent); outline-offset: 2px; }

.trigger .mark {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--rr-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

@keyframes rr-pop {
  from { opacity: 0; transform: translateY(3px) scale(0.96); }
  to { opacity: 1; transform: none; }
}

/* ---------------------------------- panel --------------------------------- */

.panel {
  position: fixed;
  z-index: 2147483647;
  width: 400px;
  max-width: calc(100vw - 24px);
  max-height: min(70vh, 620px);
  display: flex;
  flex-direction: column;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  border-radius: 14px;
  box-shadow: var(--rr-shadow);
  overflow: hidden;
  animation: rr-pop 140ms ease-out;
}

.panel__head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 12px 10px 14px;
  border-bottom: 1px solid var(--rr-border);
  background: var(--rr-bg-soft);
}

.panel__source {
  flex: 1;
  min-width: 0;
  font-size: 17px;
  line-height: 1.7;
  word-break: break-word;
}

.panel__actions { display: flex; gap: 2px; flex-shrink: 0; }

.icon-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--rr-fg-muted);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}
.icon-btn:hover { background: var(--rr-accent-soft); color: var(--rr-fg); }
.icon-btn:focus-visible { outline: 2px solid var(--rr-accent); outline-offset: 1px; }
.icon-btn[aria-pressed="true"] { background: var(--rr-accent-soft); color: var(--rr-accent); }
.icon-btn svg { width: 15px; height: 15px; display: block; }
/* A saved item shows a filled bookmark, so the state is readable at a glance. */
.icon-btn[data-saved="true"] { color: var(--rr-accent); }
.icon-btn[data-saved="true"] svg path { fill: currentColor; }

.panel__body {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 0 8px;
}

/* --------------------------------- romaji --------------------------------- */

.romaji {
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--rr-border);
}

.romaji__text {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.005em;
  word-break: break-word;
  user-select: text;
}

.romaji__kana {
  margin-top: 5px;
  font-size: 13px;
  color: var(--rr-fg-muted);
  word-break: break-word;
}

.romaji__row { display: flex; align-items: flex-start; gap: 8px; }
.romaji__row .icon-btn { margin-top: 1px; }

/* -------------------------------- meaning --------------------------------- */

.section { padding: 12px 14px; border-bottom: 1px solid var(--rr-border); }
.section:last-child { border-bottom: 0; }

.section__label {
  display: block;
  margin-bottom: 6px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--rr-fg-faint);
}

.meaning { font-size: 15px; }

.meaning--gloss {
  font-size: 14px;
  color: var(--rr-fg-muted);
}

.meaning__literal {
  margin-top: 7px;
  padding-left: 9px;
  border-left: 2px solid var(--rr-border);
  font-size: 13px;
  color: var(--rr-fg-muted);
}

.meaning__note {
  margin-top: 8px;
  padding: 7px 9px;
  border-radius: 8px;
  background: var(--rr-accent-soft);
  font-size: 12.5px;
  color: var(--rr-fg-muted);
}

.badge-source {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--rr-bg-soft);
  border: 1px solid var(--rr-border);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--rr-fg-faint);
  text-transform: uppercase;
  vertical-align: 2px;
}

.meaning__actions {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 9px;
}

.mini-btn, .mini-select {
  padding: 3px 9px;
  border: 1px solid var(--rr-border);
  border-radius: 7px;
  background: var(--rr-bg);
  color: var(--rr-fg-muted);
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  cursor: pointer;
}

.mini-btn:hover:not(:disabled), .mini-select:hover {
  border-color: var(--rr-accent);
  color: var(--rr-accent);
}
.mini-btn:disabled { opacity: 0.6; cursor: default; }
.mini-btn:focus-visible, .mini-select:focus-visible {
  outline: 2px solid var(--rr-accent);
  outline-offset: 1px;
}

.meaning__provider { font-size: 11.5px; color: var(--rr-fg-faint); }

/* A dot marks a translation that cost nothing to show. */
.badge-source--cached::after {
  content: "";
  display: inline-block;
  width: 4px;
  height: 4px;
  margin-left: 4px;
  border-radius: 50%;
  background: currentColor;
  vertical-align: 1px;
  opacity: 0.6;
}

/* ------------------------------- breakdown -------------------------------- */

.words { display: flex; flex-direction: column; }

.word {
  display: grid;
  grid-template-columns: minmax(72px, auto) 1fr;
  gap: 4px 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--rr-border);
}
.word:last-child { border-bottom: 0; }
.word:hover { background: var(--rr-bg-soft); }

.word__surface {
  font-size: 18px;
  line-height: 1.9;
  white-space: nowrap;
}

.word__surface ruby { ruby-position: over; }
.word__surface rt {
  font-size: 0.5em;
  color: var(--rr-fg-muted);
  font-weight: 400;
}

.word__main { min-width: 0; }

.word__romaji {
  font-size: 14px;
  font-weight: 600;
}

.word__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 3px;
}

.tag {
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--rr-bg-soft);
  border: 1px solid var(--rr-border);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--rr-fg-muted);
  white-space: nowrap;
}

.tag--common { color: var(--rr-accent); border-color: var(--rr-accent); }
.tag--dict { font-weight: 500; }

.word__glosses {
  margin-top: 4px;
  font-size: 13px;
  color: var(--rr-fg-muted);
}

.word__note {
  margin-top: 4px;
  font-size: 12px;
  color: var(--rr-fg-faint);
}

.word--punct { opacity: 0.55; }

/* -------------------------------- states ---------------------------------- */

.state {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 18px 14px;
  font-size: 13px;
  color: var(--rr-fg-muted);
}

.spinner {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 2px solid var(--rr-border);
  border-top-color: var(--rr-accent);
  border-radius: 50%;
  animation: rr-spin 700ms linear infinite;
}

@keyframes rr-spin { to { transform: rotate(360deg); } }

.warnings { padding: 8px 14px 10px; }

.warning {
  padding: 7px 9px;
  border-radius: 8px;
  background: var(--rr-warn-bg);
  color: var(--rr-warn-fg);
  font-size: 12px;
}
.warning + .warning { margin-top: 5px; }

.panel__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 7px 12px;
  border-top: 1px solid var(--rr-border);
  background: var(--rr-bg-soft);
  font-size: 11px;
  color: var(--rr-fg-faint);
}

.panel__foot > span:first-child { margin-right: auto; }

.link-btn {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--rr-fg-muted);
  text-decoration: underline;
  cursor: pointer;
}
.link-btn:hover { color: var(--rr-accent); }

@media (prefers-reduced-motion: reduce) {
  .trigger, .panel { animation: none; }
  .spinner { animation-duration: 2s; }
}
`;
