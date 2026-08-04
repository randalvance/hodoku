#!/usr/bin/env node
/**
 * Builds the Chrome Web Store screenshots as standalone 1280×800 HTML pages.
 *
 * The analyser runs for real here — every romaji reading, gloss, and part of
 * speech in the output is produced by the shipped code, not mocked up.
 *
 * If a Chromium binary is available the pages are also captured to PNG at
 * 1280×800, ready to upload. Otherwise the HTML is still written and you can
 * capture it by hand.
 */

import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'store', 'assets');
const KUROMOJI_DICT = path.join(ROOT, 'node_modules', 'kuromoji', 'dict');
const JMDICT = path.join(ROOT, 'public', 'dict', 'jmdict.bin');

/** The analyser fetches its data files; in Node those are on disk. */
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('file://')) return realFetch(input, init);
  return new Response(await fs.readFile(fileURLToPath(url)), { status: 200 });
};

const SHOTS = [
  {
    file: 'preview-1-breakdown.html',
    headline: 'Every word, explained',
    subhead: 'Romaji, readings, dictionary forms, and meanings — without leaving the page.',
    passage:
      '毎朝、駅までの道を歩きながら日本語のポッドキャストを聞いています。最初は速すぎて何も分からなかったけれど、少しずつ耳が慣れてきました。今では通勤の三十分がいちばん楽しい時間になっています。',
    selection: 'ポッドキャストを聞いています',
    theme: 'light',
  },
  {
    file: 'preview-2-particles.html',
    headline: 'Particles in plain English',
    subhead: 'は, を, に, で — what each one is actually doing in the sentence.',
    passage:
      '週末は友達と新しい喫茶店に行きました。窓際の席でコーヒーを飲みながら、二時間ぐらい話していました。次はもっと早い時間に来ようと思います。',
    selection: '窓際の席でコーヒーを飲みながら',
    theme: 'light',
  },
  {
    file: 'preview-3-dark.html',
    headline: 'Hepburn romaji, done properly',
    subhead: 'Long vowels come from how a word is said — tōkyō, not toukyou.',
    passage:
      '東京駅で新幹線に乗り換えて、京都まで二時間半かかりました。車窓から富士山がきれいに見えて、写真をたくさん撮りました。',
    selection: '東京駅で新幹線に乗り換えて',
    theme: 'dark',
  },
];

const PAGE = (data, script) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.headline)}</title>
<style>
  html, body { margin: 0; padding: 0; }
  body {
    width: 1280px; height: 800px; overflow: hidden;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: ${data.theme === 'dark' ? '#15171d' : '#eef0f4'};
    color: ${data.theme === 'dark' ? '#eceef2' : '#16181d'};
    display: flex; flex-direction: column;
  }
  .caption { padding: 26px 52px 18px; }
  .caption h1 { margin: 0 0 5px; font-size: 27px; font-weight: 680; letter-spacing: -0.02em; }
  .caption p { margin: 0; font-size: 15px; opacity: 0.66; }
  .stage { flex: 1; display: flex; gap: 26px; padding: 0 52px 30px; min-height: 0; }
  .page {
    flex: 1; min-width: 0;
    background: ${data.theme === 'dark' ? '#1b1d24' : '#fff'};
    border: 1px solid ${data.theme === 'dark' ? '#32363f' : '#e2e5ea'};
    border-radius: 14px; padding: 26px 30px; overflow: hidden;
    box-shadow: 0 8px 26px -12px rgba(16,18,27,.28);
  }
  .page .kicker { font-size: 11px; letter-spacing: .09em; text-transform: uppercase; opacity: .5; }
  .page h2 { margin: 8px 0 16px; font-size: 21px; font-weight: 650; }
  .page #article {
    font-size: 17px; line-height: 2.15;
    font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif;
  }
  .page mark {
    background: ${data.theme === 'dark' ? '#3b3a64' : '#dbe4ff'};
    color: inherit; border-radius: 3px; padding: 1px 0;
  }
  #panel-host { width: 400px; flex-shrink: 0; align-self: flex-start; }
