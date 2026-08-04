#!/usr/bin/env node
/**
 * Builds the Chrome Web Store screenshots.
 *
 * Every frame is a capture of the *real* extension running in a real Chrome:
 * the panel is opened by selecting text and clicking, and the review pages are
 * the actual extension pages after actually saving items. Nothing is mocked, so
 * a screenshot cannot drift from what the extension does.
 *
 * Each capture is then composited into a 1280×800 frame with a caption, which
 * is the size the store wants.
 *
 * Deliberately no AI translation anywhere in these shots: it is off by default,
 * so the offline word-by-word gloss is what a new user actually sees. Showing a
 * fluent model translation would misrepresent the default experience.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = path.join(ROOT, 'store', 'assets');

/**
 * Size of the inner capture. Taller than it is displayed: the panel caps at
 * 70vh, so capturing at 700 gives it room to show a real amount of the
 * breakdown, and the frame then scales the result down to fit 1280×800.
 */
const APP_WIDTH = 1000;
const APP_HEIGHT = 700;
const FRAME_WIDTH = 950;
const FRAME_HEIGHT = 665;

/** Sample passages. The selection is what gets analysed. */
const PASSAGES = {
  podcast: {
    heading: '読みもの',
    text: '毎朝、駅までの道を歩きながら日本語のポッドキャストを聞いています。最初は速すぎて何も分からなかったけれど、少しずつ耳が慣れてきました。',
    selection: 'ポッドキャストを聞いています',
  },
  cafe: {
    heading: '日記',
    text: '週末は友達と新しい喫茶店に行きました。窓際の席でコーヒーを飲みながら、二時間ぐらい話していました。',
    selection: '窓際の席でコーヒーを飲みながら',
  },
  train: {
    heading: '旅行記',
    text: '東京駅で新幹線に乗り換えて、京都まで二時間半かかりました。車窓から富士山がきれいに見えました。',
    selection: '東京駅で新幹線に乗り換えて',
  },
};

const CAPTIONS = [
  {
    file: 'preview-1-breakdown.png',
    headline: 'Every word, explained',
    subhead: 'Romaji, readings, dictionary forms and meanings — without leaving the page.',
  },
  {
    file: 'preview-2-particles.png',
    headline: 'Particles in plain English',
    subhead: 'は, を, に, で — what each one is actually doing in the sentence.',
  },
  {
    file: 'preview-3-dark.png',
    headline: 'Hepburn romaji, done properly',
    subhead: 'Long vowels come from how a word is said — tōkyō, not toukyou.',
  },
  {
    file: 'preview-4-saved.png',
    headline: 'Save anything worth revisiting',
    subhead: 'Your own review list, with the full breakdown one click away.',
  },
  {
    file: 'preview-5-study.png',
    headline: 'Study what you saved',
    subhead: 'Flashcard review built in — or export to Anki whenever you like.',
  },
];

/* ------------------------------- sample page ------------------------------ */

