#!/usr/bin/env node
/**
 * Bundles the library to plain ESM, then runs the test suite against it.
 *
 * The library is written for the browser and imported without file extensions,
 * so Node cannot load the TypeScript directly — one esbuild pass is cheaper
 * than maintaining a second module resolution setup.
 */

import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(CACHE, 'lib.mjs');

const EXPORTS = `
export * from '${path.join(ROOT, 'src/lib/romaji.ts').replaceAll('\\\\', '/')}';
export * from '${path.join(ROOT, 'src/lib/kana.ts').replaceAll('\\\\', '/')}';
export * from '${path.join(ROOT, 'src/lib/grammar.ts').replaceAll('\\\\', '/')}';
export * from '${path.join(ROOT, 'src/lib/dict.ts').replaceAll('\\\\', '/')}';
export * from '${path.join(ROOT, 'src/lib/analyzer.ts').replaceAll('\\\\', '/')}';
export * from '${path.join(ROOT, 'src/lib/types.ts').replaceAll('\\\\', '/')}';
export * from '${path.join(ROOT, 'src/lib/providers/registry.ts').replaceAll('\\\\', '/')}';
export * from '${path.join(ROOT, 'src/lib/saved.ts').replaceAll('\\\\', '/')}';
export * from '${path.join(ROOT, 'src/lib/anki.ts').replaceAll('\\\\', '/')}';
export * from '${path.join(ROOT, 'src/lib/translation-cache.ts').replaceAll('\\\\', '/')}';
`;

await fs.mkdir(CACHE, { recursive: true });

await build({
  stdin: { contents: EXPORTS, resolveDir: ROOT, sourcefile: 'test-entry.ts', loader: 'ts' },
  outfile: OUT,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'node20',
  mainFields: ['module', 'main'],
  conditions: ['import', 'default'],
  logLevel: 'warning',
});

const testDir = path.join(ROOT, 'tests');
const testFiles = (await fs.readdir(testDir))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => path.join(testDir, name));

if (!testFiles.length) {
  console.error('No test files found in tests/');
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ['--test', ...process.argv.slice(2).filter(Boolean), ...testFiles],
  { stdio: 'inherit', cwd: ROOT },
);

child.on('exit', (code) => process.exit(code ?? 1));