</style>
</head>
<body>
  <div class="caption">
    <h1 id="headline"></h1>
    <p id="subhead"></p>
  </div>
  <div class="stage">
    <div class="page">
      <div class="kicker">Any page, any site</div>
      <h2>読みもの</h2>
      <div id="article" lang="ja"></div>
    </div>
    <div id="panel-host"></div>
  </div>
  <script>window.__PREVIEW__ = ${JSON.stringify(data).replaceAll('<', '\\u003c')};</script>
  <script>${script}</script>
</body>
</html>
`;

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

async function main() {
  const exists = (p) => fs.stat(p).then(() => true, () => false);
  if (!(await exists(path.join(KUROMOJI_DICT, 'base.dat.gz')))) {
    throw new Error('kuromoji dictionary missing — run npm install');
  }
  const hasJmdict = await exists(JMDICT);
  if (!hasJmdict) {
    console.warn('! public/dict/jmdict.bin missing — previews will have no word meanings');
  }

  // Bundle the library for Node, then the preview renderer for the browser.
  const libFile = path.join(ROOT, '.cache', 'lib.mjs');
  await fs.mkdir(path.dirname(libFile), { recursive: true });
  await build({
    stdin: {
      contents: `export * from '${path.join(ROOT, 'src/lib/analyzer.ts').replaceAll('\\', '/')}';`,
      resolveDir: ROOT,
      sourcefile: 'entry.ts',
      loader: 'ts',
    },
    outfile: libFile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'node20',
    mainFields: ['module', 'main'],
    conditions: ['import', 'default'],
    logLevel: 'warning',
  });

  const { Analyzer, literalGloss } = await import(pathToFileURL(libFile).href);
  const analyzer = new Analyzer();
  console.log('Loading dictionaries…');
  await analyzer.init({
    tokenizerBaseUrl: pathToFileURL(KUROMOJI_DICT + path.sep).href,
    dictionaryUrl: hasJmdict ? pathToFileURL(JMDICT).href : null,
  });

  const bundle = await build({
    entryPoints: [path.join(ROOT, 'src/demo/preview.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'chrome116',
    minify: true,
    logLevel: 'warning',
  });
  const script = bundle.outputFiles[0].text;

  await fs.mkdir(OUT_DIR, { recursive: true });

  const pages = [];
  for (const shot of SHOTS) {
    const analysis = analyzer.analyze(shot.selection, 'macron');
    // Previews show the offline result. Fabricating a model translation for a
    // store screenshot would misrepresent what a user sees by default.
    const gloss = literalGloss(analysis.tokens);
    if (gloss) analysis.translation = { text: gloss, source: 'gloss' };
    delete analysis.elapsedMs;

    const html = PAGE({ ...shot, analysis }, script);
    const file = path.join(OUT_DIR, shot.file);
    await fs.writeFile(file, html);
    pages.push(file);
    console.log(`  ${path.relative(ROOT, file)}`);
  }

  await capture(pages);
}

/** Locate a Chromium that actually runs on this machine. */
async function findChromium() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fs.stat(candidate).then(() => true, () => false)) return candidate;
  }
  return null; // fall back to whatever puppeteer downloaded
}

async function capture(pages) {
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch {
    console.log('\npuppeteer is not installed — open each HTML file and capture it at 1280×800.');
    return;
  }

  const executablePath = await findChromium();
  let browser;
  try {
    browser = await puppeteer.launch({
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
    });
  } catch (err) {
    console.log(`\nCould not start Chromium (${err.message.split('\n')[0]}).`);
    console.log('The HTML previews are still written — capture them at 1280×800 by hand.');
    return;
  }

  console.log('\nCapturing PNGs…');
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

    for (const file of pages) {
      await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle0' });
      // Give the shadow DOM a frame to lay out before shooting.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
      const out = file.replace(/\.html$/, '.png');
      await page.screenshot({ path: out, type: 'png' });
      const { size } = await fs.stat(out);
      console.log(`  ${path.relative(ROOT, out)}  (${(size / 1024).toFixed(0)} KB)`);
    }
  } finally {
    await browser.close();
  }

  console.log('\nUpload these as the store screenshots (1280×800, PNG).');
}

main().catch((err) => {
  console.error(`\nScreenshot build failed: ${err.message}\n`);
  process.exit(1);
});
