#!/usr/bin/env node
/**
 * End-to-end smoke test: loads the built extension into a real Chrome, selects
 * Japanese text on a real page, and checks the panel renders the right romaji.
 *
 * Unit tests cover the analysis engine directly. This covers everything the
 * unit tests cannot: the manifest, the content script, the message round trip
 * through the service worker, the offscreen document, and the Web Worker.
 *
 *   npm run smoke
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

const PAGE = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Smoke test</title></head>
<body style="font-family: sans-serif; padding: 40px; font-size: 18px; line-height: 2">
  <p id="target">日本語を勉強しています。</p>
</body></html>`;

/** What the analyser must produce for the sentence above. */
const EXPECTED_ROMAJI = 'Nihongo o benkyō shite imasu.';
const EXPECTED_TEXT = '日本語を勉強しています。';

const TIMEOUT_MS = 60_000;

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

/** Bundle the extension's own cacheKey so the test cannot drift from it. */
async function loadCacheKey() {
  const out = path.join(ROOT, '.cache', 'cache-key.mjs');
  await fs.mkdir(path.dirname(out), { recursive: true });
  await build({
    stdin: {
      contents: `export { cacheKey } from '${path
        .join(ROOT, 'src/lib/translation-cache.ts')
        .replaceAll('\\', '/')}';`,
      resolveDir: ROOT,
      sourcefile: 'entry.ts',
      loader: 'ts',
    },
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'warning',
  });
  const module = await import(`${pathToFileURL(out).href}?t=${Date.now()}`);
  return module.cacheKey;
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

async function main() {
  if (!(await fs.stat(path.join(DIST, 'manifest.json')).then(() => true, () => false))) {
    throw new Error('dist/ not built — run `npm run build` first');
  }

  const puppeteer = (await import('puppeteer')).default;
  const executablePath = await findChromium();

  const { server, url } = await serve();
  const browser = await puppeteer.launch({
    ...(executablePath ? { executablePath } : {}),
    // Extensions require the new headless mode.
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
    ],
  });

  const fail = (message) => {
    throw new Error(message);
  };

  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    /** Select the sentence and return the Romaji button's box once it shows. */
    const selectAndFindTrigger = async () => {
      // The content script installs at document_idle, so the very first
      // selection can land before it is listening. Retry rather than race.
      for (let attempt = 0; attempt < 80; attempt++) {
        await page.evaluate(() => {
          const node = document.getElementById('target');
          const range = document.createRange();
          range.selectNodeContents(node);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        });
        const box = await page.evaluate(() => {
          const node = document
            .getElementById('hodoku-host')
            ?.shadowRoot?.querySelector('.trigger');
          if (!node) return null;
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        });
        if (box) return box;
        await new Promise((r) => setTimeout(r, 250));
      }
      return fail('the Romaji button never appeared after selecting Japanese text');
    };

    /** Click with a real mouse — see the note in step 2. */
    const clickBox = (box) => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const panelOpen = () =>
      page.evaluate(
        () =>
          document.getElementById('hodoku-host')?.shadowRoot?.querySelector('.panel') != null,
      );

    console.log('1. content script injected');
    console.log('2. selection button appears');
    const box = await selectAndFindTrigger();

    // Drive a real mouse, never element.click(). A synthetic .click() fires no
    // mousedown, and that is exactly how a shadow-DOM retargeting bug slipped
    // through: mousedown on the button was read as an outside click and tore
    // the button down before the click could land.
    await clickBox(box);

    console.log('3. panel opens and the analyser responds');
    await page
      .waitForFunction(
        () => {
          const shadow = document.getElementById('hodoku-host')?.shadowRoot;
          return (
            shadow?.querySelector('.romaji__text') != null || shadow?.querySelector('.state') != null
          );
        },
        { timeout: TIMEOUT_MS, polling: 250 },
      )
      .catch(() => fail('the panel never rendered'));

    // The first lookup loads ~26 MB of dictionaries, so allow real time here.
    await page
      .waitForFunction(
        () =>
          document.getElementById('hodoku-host')?.shadowRoot?.querySelector('.romaji__text')
            ?.textContent?.length > 0,
        { timeout: TIMEOUT_MS, polling: 250 },
      )
      .catch(async () => {
        const state = await page.evaluate(
          () =>
            document.getElementById('hodoku-host')?.shadowRoot?.querySelector('.state')
              ?.textContent ?? '(no message)',
        );
        fail(`the analyser never returned a result. Panel said: ${state}`);
      });

    const result = await page.evaluate(() => {
      const shadow = document.getElementById('hodoku-host').shadowRoot;
      const text = (selector) => shadow.querySelector(selector)?.textContent?.trim() ?? '';
      return {
        romaji: text('.romaji__text'),
        kana: text('.romaji__kana'),
        meaning: text('.meaning'),
        words: shadow.querySelectorAll('.word').length,
        warnings: [...shadow.querySelectorAll('.warning')].map((n) => n.textContent.trim()),
      };
    });

    console.log('\n  romaji  ', result.romaji);
    console.log('  kana    ', result.kana);
    console.log('  words   ', result.words);
    if (result.warnings.length) console.log('  warnings', result.warnings);

    if (result.romaji !== EXPECTED_ROMAJI) {
      fail(`romaji mismatch\n    expected: ${EXPECTED_ROMAJI}\n    actual:   ${result.romaji}`);
    }
    if (result.words < 5) fail(`expected a multi-word breakdown, got ${result.words} rows`);
    if (!/japanese/i.test(result.meaning)) {
      fail(`meaning did not include a dictionary gloss: ${result.meaning}`);
    }
    if (result.warnings.length) {
      fail(`the panel reported warnings: ${result.warnings.join('; ')}`);
    }

    // The content-script API surface is much smaller than an extension page's;
    // chrome.runtime.openOptionsPage is not part of it, so this has to go
    // through the background worker.
    console.log('4. the panel Options link opens the options page');
    const optionsBox = await page.evaluate(() => {
      const node = [
        ...document.getElementById('hodoku-host').shadowRoot.querySelectorAll('.link-btn'),
      ].find((n) => n.textContent.trim() === 'Options');
      if (!node) return null;
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    });
    if (!optionsBox) fail('no Options link in the panel footer');
    await clickBox(optionsBox);
    const optionsTarget = await browser
      .waitForTarget((t) => t.url().includes('options/options.html'), { timeout: 10_000 })
      .catch(() => null);
    if (!optionsTarget) fail('clicking Options in the panel did not open the options page');
    await (await optionsTarget.page())?.close();

    // Re-open: the click above dismissed the panel along with the page click.
    if (!(await panelOpen())) {
      await clickBox(await selectAndFindTrigger());
      await page.waitForFunction(
        () =>
          document.getElementById('hodoku-host')?.shadowRoot?.querySelector('.romaji__text')
            ?.textContent?.length > 0,
        { timeout: TIMEOUT_MS, polling: 250 },
      );
    }

    console.log('5. clicking inside the panel does not dismiss it');
    const panelBox = await page.evaluate(() => {
      const { x, y, width, height } = document
        .getElementById('hodoku-host')
        .shadowRoot.querySelector('.romaji__text')
        .getBoundingClientRect();
      return { x, y, width, height };
    });
    await clickBox(panelBox);
    if (!(await panelOpen())) fail('clicking the romaji text closed the panel');

    console.log('6. clicking the page dismisses it');
    await page.mouse.click(5, 5);
    if (await panelOpen()) fail('clicking outside did not close the panel');

    console.log('7. Escape closes the panel');
    await clickBox(await selectAndFindTrigger());
    await page.waitForFunction(
      () =>
        document.getElementById('hodoku-host')?.shadowRoot?.querySelector('.romaji__text')
          ?.textContent?.length > 0,
      { timeout: TIMEOUT_MS, polling: 250 },
    );
    await page.keyboard.press('Escape');
    if (await panelOpen()) fail('Escape did not close the panel');

    // Closing while an analysis is still in flight must stay closed. The result
    // arrives afterwards and used to re-create the panel on its own.
    console.log('8. closing mid-analysis stays closed');
    await clickBox(await selectAndFindTrigger());
    await page.keyboard.press('Escape'); // immediately, while still loading
    if (await panelOpen()) fail('Escape did not close the loading panel');
    await new Promise((r) => setTimeout(r, 4000)); // let the analysis land
    if (await panelOpen()) fail('the panel reopened itself when the analysis finished');

    console.log('9. the toolbar popup loads and its Options button works');
    const extensionId = browser
      .targets()
      .map((t) => t.url())
      .find((u) => u.startsWith('chrome-extension://'))
      ?.split('/')[2];
    if (!extensionId) fail('could not determine the extension id');

    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded',
    });
    await popup.waitForSelector('#options', { timeout: 10_000 });
    await popup.click('#options');
    const fromPopup = await browser
      .waitForTarget((t) => t.url().includes('options/options.html'), { timeout: 10_000 })
      .catch(() => null);
    if (!fromPopup) fail('the popup Options button did not open the options page');
    await (await fromPopup.page())?.close();
    await popup.close();

    console.log('10. a cached translation is served without touching the API');
    // Seeded through the extension's own cacheKey, so a change to the key
    // format fails this test instead of silently disabling the cache.
    const cacheKey = await loadCacheKey();
    const CACHED = 'I am studying Japanese. (from cache)';
    // chrome.storage is not reachable from a web page's main world, so the
    // seeding has to happen in an extension page.
    const seedId = browser
      .targets()
      .map((t) => t.url())
      .find((u) => u.startsWith('chrome-extension://'))
      ?.split('/')[2];
    if (!seedId) fail('could not determine the extension id');
    const seeder = await browser.newPage();
    await seeder.goto(`chrome-extension://${seedId}/options/options.html`, {
      waitUntil: 'domcontentloaded',
    });

    await seeder.evaluate(
      (key, entry, text) =>
        chrome.storage.local.set({
          aiTranslation: true,
          provider: 'anthropic',
          // Deliberately not a working key, and the host permission is not
          // granted: any real API attempt would fail and raise a warning.
          anthropicApiKey: 'sk-ant-not-a-real-key',
          anthropicModel: 'claude-opus-5',
          translationCache: { [key]: { ...entry, text } },
        }),
      cacheKey(EXPECTED_TEXT, 'anthropic', 'claude-opus-5'),
      {
        provider: 'anthropic',
        model: 'claude-opus-5',
        translation: CACHED,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        hits: 0,
      },
      EXPECTED_TEXT,
    );

    await clickBox(await selectAndFindTrigger());
    await page.waitForFunction(
      () =>
        document.getElementById('hodoku-host')?.shadowRoot?.querySelector('.romaji__text')
          ?.textContent?.length > 0,
      { timeout: TIMEOUT_MS, polling: 250 },
    );

    const cachedView = await page.evaluate(() => {
      const shadow = document.getElementById('hodoku-host').shadowRoot;
      return {
        meaning: shadow.querySelector('.meaning')?.textContent?.trim() ?? '',
        badgeTitle: shadow.querySelector('.badge-source')?.getAttribute('title') ?? '',
        isCached: shadow.querySelector('.badge-source--cached') != null,
        warnings: [...shadow.querySelectorAll('.warning')].map((n) => n.textContent.trim()),
      };
    });

    if (!cachedView.meaning.includes(CACHED)) {
      fail(`the cached translation was not used. Panel showed: ${cachedView.meaning}`);
    }
    if (!cachedView.isCached) fail('the cached translation was not marked as cached');
    if (!/cache/i.test(cachedView.badgeTitle)) fail(`badge did not mention the cache: ${cachedView.badgeTitle}`);
    if (cachedView.warnings.length) {
      // A permission or API warning here means it tried to call out despite the hit.
      fail(`a cache hit still attempted the API: ${cachedView.warnings.join('; ')}`);
    }
    console.log('   served from cache, no API call, no warnings');

    // Put settings back so the remaining steps behave like a default install.
    await seeder.evaluate(() =>
      chrome.storage.local.set({ aiTranslation: false, anthropicApiKey: '' }),
    );
    await seeder.close();
    await page.bringToFront();
    await page.mouse.click(5, 5);

    console.log('11. the regenerate control offers only configured providers');
    const seedSettings = async (patch) => {
      await seeder2.evaluate((p) => chrome.storage.local.set(p), patch);
      // The content script reloads its provider list on the storage change.
      await new Promise((r) => setTimeout(r, 400));
    };
    const seeder2 = await browser.newPage();
    await seeder2.goto(`chrome-extension://${seedId}/options/options.html`, {
      waitUntil: 'domcontentloaded',
    });

    const readControl = () =>
      page.evaluate(() => {
        const shadow = document.getElementById('hodoku-host')?.shadowRoot;
        const select = shadow?.querySelector('.mini-select');
        return {
          button: shadow?.querySelector('.mini-btn')?.textContent?.trim() ?? null,
          options: select ? [...select.options].map((o) => o.textContent) : null,
          single: shadow?.querySelector('.meaning__provider')?.textContent?.trim() ?? null,
        };
      });

    const openPanel = async () => {
      await page.bringToFront();
      await clickBox(await selectAndFindTrigger());
      await page.waitForFunction(
        () =>
          document.getElementById('hodoku-host')?.shadowRoot?.querySelector('.romaji__text')
            ?.textContent?.length > 0,
        { timeout: TIMEOUT_MS, polling: 250 },
      );
    };

    // No keys at all: nothing to regenerate with, so no control.
    await seedSettings({ aiTranslation: true, anthropicApiKey: '', openaiApiKey: '' });
    await openPanel();
    if ((await readControl()).button) fail('the regenerate control appeared with no API key');
    await page.mouse.click(5, 5);

    // One key: a button that names the provider, and no pointless dropdown.
    await seedSettings({ anthropicApiKey: 'sk-ant-not-real' });
    await openPanel();
    const one = await readControl();
    if (one.button !== 'Regenerate') fail(`expected a Regenerate button, saw ${one.button}`);
    if (one.options) fail('a dropdown appeared with only one provider configured');
    if (!/Claude/.test(one.single ?? '')) fail(`provider label was ${one.single}`);
    await page.mouse.click(5, 5);

    // Two keys: a dropdown listing exactly those two.
    await seedSettings({ openaiApiKey: 'sk-openai-not-real' });
    await openPanel();
    const two = await readControl();
    if (!two.options || two.options.length !== 2) {
      fail(`expected two providers in the dropdown, saw ${JSON.stringify(two.options)}`);
    }
    console.log(`   offered: ${two.options.join(', ')}`);

    console.log('12. regenerating surfaces the real failure rather than hanging');
    // No host permission is granted, so this must fail loudly and recover.
    await page.evaluate(() =>
      document.getElementById('hodoku-host').shadowRoot.querySelector('.mini-btn').click(),
    );
    await page
      .waitForFunction(
        () =>
          [...document.getElementById('hodoku-host').shadowRoot.querySelectorAll('.warning')]
            .some((n) => /Could not regenerate/.test(n.textContent)),
        { timeout: 15_000 },
      )
      .catch(() => fail('regenerating neither succeeded nor reported a failure'));
    const stillUsable = await page.evaluate(
      () =>
        document.getElementById('hodoku-host').shadowRoot.querySelector('.mini-btn')
          ?.textContent?.trim(),
    );
    if (stillUsable !== 'Regenerate') fail(`the button stayed stuck at "${stillUsable}"`);
    console.log('   failure reported, control re-enabled');

    await seedSettings({ aiTranslation: false, anthropicApiKey: '', openaiApiKey: '' });
    await seeder2.close();
    await page.bringToFront();
    await page.mouse.click(5, 5);

    console.log('13. the panel save button stores the sentence');
    await clickBox(await selectAndFindTrigger());
    await page.waitForFunction(
      () =>
        document.getElementById('hodoku-host')?.shadowRoot?.querySelector('.romaji__text')
          ?.textContent?.length > 0,
      { timeout: TIMEOUT_MS, polling: 250 },
    );

    const saveBox = await page.evaluate(() => {
      const node = document
        .getElementById('hodoku-host')
        .shadowRoot.querySelector('.icon-btn[data-saved]');
      if (!node) return null;
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    });
    if (!saveBox) fail('no save button in the panel header');
    await clickBox(saveBox);

    await page
      .waitForFunction(
        () =>
          document
            .getElementById('hodoku-host')
            ?.shadowRoot?.querySelector('.icon-btn[data-saved="true"]') != null,
        { timeout: 10_000 },
      )
      .catch(() => fail('the save button never showed a saved state'));

    console.log('14. the saved sentence appears on the review page');
    const extId = browser
      .targets()
      .map((t) => t.url())
      .find((u) => u.startsWith('chrome-extension://'))
      ?.split('/')[2];
    if (!extId) fail('could not determine the extension id');

    const review = await browser.newPage();
    await review.goto(`chrome-extension://${extId}/review/review.html`, {
      waitUntil: 'domcontentloaded',
    });
    await review.waitForSelector('.item', { timeout: 15_000 }).catch(() => fail('review page listed nothing'));

    const saved = await review.evaluate(() => {
      const item = document.querySelector('.item');
      return {
        text: item.querySelector('.item__ja').firstChild?.textContent?.trim(),
        romaji: item.querySelector('.item__romaji')?.textContent?.trim(),
        summary: document.getElementById('summary')?.textContent?.trim(),
      };
    });
    console.log('   stored  ', saved.romaji);
    if (saved.text !== '日本語を勉強しています。') {
      fail(`review page shows the wrong text: ${saved.text}`);
    }
    if (saved.romaji !== EXPECTED_ROMAJI) {
      fail(`review page shows the wrong romaji: ${saved.romaji}`);
    }
    if (!/1 saved/.test(saved.summary ?? '')) fail(`unexpected summary: ${saved.summary}`);

    console.log('15. study mode reveals the answer');
    await review.click('#study');
    await review.waitForSelector('.study__ja', { timeout: 10_000 });
    const revealed = await review.evaluate(async () => {
      const button = [...document.querySelectorAll('.study button')].find((b) =>
        b.textContent.includes('Show'),
      );
      button.click();
      await new Promise((r) => setTimeout(r, 100));
      return document.querySelector('.study__romaji')?.textContent?.trim();
    });
    if (revealed !== EXPECTED_ROMAJI) fail(`study card revealed: ${revealed}`);

    console.log('16. removing an item empties the list');
    await review.reload({ waitUntil: 'domcontentloaded' });
    await review.waitForSelector('.item', { timeout: 10_000 });
    await review.evaluate(() => {
      const remove = [...document.querySelectorAll('.item__actions .icon-btn')].find(
        (b) => b.title === 'Remove from saved',
      );
      remove.click();
    });
    await review
      .waitForFunction(() => document.querySelector('.empty') != null, { timeout: 10_000 })
      .catch(() => fail('the item was not removed'));
    await review.close();

    if (consoleErrors.length) fail(`page errors: ${consoleErrors.join('; ')}`);

    console.log('\nSmoke test passed — the packaged extension works end to end.\n');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(`\nSmoke test FAILED: ${err.message}\n`);
  process.exit(1);
});
