#!/usr/bin/env node
/**
 * Generates the extension icon set: ほ — the first kana of Hodoku — reversed out
 * of an indigo-to-violet rounded square.
 *
 * Rendered through Chromium rather than the hand-rolled rasteriser this file
 * used to carry, because the mark is now a glyph: drawing kana from line
 * segments would look like a traced approximation, and it would be one. That
 * makes the output font-dependent, so the container pins fonts-noto-cjk and the
 * generated PNGs are committed — they, not this script, are what the build
 * consumes.
 *
 * If Chromium is unavailable the existing icons are kept and the build carries
 * on, so a machine without a browser can still produce a release.
 *
 *   npm run build:icons
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'icons');
const STORE_DIR = path.join(ROOT, 'store', 'assets');
const SIZES = [16, 32, 48, 128];

const BG_TOP = '#635bff';
const BG_BOTTOM = '#4633d9';
const FG = '#ffffff';
const GLYPH = 'ほ';

/**
 * The glyph is optically centred rather than geometrically centred: kana sit
 * high in their em box, so a dead-centre baseline reads as too low.
 */
function iconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOTTOM}"/>
  </linearGradient></defs>
  <rect width="128" height="128" rx="29" fill="url(#g)"/>
  <text x="64" y="66" text-anchor="middle" dominant-baseline="central"
    font-family="'Noto Sans JP','Hiragino Sans','Yu Gothic',sans-serif"
    font-size="82" font-weight="600" fill="${FG}">${GLYPH}</text>
</svg>`;
}

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

const exists = (target) => fs.stat(target).then(() => true, () => false);

async function main() {
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch {
    puppeteer = null;
  }
  const executablePath = puppeteer ? await findChromium() : null;

  if (!puppeteer) {
    const haveIcons = await exists(path.join(OUT_DIR, 'icon-128.png'));
    if (haveIcons) {
      console.warn('! puppeteer unavailable — keeping the committed icons');
      return;
    }
    throw new Error('puppeteer is required to generate the icons for the first time');
  }

  const browser = await puppeteer.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });

  try {
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.mkdir(STORE_DIR, { recursive: true });
    const page = await browser.newPage();

    for (const size of SIZES) {
      await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
      await page.setContent(`<html><body style="margin:0">${iconSvg(size)}</body></html>`, {
        waitUntil: 'load',
      });
      const file = path.join(OUT_DIR, `icon-${size}.png`);
      await page.screenshot({ path: file, omitBackground: true });
      const { size: bytes } = await fs.stat(file);
      console.log(`  ${String(size).padStart(3)}×${size}  ${(bytes / 1024).toFixed(1)} KB  ${path.relative(ROOT, file)}`);
    }

    // The store listing wants its own 128px copy.
    await fs.copyFile(
      path.join(OUT_DIR, 'icon-128.png'),
      path.join(STORE_DIR, 'store-icon-128.png'),
    );
    console.log(`  store/assets/store-icon-128.png`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`\nIcon build failed: ${err.message}\n`);
  process.exit(1);
});
