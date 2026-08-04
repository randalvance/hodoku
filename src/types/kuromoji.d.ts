/**
 * Minimal typings for the kuromoji internals we construct directly.
 *
 * The package's public builder assumes XHR and Node's `path`, neither of which
 * suits an MV3 extension, so we assemble the dictionary ourselves and skip it.
 */

declare module 'kuromoji/src/dict/DynamicDictionaries' {
  export default class DynamicDictionaries {
    loadTrie(baseBuffer: Int32Array, checkBuffer: Int32Array): void;
    loadTokenInfoDictionaries(
      tokenInfoBuffer: Uint8Array,
      posBuffer: Uint8Array,
      targetMapBuffer: Uint8Array,
    ): void;
    loadConnectionCosts(ccBuffer: Int16Array): void;
    loadUnknownDictionaries(
      unkBuffer: Uint8Array,
      unkPosBuffer: Uint8Array,
      unkMapBuffer: Uint8Array,
      catMapBuffer: Uint8Array,
      compatCatMapBuffer: Uint32Array,
      invokeDefBuffer: Uint8Array,
    ): void;
  }
}

declare module 'kuromoji/src/Tokenizer' {
  import type DynamicDictionaries from 'kuromoji/src/dict/DynamicDictionaries';

  export interface IpadicToken {
    word_id: number;
    word_type: 'KNOWN' | 'UNKNOWN';
    word_position: number;
    surface_form: string;
    pos: string;
    pos_detail_1: string;
    pos_detail_2: string;
    pos_detail_3: string;
    conjugated_type: string;
    conjugated_form: string;
    basic_form: string;
    reading?: string;
    pronunciation?: string;
  }

  export default class Tokenizer {
    constructor(dictionaries: DynamicDictionaries);
    tokenize(text: string): IpadicToken[];
  }
}