function samplePage(key, dark) {
  const passage = PASSAGES[key];
  const bg = dark ? '#15171d' : '#ffffff';
  const fg = dark ? '#e7e9ee' : '#1a1c22';
  const muted = dark ? '#8b93a1' : '#6b7280';
  const mark = dark ? '#3b3a64' : '#dbe4ff';
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>${passage.heading}</title>
<style>
  html,body{margin:0;background:${bg};color:${fg}}
  body{font-family:"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif;padding:44px 56px}
  .kicker{font-family:ui-sans-serif,system-ui,sans-serif;font-size:11px;letter-spacing:.09em;
    text-transform:uppercase;color:${muted}}
  h1{margin:10px 0 22px;font-size:23px;font-weight:650}
  p{font-size:17px;line-height:2.2;margin:0;max-width:31em}
  ::selection{background:${mark}}
</style></head>
<body>
  <div class="kicker">Any page, any site</div>
  <h1>${passage.heading}</h1>
  <p id="target">${passage.text}</p>
</body></html>`;
}

/* --------------------------------- framing -------------------------------- */

/** Fit a capture inside the stage, preserving its aspect ratio. */
function fitted(width, height) {
  let w = FRAME_WIDTH;
  let h = Math.round((FRAME_WIDTH * height) / width);
  if (h > FRAME_HEIGHT) {
    h = FRAME_HEIGHT;
    w = Math.round((FRAME_HEIGHT * width) / height);
  }
  return { w, h };
}

function framePage(caption, dataUri, dark, size) {
  const bg = dark ? '#15171d' : '#eef0f4';
  const fg = dark ? '#eceef2' : '#16181d';
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0}
  body{width:1280px;height:800px;overflow:hidden;background:${bg};color:${fg};
    display:flex;flex-direction:column;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .caption{padding:24px 60px 14px}
  .caption h1{margin:0 0 5px;font-size:27px;font-weight:680;letter-spacing:-.02em}
  .caption p{margin:0;font-size:15px;opacity:.66}
  .stage{flex:1;display:grid;place-items:center;padding:0 60px 26px}
  img{width:${size.w}px;height:${size.h}px;display:block;border-radius:12px;
    border:1px solid ${dark ? '#32363f' : '#dfe3ea'};
    box-shadow:0 18px 44px -16px rgba(16,18,27,.45)}
</style></head>
<body>
  <div class="caption"><h1>${escapeHtml(caption.headline)}</h1><p>${escapeHtml(caption.subhead)}</p></div>
  <div class="stage"><img src="${dataUri}"></div>
</body></html>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/* --------------------------------- driver --------------------------------- */

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
  return null;
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const key = url.pathname.slice(1) || 'podcast';
      // Chrome also asks for /favicon.ico; anything that is not a passage 404s.
      if (!PASSAGES[key]) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(samplePage(key, url.searchParams.has('dark')));
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` }),
    );
  });
}

