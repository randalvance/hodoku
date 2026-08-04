#!/usr/bin/env node
/**
 * End-to-end test of the Anki export path against a mock AnkiConnect server.
 *
 * Headless Chrome auto-denies `chrome.permissions.request`, so the optional
 * loopback permission cannot be granted by driving the options page. This test
 * therefore loads a copy of dist/ whose manifest declares that permission as
 * required instead of optional — everything downstream of the grant (the
 * background proxy, the HTTP call, note construction, the review-page UI) is
 * the shipped code, unmodified. Only Chrome's own permission dialog is out of
 * scope.
 *
 *   npm run smoke:anki
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const TEST_DIST = path.join(ROOT, '.cache', 'dist-anki');
const ANKI_PORT = 8765;

const SAVED = {
  id: 'test-item-1',
  text: '猫が好きです',
  romaji: 'Neko ga suki desu',
  kana: 'ねこがすきです',
  // The snapshot taken when the sentence was saved, as a model produced it.
  translation: 'I like cats.',
  translationSource: 'ai',
  translationModel: 'claude-opus-5',
  literal: 'cat-SUBJ liked is',
  note: '好き is a na-adjective, so the thing liked takes が, not を.',
  url: 'https://example.com/a?q="x"',
  title: 'Example <page>',
  savedAt: Date.now(),
  reviewCount: 0,
};

/** Minimal AnkiConnect stand-in: same envelope, same CORS behaviour. */
function mockAnki() {
  const received = [];
  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const request = JSON.parse(body);
      received.push(request);

      let result = null;
      switch (request.action) {
        case 'version':
          result = 6;
          break;
        case 'deckNames':
          result = ['Default', 'Hodoku'];
          break;
        case 'modelNames':
          result = ['Basic', 'Basic (and reversed card)'];
          break;
        case 'modelFieldNames':
          result = ['Front', 'Back'];
          break;
        case 'createDeck':
          result = 1;
          break;
        case 'addNotes':
          // One id per note, mirroring AnkiConnect.
          result = request.params.notes.map((_, index) => 1000 + index);
          break;
        default:
          result = null;
      }

      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result, error: null }));
    });
  });

  return { server, received };
}

/** Copy dist/ and promote the loopback origins to required permissions. */
async function buildTestExtension() {
  await fs.rm(TEST_DIST, { recursive: true, force: true });
  await fs.cp(DIST, TEST_DIST, { recursive: true });

  const manifestPath = path.join(TEST_DIST, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const loopback = (manifest.optional_host_permissions ?? []).filter((origin) =>
    /127\.0\.0\.1|localhost/.test(origin),
  );
  if (!loopback.length) throw new Error('no loopback origin found in optional_host_permissions');

  manifest.optional_host_permissions = (manifest.optional_host_permissions ?? []).filter(
    (origin) => !loopback.includes(origin),
  );
  manifest.host_permissions = [...(manifest.host_permissions ?? []), ...loopback];
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return loopback;
}

async function findChromium() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await fs.stat(candidate).then(() => true, () => false)) return candidate;
  }
  return null;
}

