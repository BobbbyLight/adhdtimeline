/**
 * quickAddRules.js — local, static shorthand expansion for the quick-add
 * panel. Typing a short recognized abbreviation ("pt apt", "mtg") expands
 * it to a full title and suggests a category, so capture stays fast
 * without needing to type (or remember) the whole phrase.
 *
 * Deliberately matches the WHOLE typed text, not a substring — so a real
 * sentence like "call the vet tomorrow" is never rewritten out from under
 * you; only a short recognized shorthand on its own triggers expansion.
 * This is fully local/static, same spirit as chunkingRules.js: no
 * AI/network call, and it's meant to be extended — add more entries to
 * RULES below as you notice your own recurring shorthand.
 *
 * Interface contract:
 *   expandQuickAddText(rawText: string) => { title: string, categoryNames: string[] }
 *   - Pure, synchronous, no I/O.
 *   - No match => returns the original text unchanged and an empty category list.
 *   - categoryNames are matched against existing category names case-insensitively
 *     by the caller; an unrecognized name is just ignored, never an error.
 */

const RULES = [
  { match: ["pt apt", "pt appt"], title: "PT Appointment", categoryNames: ["Health"] },
  { match: ["dr apt", "dr appt", "doctor apt", "doctors apt"], title: "Doctor's Appointment", categoryNames: ["Health"] },
  { match: ["dentist", "dentist apt", "dentist appt"], title: "Dentist Appointment", categoryNames: ["Health"] },
  { match: ["eye apt", "eye appt", "optometrist"], title: "Eye Doctor Appointment", categoryNames: ["Health"] },
  { match: ["derm apt", "derm appt", "dermatologist"], title: "Dermatologist Appointment", categoryNames: ["Health"] },
  { match: ["vet", "vet apt", "vet appt"], title: "Vet Appointment", categoryNames: ["Health"] },
  { match: ["gym", "workout"], title: "Gym", categoryNames: ["Health"] },
  { match: ["groceries", "grocery"], title: "Grocery Shopping", categoryNames: ["Errands"] },
  { match: ["mtg", "meeting"], title: "Meeting", categoryNames: ["Work"] },
  { match: ["1:1", "1-1", "one on one"], title: "1:1 Meeting", categoryNames: ["Work"] },
  { match: ["bday", "birthday"], title: "Birthday", categoryNames: ["Social"] },
  { match: ["rent"], title: "Pay Rent", categoryNames: ["Finance"] },
  { match: ["bills", "pay bills"], title: "Pay Bills", categoryNames: ["Finance"] },
  { match: ["oil change"], title: "Oil Change", categoryNames: ["Errands"] },
];

const LOOKUP = new Map();
for (const rule of RULES) {
  for (const phrase of rule.match) LOOKUP.set(phrase, rule);
}

function normalize(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
}

/**
 * @param {string} rawText
 * @returns {{ title: string, categoryNames: string[] }}
 */
export function expandQuickAddText(rawText) {
  const rule = LOOKUP.get(normalize(rawText));
  if (!rule) return { title: rawText, categoryNames: [] };
  return { title: rule.title, categoryNames: [...rule.categoryNames] };
}

export const QuickAddRules = { expandQuickAddText };
