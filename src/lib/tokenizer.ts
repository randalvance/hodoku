/**
 * Loads kuromoji's IPADIC dictionary without XHR or Node's `path`.
 *
 * kuromoji ships a browser loader built on XMLHttpRequest plus a bundled gzip
 * implementation. Neither is a good fit here, so we assemble the dictionary
 * directly from `fetch` + the platform's own `DecompressionStream`, which works
 * identically in a worker, a document, and a service worker.
 */

import DynamicDictionaries from 'kuromoji/src/dict/DynamicDictionaries';
import Tokenizer from 'kuromoji/src/Tokenizer';
import type { IpadicToken } from 'kuromoji/src/Tokenizer';

export type { IpadicToken };

const TRIE_FILES = ['base.dat.gz', 'check.dat.gz'] as const;
const TOKEN_INFO_FILES = ['tid.dat.gz', 'tid_pos.dat.gz', 'tid_map.dat.gz'] as const;
const UNKNOWN_FILES = [
  'unk.dat.gz',
  'unk_pos.dat.gz',
  'unk_map.dat.gz',
  'unk_char.dat.gz',
  'unk_compat.dat.gz',
  'unk_invoke.dat.gz',
] as const;
const CONNECTION_FILE = 'cc.dat.gz';

const ALL_FILES = [
  ...TRIE_FILES,
  ...TOKEN_INFO_FILES,
  CONNECTION_FILE,
  ...UNKNOWN_FILES,
] as const;

async function loadGzipped(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error(`${url}: empty response body`);
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

export interface TokenizerLoadProgress {
  loaded: number;
  total: number;
}

/**
 * Build a tokenizer from the dictionary files under `baseUrl`.
 *
 * Files are fetched concurrently; the whole set is ~17 MB compressed, so this
 * is the expensive part of start-up and should happen once per worker.
 */
export async function createTokenizer(
  baseUrl: string,
  onProgress?: (progress: TokenizerLoadProgress) => void,
): Promise<Tokenizer> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  let loaded = 0;

  const buffers = new Map<string, ArrayBuffer>();
  await Promise.all(
    ALL_FILES.map(async (name) => {
      buffers.set(name, await loadGzipped(base + name));
      loaded++;
      onProgress?.({ loaded, total: ALL_FILES.length });
    }),
  );

  const get = (name: string): ArrayBuffer => {
    const buf = buffers.get(name);
    if (!buf) throw new Error(`Dictionary file missing: ${name}`);
    return buf;
  };

  const dic = new DynamicDictionaries();
  dic.loadTrie(new Int32Array(get('base.dat.gz')), new Int32Array(get('check.dat.gz')));
  dic.loadTokenInfoDictionaries(
    new Uint8Array(get('tid.dat.gz')),
    new Uint8Array(get('tid_pos.dat.gz')),
    new Uint8Array(get('tid_map.dat.gz')),
  );
  dic.loadConnectionCosts(new Int16Array(get(CONNECTION_FILE)));
  dic.loadUnknownDictionaries(
    new Uint8Array(get('unk.dat.gz')),
    new Uint8Array(get('unk_pos.dat.gz')),
    new Uint8Array(get('unk_map.dat.gz')),
    new Uint8Array(get('unk_char.dat.gz')),
    new Uint32Array(get('unk_compat.dat.gz')),
    new Uint8Array(get('unk_invoke.dat.gz')),
  );

  return new Tokenizer(dic);
}

export type { Tokenizer };
