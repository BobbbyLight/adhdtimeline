/**
 * ics-import.js — manual .ics file picker → parses VEVENT blocks into local Events.
 *
 * Assumption: timezone handling is simplified. A DTSTART/DTEND ending in "Z"
 * is treated as UTC and converted to the browser's local time; anything else
 * (bare local time, or a TZID param) is treated as floating local time —
 * i.e. the numbers in the file are used as-is as local wall-clock time. Full
 * IANA timezone-database resolution is out of scope for a local-only,
 * dependency-light importer.
 */

import { Storage } from "./storage.js";

function unfold(text) {
  // RFC5545: a line starting with a space or tab is a continuation of the previous line.
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function parseIcsDate(value) {
  // value looks like 20260920T150000Z, 20260920T150000, or 20260920 (date-only)
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) {
    // all-day event — represent as local midnight
    return new Date(Number(y), Number(mo) - 1, Number(d));
  }
  if (z) {
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  }
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

function unescapeText(value) {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseLine(line) {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  const left = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const [name] = left.split(";");
  return { name: name.toUpperCase(), value };
}

/** @returns {Array<{summary,start,end,location,description,rrule,uid}>} */
export function parseICS(text) {
  const lines = unfold(text).split("\n").map((l) => l.trim()).filter(Boolean);
  const events = [];
  let current = null;

  for (const rawLine of lines) {
    if (rawLine === "BEGIN:VEVENT") {
      current = { summary: "", start: null, end: null, location: "", description: "", rrule: null, uid: "" };
      continue;
    }
    if (rawLine === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const parsed = parseLine(rawLine);
    if (!parsed) continue;
    const { name, value } = parsed;

    switch (name) {
      case "SUMMARY":
        current.summary = unescapeText(value);
        break;
      case "DTSTART":
        current.start = parseIcsDate(value);
        break;
      case "DTEND":
        current.end = parseIcsDate(value);
        break;
      case "LOCATION":
        current.location = unescapeText(value);
        break;
      case "DESCRIPTION":
        current.description = unescapeText(value);
        break;
      case "RRULE":
        current.rrule = value;
        break;
      case "UID":
        current.uid = value;
        break;
      default:
        break;
    }
  }

  return events;
}

function descriptionToNotes(description) {
  if (!description) return [];
  return description.split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * Parses an .ics File and stores each VEVENT as a local Event.
 * @param {File} file
 * @returns {Promise<{imported: number, skipped: number}>}
 */
export async function importICSFile(file) {
  const text = await file.text();
  const parsed = parseICS(text);
  let imported = 0;
  let skipped = 0;

  for (const raw of parsed) {
    if (!raw.start) {
      skipped++;
      continue;
    }
    const start = raw.start;
    const end = raw.end || new Date(start.getTime() + 3600000);
    await Storage.addEvent({
      title: raw.summary || "Untitled event",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      location: raw.location,
      notes: descriptionToNotes(raw.description),
      recurrence: raw.rrule ? { rule: raw.rrule.replace(/^RRULE:/i, ""), exceptions: [], overrides: {} } : null,
    });
    imported++;
  }

  return { imported, skipped };
}

export const IcsImport = { parseICS, importICSFile };