async function main() {
  if (!(await fs.stat(path.join(DIST, 'manifest.json')).then(() => true, () => false))) {
    throw new Error('dist/ not built — run `npm run build` first');
  }

  const puppeteer = (await import('puppeteer')).default;
  const executablePath = await findChromium();
  const { server, base } = await serve();

  const browser = await puppeteer.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--force-color-profile=srgb',
      '--hide-scrollbars',
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
    ],
  });

  try {
    const target = await browser.waitForTarget((t) => t.url().startsWith('chrome-extension://'), {
      timeout: 30_000,
    });
    const extensionId = target.url().split('/')[2];

    const page = await browser.newPage();
    await page.setViewport({ width: APP_WIDTH, height: APP_HEIGHT, deviceScaleFactor: 2 });

    /** Settings are written through the extension's own storage. */
    const control = await browser.newPage();
    await control.goto(`chrome-extension://${extensionId}/options/options.html`, {
      waitUntil: 'domcontentloaded',
    });
    const setTheme = (theme) =>
      control.evaluate((t) => chrome.storage.local.set({ theme: t }), theme);

    const clickBox = (box) => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    /** Select the sample sentence and open the panel on it. */
    async function openPanel(key, dark, scrollBody = 0) {
      await setTheme(dark ? 'dark' : 'light');
      await page.goto(`${base}/${key}${dark ? '?dark' : ''}`, { waitUntil: 'domcontentloaded' });

      const selection = PASSAGES[key].selection;
      for (let attempt = 0; attempt < 80; attempt++) {
        // The content script installs at document_idle; retry rather than race.
        await page.evaluate((needle) => {
          const node = document.getElementById('target');
          const index = node.textContent.indexOf(needle);
          const range = document.createRange();
          range.setStart(node.firstChild, index);
          range.setEnd(node.firstChild, index + needle.length);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        }, selection);

        const box = await page.evaluate(() => {
          const node = document.getElementById('hodoku-host')?.shadowRoot?.querySelector('.trigger');
          if (!node) return null;
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        });
        if (box) {
          await clickBox(box);
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      await page.waitForFunction(
        () =>
          document.getElementById('hodoku-host')?.shadowRoot?.querySelector('.romaji__text')
            ?.textContent?.length > 0,
        { timeout: 90_000, polling: 250 },
      );
      // The breakdown scrolls inside the panel. Scrolling to the rows a caption
      // is talking about is what a user would do, and keeps the claim honest.
      if (scrollBody) {
        await page.evaluate((offset) => {
          const body = document
            .getElementById('hodoku-host')
            .shadowRoot.querySelector('.panel__body');
          body.scrollTop = offset;
        }, scrollBody);
      }
      // Let the panel settle into its final position before capturing.
      await new Promise((r) => setTimeout(r, 400));
      return page.screenshot({ encoding: 'base64' });
    }

    /** Save a sentence so the review pages have something real to show. */
    async function save(key) {
      await openPanel(key, false);
      const box = await page.evaluate(() => {
        const node = document
          .getElementById('hodoku-host')
          .shadowRoot.querySelector('.icon-btn[data-saved]');
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      });
      await clickBox(box);
      await page.waitForFunction(
        () =>
          document.getElementById('hodoku-host')?.shadowRoot?.querySelector(
            '.icon-btn[data-saved="true"]',
          ) != null,
        { timeout: 15_000 },
      );
    }

    const captures = [];

    console.log('Capturing the panel…');
    const panelSize = { width: APP_WIDTH, height: APP_HEIGHT };
    captures.push({ caption: CAPTIONS[0], data: await openPanel('podcast', false), dark: false, ...panelSize });
    captures.push({ caption: CAPTIONS[1], data: await openPanel('cafe', false, 300), dark: false, ...panelSize });
    captures.push({ caption: CAPTIONS[2], data: await openPanel('train', true), dark: true, ...panelSize });

    console.log('Saving sentences for the review pages…');
    await setTheme('light');
    for (const key of Object.keys(PASSAGES)) await save(key);

    console.log('Capturing the review page…');
    const review = await browser.newPage();
    await review.setViewport({ width: APP_WIDTH, height: APP_HEIGHT, deviceScaleFactor: 2 });
    await review.goto(`chrome-extension://${extensionId}/review/review.html`, {
      waitUntil: 'domcontentloaded',
    });
    await review.waitForSelector('.item', { timeout: 20_000 });
    await review.waitForFunction(() => document.querySelectorAll('.item').length >= 3, {
      timeout: 20_000,
    });
    await new Promise((r) => setTimeout(r, 300));
    captures.push({
      caption: CAPTIONS[3],
      data: await review.screenshot({ encoding: 'base64' }),
      dark: false,
      width: APP_WIDTH,
      height: APP_HEIGHT,
    });

    console.log('Capturing study mode…');
    const STUDY_HEIGHT = 500;
    await review.setViewport({ width: APP_WIDTH, height: STUDY_HEIGHT, deviceScaleFactor: 2 });
    await review.reload({ waitUntil: 'domcontentloaded' });
    await review.waitForSelector('#study');
    await review.click('#study');
    await review.waitForSelector('.study__ja', { timeout: 15_000 });
    await review.evaluate(() => {
      [...document.querySelectorAll('.study button')]
        .find((b) => b.textContent.includes('Show'))
        ?.click();
    });
    await review.waitForSelector('.study__romaji', { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 300));
    captures.push({
      caption: CAPTIONS[4],
      data: await review.screenshot({ encoding: 'base64' }),
      dark: false,
      width: APP_WIDTH,
      height: STUDY_HEIGHT,
    });

    console.log('\nComposing store frames…');
    await fs.mkdir(OUT_DIR, { recursive: true });
    const framer = await browser.newPage();
    await framer.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

    for (const { caption, data, dark, width, height } of captures) {
      const html = framePage(
        caption,
        `data:image/png;base64,${data}`,
        dark,
        fitted(width, height),
      );
      await framer.setContent(html, { waitUntil: 'load' });
      const file = path.join(OUT_DIR, caption.file);
      await framer.screenshot({ path: file, type: 'png' });
      const { size } = await fs.stat(file);
      console.log(`  ${path.relative(ROOT, file)}  (${(size / 1024).toFixed(0)} KB)`);
    }

    console.log('\n5 screenshots at 1280×800, ready to upload.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(`\nScreenshot build failed: ${err.message}\n`);
  process.exit(1);
});
