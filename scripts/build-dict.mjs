#!/usr/bin/env node
/**
 * Downloads JMdict (via the jmdict-simplified JSON distribution) and compiles it
 * into the compact, gzipped lookup table the extension ships.
 *
 * Output: public/dict/jmdict.bin  (gzipped JSON object, headword -> packed senses)
 *
 * Record format, chosen so that runtime lookup is a single property access and
 * parsing stays cheap:
 *
 *   key   = headword (kanji spelling or kana spelling)
 *   value = entry (RS entry)*                     RS = 
 *   entry = reading US common US posCodes US glosses    US = 
 *   glosses = sense (GS sense)*                   GS = 
 *   sense = gloss (";" gloss)*
 *
 * Usage:
 *   node scripts/build-dict.mjs            # full JMdict (best coverage)
 *   node scripts/build-dict.mjs --common   # common-words subset (much smaller)
 */

import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const ROOT = path.resolve(import.meta.dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');
const OUT_DIR = path.join(ROOT, 'public', 'dict');
const OUT_FILE = path.join(OUT_DIR, 'jmdict.bin');
const META_FILE = path.join(OUT_DIR, 'jmdict.meta.json');

const RS = '';
const US = '';
const GS = '';

const COMMON_ONLY = process.argv.includes('--common');

/** Senses tagged this way are noise for a reading-assistance tool. */
const SKIP_MISC = new Set(['obs', 'obsc', 'arch', 'rare']);

/**
 * Cap the payload: learners skim the first few senses, not all seventeen, and
 * every gloss kept costs both download size and runtime parse time.
 */
const MAX_SENSES = 3;
const MAX_GLOSSES_PER_SENSE = 4;

const RELEASE_API =
  'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';

async function fetchLatestAsset() {
  const res = await fetch(RELEASE_API, {
    headers: { 'User-Agent': 'hodoku-build', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);
  const release = await res.json();
  const wanted = COMMON_ONLY ? /^jmdict-eng-common-.*\.json\.tgz$/ : /^jmdict-eng-\d.*\.json\.tgz$/;
  const asset = release.assets.find((a) => wanted.test(a.name));
  if (!asset) {
    throw new Error(
      `No matching asset in release ${release.tag_name}. Saw: ${release.assets.map((a) => a.name).join(', ')}`,
    );
  }
  return { asset, tag: release.tag_name };
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': 'hodoku-build' } });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function packSenses(senses) {
  const parts = [];
  for (const sense of senses) {
    if (parts.length >= MAX_SENSES) break;
    if (sense.misc?.some((m) => SKIP_MISC.has(m))) continue;
    const glosses = (sense.gloss ?? [])
      .filter((g) => !g.lang || g.lang === 'eng')
      .map((g) => g.text.replace(/[;]/g, ','))
      .slice(0, MAX_GLOSSES_PER_SENSE);
    if (!glosses.length) continue;
    parts.push(glosses.join(';'));
  }
  return parts.join(GS);
}

function collectPos(senses) {
  const seen = new Set();
  for (const sense of senses) {
    for (const p of sense.partOfSpeech ?? []) seen.add(p);
  }
  return [...seen].slice(0, 6).join(',');
}

async function main() {
  await fs.mkdir(VENDOR, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log('Resolving latest jmdict-simplified release...');
  const { asset, tag } = await fetchLatestAsset();
  console.log(`  ${asset.name} (${(asset.size / 1048576).toFixed(1)} MB) from ${tag}`);

  const archive = path.join(VENDOR, asset.name);
  const exists = await fs
    .stat(archive)
    .then((s) => s.size === asset.size)
    .catch(() => false);
  if (exists) {
    console.log('  already downloaded, reusing');
  } else {
    console.log('  downloading...');
    await download(asset.browser_download_url, archive);
  }

  // The archive member is not named after the asset (the release timestamp is
  // dropped), so read the real name out of the tarball instead of guessing.
  const members = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.json'));
  if (!members.length) throw new Error(`No .json member inside ${asset.name}`);
  const jsonPath = path.join(VENDOR, members[0]);

  if (await fs.stat(jsonPath).then(() => true).catch(() => false)) {
    console.log(`Extracted copy already present (${members[0]})`);
  } else {
    console.log(`Extracting ${members[0]}...`);
    execFileSync('tar', ['-xzf', archive, '-C', VENDOR], { stdio: 'inherit' });
  }

  console.log('Parsing JMdict (this needs a moment)...');
  const raw = await fs.readFile(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  console.log(`  ${data.words.length.toLocaleString()} dictionary entries`);

  /** @type {Map<string, string[]>} */
  const index = new Map();
  let packedCount = 0;

  for (const word of data.words) {
    const glossBlob = packSenses(word.sense ?? []);
    if (!glossBlob) continue;

    const primaryKana = word.kana?.[0]?.text ?? '';
    const pos = collectPos(word.sense ?? []);
    const isCommon =
      (word.kanji ?? []).some((k) => k.common) || (word.kana ?? []).some((k) => k.common);

    const headwords = new Set();
    for (const k of word.kanji ?? []) headwords.add(k.text);
    for (const k of word.kana ?? []) headwords.add(k.text);
    if (!headwords.size) continue;

    for (const head of headwords) {
      // A kana headword reads as itself; a kanji headword takes the first kana.
      const reading = head === primaryKana ? '' : primaryKana;
      const record = [reading, isCommon ? '1' : '', pos, glossBlob].join(US);
      const bucket = index.get(head);
      if (bucket) {
        if (bucket.length < 6) bucket.push(record);
      } else {
        index.set(head, [record]);
      }
    }
    packedCount++;
  }

  console.log(`  ${packedCount.toLocaleString()} entries kept, ${index.size.toLocaleString()} headwords`);

  const obj = {};
  for (const [head, records] of index) obj[head] = records.join(RS);

  console.log('Compressing...');
  const json = JSON.stringify(obj);
  const gz = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
  await fs.writeFile(OUT_FILE, gz);

  const meta = {
    source: 'JMdict via jmdict-simplified',
    release: tag,
    asset: asset.name,
    subset: COMMON_ONLY ? 'common' : 'full',
    headwords: index.size,
    entries: packedCount,
    rawBytes: json.length,
    gzipBytes: gz.length,
    builtFor: 'hodoku',
    license: 'JMdict is Creative Commons Attribution-ShareAlike 4.0 (EDRDG)',
  };
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2) + '\n');

  console.log(
    `Wrote ${path.relative(ROOT, OUT_FILE)}: ` +
      `${(json.length / 1048576).toFixed(1)} MB raw -> ${(gz.length / 1048576).toFixed(1)} MB gzipped`,
  );
}

main().catch((err) => {
  console.error('\nDictionary build failed:', err.message);
  console.error('The extension still builds without it - you just lose word meanings.');
  process.exit(1);
});
