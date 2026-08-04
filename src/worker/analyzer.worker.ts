/**
 * Runs the morphological analyser off the main thread.
 *
 * Start-up is the expensive part: ~17 MB of compressed IPADIC plus the compiled
 * JMdict table. Keeping that on a worker means the offscreen document stays
 * responsive to messages while the dictionaries load and parse.
 */

import { Analyzer } from '../lib/analyzer';
import type { Analysis, RomajiStyle } from '../lib/types';

export type WorkerRequestPayload =
  | { type: 'init'; tokenizerBaseUrl: string; dictionaryUrl: string | null }
  | { type: 'analyze'; text: string; style: RomajiStyle }
  | { type: 'status' };

export type WorkerRequest = WorkerRequestPayload & { id: number };

export type WorkerReply = { id: number } & (
  | { ok: true; type: 'ready'; dictionaryHeadwords: number; dictionaryError: string | null }
  | { ok: true; type: 'analysis'; analysis: Analysis }
  | { ok: false; error: string }
);

/** Unsolicited load-progress updates; they carry no request id. */
export interface ProgressMessage {
  type: 'progress';
  message: string;
}

export type WorkerMessage = WorkerReply | ProgressMessage;

const analyzer = new Analyzer();

function post(message: WorkerMessage): void {
  (self as unknown as Worker).postMessage(message);
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data);
});

async function handle(request: WorkerRequest): Promise<void> {
  try {
    switch (request.type) {
      case 'init': {
        await analyzer.init(
          {
            tokenizerBaseUrl: request.tokenizerBaseUrl,
            dictionaryUrl: request.dictionaryUrl,
          },
          (message) => post({ type: 'progress', message }),
        );
        const stats = analyzer.stats;
        post({
          id: request.id,
          ok: true,
          type: 'ready',
          dictionaryHeadwords: stats.dictionaryHeadwords,
          dictionaryError: stats.dictionaryError,
        });
        return;
      }

      case 'analyze': {
        const analysis = analyzer.analyze(request.text, request.style);
        post({ id: request.id, ok: true, type: 'analysis', analysis });
        return;
      }

      case 'status': {
        const stats = analyzer.stats;
        post({
          id: request.id,
          ok: true,
          type: 'ready',
          dictionaryHeadwords: stats.dictionaryHeadwords,
          dictionaryError: stats.dictionaryError,
        });
        return;
      }
    }
  } catch (err) {
    post({
      id: request.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
