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
  --rr-scrollbar: #c6cad2;
  /* The extension icon's gradient (scripts/build-icons.mjs), so the mark on
     the trigger is recognisably the same thing. Fixed, not themed: in dark
     mode the accent turns pale, and the icon does not. */
  --rr-mark: linear-gradient(180deg, #635bff, #4633d9);

  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--rr-fg);
  -webkit-font-smoothing: antialiased;
  /* Native scrollbars and form controls follow the panel's theme, not the page's. */
  color-scheme: light;
}

.root[data-theme="dark"] {
  color-scheme: dark;
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
  --rr-scrollbar: #4a505e;
}

/* Scrollbars in the panel's own colours. color-scheme alone leaves them to
   the platform, which on some setups still paints them light on dark. */
.root ::-webkit-scrollbar { width: 10px; height: 10px; }
.root ::-webkit-scrollbar-track { background: transparent; }
.root ::-webkit-scrollbar-thumb {
  background: var(--rr-scrollbar);
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}
.root ::-webkit-scrollbar-thumb:hover { background-color: var(--rr-fg-faint); }

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
  background: var(--rr-mark);
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
  width: 760px;
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

/* A finished analysis splits into columns that scroll independently:
   reading and meaning on the left, the breakdown beside it, and the question
   thread as a third column while it is open. The header above spans all. */
.panel__body--split {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  overflow: hidden;
  padding: 0;
}

.panel__body--chat { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr); }
.panel:has(.panel__body--chat) { width: 1100px; }

.panel__main, .panel__side {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: 8px;
}

.panel__side, .panel__chat { border-left: 1px solid var(--rr-border); }

/* Too narrow for columns: stack them and scroll the body as one. */
@media (max-width: 800px) {
  .panel, .panel:has(.panel__body--chat) { width: 400px; }
  .panel__body--split { display: block; overflow-y: auto; }
  .panel__main, .panel__side { overflow: visible; }
  .panel__side, .panel__chat { border-left: 0; }
  .panel__chat { border-top: 1px solid var(--rr-border); }
  .chat__log { overflow: visible; }
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

/* The templated notes: one tinted block per section that has something to say. */
.meaning__explanation {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.explanation__section {
  padding: 7px 9px;
  border-radius: 8px;
  background: var(--rr-accent-soft);
  font-size: 12.5px;
  color: var(--rr-fg-muted);
}

.explanation__label {
  display: block;
  margin-bottom: 2px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--rr-accent);
}

.explanation__list { margin: 0; padding-left: 16px; }
.explanation__list li + li { margin-top: 2px; }

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

/* Fields the model produced, as opposed to the offline analyser. */
.badge-source--ai { color: var(--rr-accent); border-color: var(--rr-accent); }
.romaji__row .badge-source { margin-top: 5px; flex-shrink: 0; }
.section__label .badge-source { vertical-align: 0; }

/* ---------------------------------- chat ---------------------------------- */

.panel__chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 8px 6px 14px;
  border-bottom: 1px solid var(--rr-border);
}
.chat__head .section__label { margin-bottom: 0; }

.chat__log {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.chat__hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--rr-fg-faint);
}

/* Bubbles: questions on the right, answers on the left, as in any chat. */
.ask__q, .ask__a, .ask__err, .ask__pending {
  max-width: 90%;
  padding: 7px 10px;
  border-radius: 12px;
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.ask__q {
  align-self: flex-end;
  border-bottom-right-radius: 3px;
  background: var(--rr-accent-soft);
  color: var(--rr-fg);
}

.ask__a {
  align-self: flex-start;
  border-bottom-left-radius: 3px;
  background: var(--rr-bg-soft);
  border: 1px solid var(--rr-border);
  color: var(--rr-fg);
  user-select: text;
}

.ask__err {
  align-self: flex-start;
  border-bottom-left-radius: 3px;
  background: var(--rr-warn-bg);
  color: var(--rr-warn-fg);
}

.ask__pending {
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--rr-fg-faint);
}

.chat__form {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 8px 12px 10px;
  border-top: 1px solid var(--rr-border);
  background: var(--rr-bg);
}

.ask__input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  background: var(--rr-bg);
  color: var(--rr-fg);
  font: inherit;
  font-size: 12.5px;
  line-height: 1.4;
  resize: none;
}
.ask__input::placeholder { color: var(--rr-fg-faint); }
.ask__input:focus-visible { outline: 2px solid var(--rr-accent); outline-offset: 1px; }
.ask__input:disabled { opacity: 0.6; }

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
