#!/usr/bin/env node
/**
 * Bundles the extension into dist/.
 *
 * Content scripts run in the page and cannot use ES module syntax, so they are
 * emitted as an IIFE. Everything else is a module context (service worker,
 * offscreen document, Web Worker, extension pages).
 */

import { build, context } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const PUBLIC_DIR = path.join(ROOT, 'public');
const KUROMOJI_DICT = path.join(ROOT, 'node_modules', 'kuromoji', 'dict');

const WATCH = process.argv.includes('--watch');

/** target: the oldest Chrome the manifest claims to support. */
const TARGET = 'chrome116';

const ENTRIES = [
  { in: path.join(SRC, 'background/service-worker.ts'), out: 'background/service-worker', format: 'esm' },
  { in: path.join(SRC, 'offscreen/offscreen.ts'), out: 'offscreen/offscreen', format: 'esm' },
  { in: path.join(SRC, 'worker/analyzer.worker.ts'), out: 'worker/analyzer.worker', format: 'esm' },
  { in: path.join(SRC, 'popup/popup.ts'), out: 'popup/popup', format: 'esm' },
  { in: path.join(SRC, 'options/options.ts'), out: 'options/options', format: 'esm' },
  { in: path.join(SRC, 'review/review.ts'), out: 'review/review', format: 'esm' },
  // Content scripts are injected as classic scripts — no import/export allowed.
  { in: path.join(SRC, 'content/content.ts'), out: 'content/content', format: 'iife' },
];

const STATIC_FILES = [
  ['manifest.json', 'manifest.json'],
  ['offscreen/offscreen.html', 'offscreen/offscreen.html'],
  ['popup/popup.html', 'popup/popup.html'],
  ['options/options.html', 'options/options.html'],
  ['review/review.html', 'review/review.html'],
  ['ui/ui.css', 'ui/ui.css'],
];

async function copyStatic() {
  for (const [from, to] of STATIC_FILES) {
    const dest = path.join(DIST, to);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(SRC, from), dest);
  }
}

async function copyDir(from, to, filter = () => true) {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyDir(src, dest, filter);
    } else if (filter(entry.name)) {
      await fs.copyFile(src, dest);
    }
  }
}

async function copyAssets() {
  await copyStatic();

  // kuromoji's IPADIC, served from inside the extension package.
  if (await exists(KUROMOJI_DICT)) {
    await copyDir(KUROMOJI_DICT, path.join(DIST, 'dict', 'kuromoji'), (name) =>
      name.endsWith('.dat.gz'),
    );
  } else {
    console.warn('! kuromoji dictionary not found — run npm install');
  }

  // Compiled JMdict table and generated icons, if they have been built.
  const jmdict = path.join(PUBLIC_DIR, 'dict', 'jmdict.bin');
  if (await exists(jmdict)) {
    await fs.mkdir(path.join(DIST, 'dict'), { recursive: true });
    await fs.copyFile(jmdict, path.join(DIST, 'dict', 'jmdict.bin'));
  } else {
    console.warn('! public/dict/jmdict.bin missing — run `npm run build:dict` for word meanings');
  }

  const icons = path.join(PUBLIC_DIR, 'icons');
  if (await exists(icons)) {
    await copyDir(icons, path.join(DIST, 'icons'));
  } else {
    console.warn('! public/icons missing — run `npm run build:icons`');
  }
}

async function exists(target) {
  return fs.stat(target).then(
    () => true,
    () => false,
  );
}

function baseOptions(entry) {
  return {
    entryPoints: [{ in: entry.in, out: entry.out }],
    outdir: DIST,
    bundle: true,
    format: entry.format,
    target: TARGET,
    platform: 'browser',
    minify: !WATCH,
    sourcemap: WATCH ? 'inline' : false,
    legalComments: 'none',
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': JSON.stringify(WATCH ? 'development' : 'production') },
  };
}

async function reportSizes() {
  const walk = async (dir, prefix = '') => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const rows = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        rows.push(...(await walk(full, `${prefix}${entry.name}/`)));
      } else {
        const { size } = await fs.stat(full);
        rows.push([`${prefix}${entry.name}`, size]);
      }
    }
    return rows;
  };

  const rows = await walk(DIST);
  const total = rows.reduce((sum, [, size]) => sum + size, 0);
  const code = rows
    .filter(([name]) => name.endsWith('.js'))
    .sort((a, b) => b[1] - a[1]);

  console.log('\nBundle sizes:');
  for (const [name, size] of code) {
    console.log(`  ${(size / 1024).toFixed(1).padStart(8)} KB  ${name}`);
  }
  console.log(`  ${(total / 1048576).toFixed(1).padStart(8)} MB  total package\n`);
}

async function main() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  if (WATCH) {
    await copyAssets();
    const contexts = await Promise.all(ENTRIES.map((entry) => context(baseOptions(entry))));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('Watching for changes… (load dist/ as an unpacked extension)');
    return;
  }

  await Promise.all(ENTRIES.map((entry) => build(baseOptions(entry))));
  await copyAssets();
  await reportSizes();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
