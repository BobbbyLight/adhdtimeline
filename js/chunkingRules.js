/**
 * chunkingRules.js — placeholder module for baked-in chunking heuristics.
 *
 * Purpose: given a task's title (and optionally its category names),
 * return an array of suggested sub-step strings that the chunking UI
 * offers as one-tap-to-insert suggestions. This is a fully local, static
 * lookup — NOT a live AI/network call, and it must stay that way; the
 * chunking UI treats an empty result as "no suggestions" and falls back
 * silently to plain manual entry.
 *
 * This ships with a tiny illustrative example only. The intended use is
 * for the user to paste in their own richer ruleset (generated however
 * they like, offline, elsewhere) by extending RULES below or by
 * replacing suggestChunks() entirely — the rest of the app only depends
 * on the function signature, not on how the matching works internally.
 *
 * Interface contract:
 *   suggestChunks(title: string, categoryNames: string[]) => string[]
 *   - Pure, synchronous, no I/O.
 *   - Return [] when nothing matches — never throw.
 *   - Order is suggestion order (shown top to bottom).
 */

/** @type {Array<{ test: (title: string) => boolean, steps: string[] }>} */
const RULES = [
  {
    test: (title) => /\bclean(ing)?\b/i.test(title),
    steps: ["Gather supplies", "Pick one area to start", "Put things away", "Wipe surfaces"],
  },
  {
    test: (title) => /\be-?mail\b/i.test(title),
    steps: ["Open draft", "Say the one thing that matters", "Send"],
  },
];

/**
 * @param {string} title
 * @param {string[]} [categoryNames]
 * @returns {string[]}
 */
export function suggestChunks(title, categoryNames = []) {
  void categoryNames; // reserved for future rules keyed on category, unused by the example set
  if (!title) return [];
  for (const rule of RULES) {
    try {
      if (rule.test(title)) return [...rule.steps];
    } catch {
      /* a malformed pasted-in rule should never break the app */
    }
  }
  return [];
}

export const ChunkingRules = { suggestChunks };
