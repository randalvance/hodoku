#!/usr/bin/env node
/**
 * Renders candidate store icons so they can be compared before one is chosen.
 *
 * Exploration tool, not part of the build: once a design is picked it gets
 * frozen into scripts/build-icons.mjs, which generates the shipped icon set
 * deterministically without a browser.
 *
 * Output: store/assets/icon-options/ — one PNG per candidate at 128px, plus a
 * contact sheet showing each at 128 and at 16, because an icon that reads well
 * large and turns to mush in the toolbar is not a real candidate.
 *
 *   node scripts/icon-options.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'store', 'assets', 'icon-options');

/** One palette across every candidate, so the mark is what is being compared. */
const BG_TOP = '#635bff';
const BG_BOTTOM = '#4633d9';
const FG = '#ffffff';

/**
 * Each candidate is the inner markup of a 128×128 SVG. The rounded-square
 * background and the gradient are added around it.
 */
const CANDIDATES = [
  {
    id: 'a-macron',
    name: 'Ā — macron A',
    note: 'The current mark. Says "romaji", says nothing about Hodoku.',
    body: `
      <path d="M38 30 H90" stroke="${FG}" stroke-width="9.5" stroke-linecap="round"/>
      <path d="M30 102 L64 47 L98 102" stroke="${FG}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M43 81 H85" stroke="${FG}" stroke-width="11" stroke-linecap="round"/>`,
  },
  {
    id: 'kana-ho',
    name: 'ほ — first kana of Hodoku',
    note: 'Names the product in kana. Unmistakably Japanese at any size.',
    text: 'ほ',
  },
  {
    id: 'kana-a',
    name: 'あ — the in-app mark',
    note: 'Matches the あ badge already used in the panel and options page.',
    text: 'あ',
  },
  {
    id: 'kanji-hodoku',
    name: '解 — the kanji of hodoku',
    note: 'Literal, but dense: 13 strokes turn to grey mush at 16px.',
    text: '解',
  },
  {
    id: 'unravel',
    name: 'Unravel — tangle to line',
    note: 'A knotted line resolving into a straight one. Literally what it does.',
    body: `
      <path d="M24 64 c9 -21, 18 21, 27 0 c9 -21, 18 21, 27 0 h26"
        stroke="${FG}" stroke-width="10" stroke-linecap="round" fill="none"/>`,
  },
  {
    id: 'loop-tail',
    name: 'Loop with a loose tail',
    note: 'A knot mid-pull. Abstract, distinctive, reads at small sizes.',
    body: `
      <circle cx="54" cy="64" r="22" stroke="${FG}" stroke-width="10" fill="none"/>
      <path d="M72 52 c18 6, 24 22, 30 30" stroke="${FG}" stroke-width="10" stroke-linecap="round" fill="none"/>`,
  },
  {
    id: 'lines-unravel',
    name: 'Text lines, one coming loose',
    note: 'Lines of text with the last one unravelling. Reads as "text, undone".',
    body: `
      <path d="M30 42 H98" stroke="${FG}" stroke-width="10" stroke-linecap="round"/>
      <path d="M30 64 H84" stroke="${FG}" stroke-width="10" stroke-linecap="round"/>
      <path d="M30 86 c10 -14, 20 14, 30 0 c8 -11, 16 8, 24 2"
        stroke="${FG}" stroke-width="10" stroke-linecap="round" fill="none"/>`,
  },
  {
    id: 'thread-through',
    name: 'Thread through a loop',
    note: 'Minimal knot: one stroke passing through a loop, being drawn out.',
    body: `
      <path d="M26 64 h30" stroke="${FG}" stroke-width="10" stroke-linecap="round"/>
      <circle cx="74" cy="64" r="20" stroke="${FG}" stroke-width="10" fill="none"/>
      <path d="M94 44 L106 32" stroke="${FG}" stroke-width="10" stroke-linecap="round"/>`,
  },
];

function svg(candidate, size) {
  const inner = candidate.text
    ? `<text x="64" y="64" text-anchor="middle" dominant-baseline="central"
         font-family="'Noto Sans JP','Hiragino Sans',sans-serif"
         font-size="${candidate.id === 'kanji-hodoku' ? 68 : 76}" font-weight="600"
         fill="${FG}">${candidate.text}</text>`
    : candidate.body;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}">
  <defs><linearGradient id="g-${candidate.id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOTTOM}"/>
  </linearGradient></defs>
  <rect width="128" height="128" rx="29" fill="url(#g-${candidate.id})"/>
  ${inner}
</svg>`;
}

function sheet() {
  const cells = CANDIDATES.map(
    (c, i) => `
    <div class="cell">
      <div class="row">
        <div class="big">${svg(c, 128)}</div>
        <div class="smalls">
          <div class="chip">${svg(c, 48)}<span>48</span></div>
          <div class="chip">${svg(c, 16)}<span>16</span></div>
        </div>
      </div>
      <div class="label"><b>${i + 1}. ${c.name}</b><span>${c.note}</span></div>
    </div>`,
  ).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#f3f4f7;
      font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#16181d}
    body{width:1180px;padding:30px 34px}
    h1{margin:0 0 4px;font-size:21px;font-weight:680}
    p.lede{margin:0 0 22px;font-size:13.5px;color:#5f6672}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
    .cell{background:#fff;border:1px solid #e2e5ea;border-radius:14px;padding:18px 20px}
    .row{display:flex;align-items:center;gap:20px}
    .big{line-height:0}
    .smalls{display:flex;align-items:flex-end;gap:14px}
    .chip{display:flex;flex-direction:column;align-items:center;gap:5px;line-height:0}
    .chip span{font-size:10px;color:#878e9a;line-height:1}
    .label{margin-top:14px}
    .label b{display:block;font-size:14px;font-weight:620}
    .label span{display:block;margin-top:3px;font-size:12.5px;color:#5f6672;line-height:1.45}
  </style></head><body>
    <h1>Hodoku — store icon candidates</h1>
    <p class="lede">Same palette throughout, so the mark is what differs. Shown at 128, 48 and 16 px — the toolbar renders 16.</p>
    <div class="grid">${cells}</div>
  </body></html>`;
}

async function findChromium() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const c of candidates) {
    if (await fs.stat(c).then(() => true, () => false)) return c;
  }
  return null;
}

async function main() {
  const puppeteer = (await import('puppeteer')).default;
  const executablePath = await findChromium();
  const browser = await puppeteer.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });

  try {
    await fs.mkdir(OUT_DIR, { recursive: true });
    const page = await browser.newPage();

    // One PNG per candidate, ready to drop straight into the dashboard.
    for (const candidate of CANDIDATES) {
      await page.setViewport({ width: 128, height: 128, deviceScaleFactor: 1 });
      await page.setContent(
        `<html><body style="margin:0">${svg(candidate, 128)}</body></html>`,
        { waitUntil: 'load' },
      );
      const file = path.join(OUT_DIR, `${candidate.id}-128.png`);
      await page.screenshot({ path: file, omitBackground: true });
      console.log(`  ${path.relative(ROOT, file)}`);
    }

    await page.setViewport({ width: 1180, height: 900, deviceScaleFactor: 2 });
    await page.setContent(sheet(), { waitUntil: 'load' });
    const sheetFile = path.join(OUT_DIR, 'contact-sheet.png');
    await page.screenshot({ path: sheetFile, fullPage: true });
    console.log(`\n  ${path.relative(ROOT, sheetFile)}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`\nIcon options failed: ${err.message}\n`);
  process.exit(1);
});
