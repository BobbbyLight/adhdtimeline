/**
 * gemini.js — optional, opt-in AI assist via the Gemini API.
 *
 * Same posture as gcal-sync.js: nothing here runs until the user pastes
 * their own Gemini API key into Settings. There's no backend to proxy
 * this through (the app is a static site), so the key is necessarily
 * used directly from the browser and stored locally like any other
 * setting — never committed to the repo, never sent anywhere but
 * Google's API. That's a real tradeoff (a key typed into client-side
 * code is visible to anyone with access to that browser/device) worth
 * knowing, which is why this stays opt-in and the key stays local.
 *
 * Both features it powers are strictly additive on top of what already
 * works offline for free:
 *   - Freeform quick-add parsing still runs the local regex parser first
 *     (instant, no network) — an AI result only patches the panel's
 *     fields if/when it arrives, never blocks or delays capture.
 *   - Chunk suggestions still show the static chunkingRules.js matches
 *     for free; AI suggestions are only fetched on an explicit button
 *     press, never automatically, so a free-tier quota isn't silently
 *     burned by normal typing.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 10_000;

async function generateJSON(apiKey, model, prompt, responseSchema) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini API error (${res.status})`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no content");
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Asks Gemini to extract a clean title + date/time/recurrence hints from
 * freeform text — a more capable sibling of capture.js's regex parser.
 * @returns {Promise<{title:string, dueDateISO:string|null, allDay:boolean, recurrenceRule:string|null}>}
 */
export async function parseFreeformAI(apiKey, model, text, now = new Date()) {
  const schema = {
    type: "OBJECT",
    properties: {
      title: { type: "STRING" },
      dueDateISO: { type: "STRING", nullable: true },
      allDay: { type: "BOOLEAN" },
      recurrenceRule: { type: "STRING", nullable: true },
    },
    required: ["title", "allDay"],
  };
  const prompt = `You extract task details from a short piece of freeform text typed into a quick-add box.
Current date/time (use this to resolve relative dates like "tomorrow" or "next Thursday"): ${now.toISOString()} (local timezone offset ${-now.getTimezoneOffset()} minutes from UTC).

Input text: "${text.replace(/"/g, '\\"')}"

Return JSON with:
- title: the task title with any date/time/recurrence phrases removed, cleaned up to a short readable label. If nothing can be stripped, return the input as-is.
- dueDateISO: a full ISO 8601 datetime string (with timezone offset) for when this is due, or null if no date/time is mentioned. If only a date is mentioned with no time, use 09:00 local time.
- allDay: true only if the text clearly refers to a whole day/date with no specific time (e.g. "tomorrow", "on the 5th") rather than a specific moment.
- recurrenceRule: an RFC5545 RRULE string with no "RRULE:" prefix and no DTSTART (e.g. "FREQ=WEEKLY;BYDAY=TU") if the text describes a repeating pattern, otherwise null.`;

  const result = await generateJSON(apiKey, model, prompt, schema);
  return {
    title: result.title || text,
    dueDateISO: result.dueDateISO || null,
    allDay: Boolean(result.allDay),
    recurrenceRule: result.recurrenceRule || null,
  };
}

/**
 * Asks Gemini for 3-6 short, concrete sub-step suggestions for a task.
 * @returns {Promise<string[]>}
 */
export async function suggestChunksAI(apiKey, model, title, categoryNames = []) {
  const schema = { type: "ARRAY", items: { type: "STRING" } };
  const context = categoryNames.length ? ` (categories: ${categoryNames.join(", ")})` : "";
  const prompt = `Break this task down into 3 to 6 short, concrete, low-friction sub-steps a person with ADHD could act on immediately, in order. Each step should be a few words, not a sentence. Return a JSON array of strings only.

Task: "${title.replace(/"/g, '\\"')}"${context}`;

  const result = await generateJSON(apiKey, model, prompt, schema);
  if (!Array.isArray(result)) return [];
  return result.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
}

export const Gemini = { parseFreeformAI, suggestChunksAI };