async function main() {
  if (!(await fs.stat(path.join(DIST, 'manifest.json')).then(() => true, () => false))) {
    throw new Error('dist/ not built — run `npm run build` first');
  }

  const loopback = await buildTestExtension();
  console.log(`Test build promotes ${loopback.join(', ')} to a required permission.`);

  const { server, received } = mockAnki();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(ANKI_PORT, '127.0.0.1', resolve);
  });

  const puppeteer = (await import('puppeteer')).default;
  const executablePath = await findChromium();
  const browser = await puppeteer.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${TEST_DIST}`,
      `--load-extension=${TEST_DIST}`,
    ],
  });

  const fail = (message) => {
    throw new Error(message);
  };

  try {
    const target = await browser.waitForTarget(
      (t) => t.url().startsWith('chrome-extension://'),
      { timeout: 30_000 },
    );
    const id = target.url().split('/')[2];

    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));

    console.log('1. options page reaches Anki and lists decks');
    await page.goto(`chrome-extension://${id}/options/options.html`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#ankiEnabled');
    // The permission is already held in this build, so enabling is just state.
    await page.evaluate(
      (item) =>
        chrome.storage.local.set({
          ankiEnabled: true,
          savedItems: [item],
        }),
      SAVED,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#anki-test');
    await page.click('#anki-test');
    await page
      .waitForFunction(
        () => /Connected/.test(document.getElementById('anki-status')?.textContent ?? ''),
        { timeout: 15_000 },
      )
      .catch(async () => {
        const text = await page.evaluate(
          () => document.getElementById('anki-status')?.textContent ?? '',
        );
        fail(`options page never connected to Anki. Status said: ${text}`);
      });

    const probed = received.map((r) => r.action);
    for (const action of ['version', 'deckNames', 'modelNames']) {
      if (!probed.includes(action)) fail(`options page never called ${action}`);
    }
    console.log(`   probe called: ${[...new Set(probed)].join(', ')}`);

    console.log('2. the extension origin is shown for AnkiConnect config');
    const origin = await page.evaluate(() => document.getElementById('anki-origin')?.value);
    if (origin !== `chrome-extension://${id}`) fail(`wrong CORS origin shown: ${origin}`);

    console.log('3. review page sends the saved sentence to Anki');
    const review = await browser.newPage();
    review.on('pageerror', (err) => errors.push(String(err)));
    await review.goto(`chrome-extension://${id}/review/review.html`, {
      waitUntil: 'domcontentloaded',
    });
    await review.waitForSelector('#anki-send:not(.hidden)', { timeout: 10_000 });
    await review.click('#anki-send');
    await review
      .waitForFunction(
        () => /Added \d+ card/.test(document.getElementById('anki-status')?.textContent ?? ''),
        { timeout: 15_000 },
      )
      .catch(async () => {
        const text = await review.evaluate(
          () => document.getElementById('anki-status')?.textContent ?? '',
        );
        fail(`sending to Anki did not report success. Page said: ${text}`);
      });
    console.log(
      '  ',
      await review.evaluate(() => document.getElementById('anki-status').textContent),
    );

    console.log('4. the note that arrived is well-formed');
    const addNotes = received.find((r) => r.action === 'addNotes');
    if (!addNotes) fail('Anki never received addNotes');
    if (addNotes.version !== 6) fail(`wrong API version: ${addNotes.version}`);

    const createDeck = received.find((r) => r.action === 'createDeck');
    if (!createDeck) fail('the deck was never created before adding notes');
    if (received.indexOf(createDeck) > received.indexOf(addNotes)) {
      fail('addNotes was sent before createDeck');
    }

    const [note] = addNotes.params.notes;
    if (note.deckName !== 'Hodoku') fail(`wrong deck: ${note.deckName}`);
    if (note.modelName !== 'Basic') fail(`wrong note type: ${note.modelName}`);
    if (note.fields.Front !== '猫が好きです') fail(`wrong Front field: ${note.fields.Front}`);
    if (!/Neko ga suki desu/.test(note.fields.Back)) fail('Back field is missing the romaji');
    if (!/I like cats\./.test(note.fields.Back)) fail('Back field is missing the meaning');
    if (note.options.allowDuplicate !== false) fail('duplicates were not disallowed');
    if (!note.tags.includes('hodoku')) fail(`wrong tags: ${note.tags}`);
    // The saved title and URL both contain characters that must not reach the
    // card as markup.
    if (/<page>/.test(note.fields.Back)) fail('unescaped HTML reached the Anki card');
    console.log('   deck/model/fields/tags all correct, HTML escaped');

    console.log('5. furigana is rendered as ruby on the back only');
    // The alignment is not stored on the saved record — it is re-derived from
    // the analyser at send time, so this also proves that path works.
    if (!/<ruby>/.test(note.fields.Back)) fail('the back of the card has no furigana');
    if (!/<rt>/.test(note.fields.Back)) fail('ruby is present but carries no reading');
    if (/<ruby>/.test(note.fields.Front)) {
      fail('furigana leaked onto the front, which would give the answer away');
    }
    const ruby = note.fields.Back.match(/<ruby>[^<]*<rt>[^<]*<\/rt><\/ruby>/g) ?? [];
    if (!ruby.length) fail('no well-formed ruby element found');
    console.log(`   ${ruby.length} ruby element(s): ${ruby[0]}`);

    console.log('6. the saved model response travels with the card');
    for (const [label, expected] of [
      ['translation', 'I like cats.'],
      ['literal rendering', 'cat-SUBJ liked is'],
      ['grammar note', 'na-adjective'],
      ['model', 'claude-opus-5'],
    ]) {
      if (!note.fields.Back.includes(expected)) {
        fail(`the ${label} did not reach the card (looked for "${expected}")`);
      }
    }
    console.log('   translation, literal, grammar note and model all present');

    console.log('7. sent items are marked so they are not sent twice');
    await review.reload({ waitUntil: 'domcontentloaded' });
    await review.waitForSelector('.item', { timeout: 10_000 });
    const marked = await review.evaluate(() =>
      [...document.querySelectorAll('.item__meta span')].some((n) => n.textContent === 'In Anki'),
    );
    if (!marked) fail('the item was not marked as sent');

    const before = received.filter((r) => r.action === 'addNotes').length;
    await review.click('#anki-send');
    await review.waitForFunction(
      () => /already in Anki/.test(document.getElementById('anki-status')?.textContent ?? ''),
      { timeout: 10_000 },
    );
    if (received.filter((r) => r.action === 'addNotes').length !== before) {
      fail('a second send re-posted notes that were already in Anki');
    }

    if (errors.length) fail(`page errors: ${errors.join('; ')}`);
    console.log('\nAnki smoke test passed — cards reach Anki correctly.\n');
  } finally {
    await browser.close();
    server.close();
    await fs.rm(TEST_DIST, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\nAnki smoke test FAILED: ${err.message}\n`);
  process.exit(1);
});
