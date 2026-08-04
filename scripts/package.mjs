#!/usr/bin/env node
/**
 * Zips dist/ into release/ for upload to the Chrome Web Store, after checking
 * the things the review process rejects builds for.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(ROOT, 'release');

/** Everything the manifest promises must actually be in the bundle. */
const REQUIRED = [
  'manifest.json',
  'background/service-worker.js',
  'content/content.js',
  'offscreen/offscreen.html',
  'offscreen/offscreen.js',
  'worker/analyzer.worker.js',
  'popup/popup.html',
  'popup/popup.js',
  'options/options.html',
  'options/options.js',
  'review/review.html',
  'review/review.js',
  'ui/ui.css',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
  'dict/kuromoji/base.dat.gz',
  'dict/kuromoji/cc.dat.gz',
  'dict/kuromoji/check.dat.gz',
  'dict/kuromoji/tid.dat.gz',
  'dict/kuromoji/tid_map.dat.gz',
  'dict/kuromoji/tid_pos.dat.gz',
  'dict/kuromoji/unk.dat.gz',
  'dict/kuromoji/unk_char.dat.gz',
  'dict/kuromoji/unk_compat.dat.gz',
  'dict/kuromoji/unk_invoke.dat.gz',
  'dict/kuromoji/unk_map.dat.gz',
  'dict/kuromoji/unk_pos.dat.gz',
  'dict/jmdict.bin',
];

async function exists(target) {
  return fs.stat(target).then(
    () => true,
    () => false,
  );
}

async function directorySize(dir) {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(full);
    else total += (await fs.stat(full)).size;
  }
  return total;
}

async function main() {
  if (!(await exists(DIST))) {
    throw new Error('dist/ not found — run `npm run build` first');
  }

  const missing = [];
  for (const file of REQUIRED) {
    if (!(await exists(path.join(DIST, file)))) missing.push(file);
  }
  if (missing.length) {
    throw new Error(
      `dist/ is incomplete. Missing:\n  ${missing.join('\n  ')}\n\n` +
        'Run `npm run release` to build the icons, dictionary, and bundle together.',
    );
  }

  const manifest = JSON.parse(await fs.readFile(path.join(DIST, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) {
    throw new Error(
      `Version mismatch: manifest.json is ${manifest.version}, package.json is ${pkg.version}`,
    );
  }

  await fs.mkdir(RELEASE, { recursive: true });
  const zipName = `hodoku-${manifest.version}.zip`;
  const zipPath = path.join(RELEASE, zipName);
  await fs.rm(zipPath, { force: true });

  // -X drops extended attributes and resource forks that macOS would otherwise
  // add; the store rejects archives containing __MACOSX entries.
  execFileSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: DIST });

  const unpacked = await directorySize(DIST);
  const { size: packed } = await fs.stat(zipPath);

  console.log(`\nPackaged ${manifest.name} v${manifest.version}`);
  console.log(`  unpacked  ${(unpacked / 1048576).toFixed(1)} MB`);
  console.log(`  zipped    ${(packed / 1048576).toFixed(1)} MB`);
  console.log(`  ->        ${path.relative(ROOT, zipPath)}`);
  console.log('\nUpload at https://chrome.google.com/webstore/devconsole');
  console.log('Listing copy and review answers: store/LISTING.md\n');
}

main().catch((err) => {
  console.error(`\nPackaging failed: ${err.message}\n`);
  process.exit(1);
});
