/**
 * The model's notes on a sentence, in a fixed template.
 *
 * Three lists rather than free text, so every explanation covers the same
 * ground: what grammar is in play, what does not follow the usual rules, and
 * which readings a learner could get wrong. Each item is one short sentence;
 * a list is empty when there is nothing worth saying.
 *
 * Its own module, with no imports, because both the settings types and the
 * Anki client need it and anything shared between those two would otherwise
 * form an import cycle.
 */

export interface Explanation {
  /** Conjugations, particles and sentence patterns, and what each does here. */
  grammar: string[];
  /** Idioms, set phrases, contractions, irregular or colloquial usage. */
  exceptions: string[];
  /** Irregular kanji readings, rendaku, ateji, particles read unlike their spelling. */
  readings: string[];
}

/** The sections of an explanation, in display order, with their labels. */
export const EXPLANATION_SECTIONS: Array<{ key: keyof Explanation; label: string }> = [
  { key: 'grammar', label: 'Grammar' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'readings', label: 'Readings' },
];

/** True when at least one section has something to say. */
export function hasExplanation(explanation: Explanation | undefined): explanation is Explanation {
  return Boolean(explanation && EXPLANATION_SECTIONS.some(({ key }) => explanation[key]?.length));
}

/**
 * The explanation flattened to "Label: item" lines, for exports and cards.
 * A legacy free-form note is included as-is so old records lose nothing.
 */
export function explanationLines(item: { explanation?: Explanation; note?: string }): string[] {
  const lines: string[] = [];
  for (const { key, label } of EXPLANATION_SECTIONS) {
    for (const entry of item.explanation?.[key] ?? []) lines.push(`${label}: ${entry}`);
  }
  if (item.note) lines.push(item.note);
  return lines;
}
