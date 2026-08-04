/**
 * Bridge between the service worker and the analysis worker.
 *
 * The offscreen document is the only extension context that both persists
 * across service-worker restarts and can spawn a Web Worker, which is what
 * keeps the loaded dictionaries warm between lookups.
 */

import type {
  WorkerMessage,
  WorkerReply,
  WorkerRequest,
  WorkerRequestPayload,
} from '../worker/analyzer.worker';
import type { Analysis, RomajiStyle } from '../lib/types';

/** Messages the service worker addresses to this document. */
export type OffscreenRequest =
  | { target: 'offscreen'; type: 'analyze'; text: string; style: RomajiStyle }
  | { target: 'offscreen'; type: 'status' };

export type OffscreenResponse =
  | { ok: true; analysis: Analysis }
  | { ok: true; ready: boolean; dictionaryHeadwords: number; dictionaryError: string | null }
  | { ok: false; error: string };

const worker = new Worker(chrome.runtime.getURL('worker/analyzer.worker.js'), {
  type: 'module',
  name: 'romaji-analyzer',
});

let nextRequestId = 1;
const pending = new Map<number, { resolve: (value: WorkerReply) => void; reject: (err: Error) => void }>();

/** Latest progress line, surfaced in the popup while the dictionaries load. */
let progress = 'Starting…';

worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (!('id' in message)) {
    progress = message.message;
    return;
  }
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  entry.resolve(message);
});

worker.addEventListener('error', (event) => {
  const error = new Error(event.message || 'Analyzer worker crashed');
  for (const [, entry] of pending) entry.reject(error);
  pending.clear();
});

function callWorker(request: WorkerRequestPayload): Promise<WorkerReply> {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...request, id } as WorkerRequest);
  });
}

/**
 * Kick off dictionary loading immediately. Every analyze request awaits this,
 * so the first lookup after install waits once and later ones are instant.
 */
const ready = (async () => {
  const response = await callWorker({
    type: 'init',
    tokenizerBaseUrl: chrome.runtime.getURL('dict/kuromoji/'),
    dictionaryUrl: chrome.runtime.getURL('dict/jmdict.bin'),
  });
  if (!response.ok) throw new Error(response.error);
  progress = 'Ready';
  return response;
})();

let readyError: string | null = null;
ready.catch((err: unknown) => {
  readyError = err instanceof Error ? err.message : String(err);
  progress = `Failed: ${readyError}`;
});

chrome.runtime.onMessage.addListener(
  (
    message: OffscreenRequest,
    _sender,
    sendResponse: (response: OffscreenResponse) => void,
  ): boolean | undefined => {
    // Other extension pages share this channel; ignore anything not for us.
    if (!message || message.target !== 'offscreen') return undefined;

    void (async () => {
      try {
        if (message.type === 'status') {
          if (readyError) {
            sendResponse({ ok: false, error: readyError });
            return;
          }
          const settled = await Promise.race([
            ready.then(() => true),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), 50)),
          ]);
          if (!settled) {
            sendResponse({ ok: false, error: progress });
            return;
          }
          const status = await ready;
          sendResponse({
            ok: true,
            ready: true,
            dictionaryHeadwords: status.type === 'ready' ? status.dictionaryHeadwords : 0,
            dictionaryError: status.type === 'ready' ? status.dictionaryError : null,
          });
          return;
        }

        await ready;
        const response = await callWorker({
          type: 'analyze',
          text: message.text,
          style: message.style,
        });
        if (!response.ok) {
          sendResponse({ ok: false, error: response.error });
          return;
        }
        if (response.type !== 'analysis') {
          sendResponse({ ok: false, error: 'Unexpected worker response' });
          return;
        }
        sendResponse({ ok: true, analysis: response.analysis });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();

    // Keep the message channel open for the async response.
    return true;
  },
);
