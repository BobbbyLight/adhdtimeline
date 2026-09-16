/**
 * recurrence.js — RFC 5545 RRULE integration on top of rrule.js
 * (loaded globally as window.rrule via js/vendor/rrule.js, a plain
 * <script> tag — it's a webpack UMD build, not an ES module).
 *
 * Storage shape (see storage.js `recurrence` field on tasks/events):
 *   {
 *     rule: "FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=1",   // RFC5545 text, no DTSTART
 *     exceptions: ["2026-09-20"],                       // occurrence dates removed from the series
 *     overrides: { "2026-09-22": { title: "...", dueDate: "..." } } // single-instance edits
 *   }
 * The base due/start date on the record itself doubles as DTSTART.
 *
 * rrule.js computes in UTC. To get correct "floating" wall-clock local
 * time (no DST surprises), every JS Date that goes in or out of rrule.js
 * is translated through toFloatingUTC/fromFloatingUTC below — a Date
 * whose UTC getters equal the *local* wall-clock numbers we actually mean.
 */

const { RRule } = window.rrule;

function toFloatingUTC(localDate) {
  return new Date(
    Date.UTC(
      localDate.getFullYear(),
      localDate.getMonth(),
      localDate.getDate(),
      localDate.getHours(),
      localDate.getMinutes(),
      localDate.getSeconds()
    )
  );
}

function fromFloatingUTC(utcDate) {
  return new Date(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth(),
    utcDate.getUTCDate(),
    utcDate.getUTCHours(),
    utcDate.getUTCMinutes(),
    utcDate.getUTCSeconds()
  );
}

function dateKey(localDate) {
  const y = localDate.getFullYear();
  const m = String(localDate.getMonth() + 1).padStart(2, "0");
  const d = String(localDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Parses a stored { rule, dtstartISO } pair into a live RRule instance.
 * @param {string} ruleString RFC5545 RRULE text (no DTSTART/RRULE: prefix required, either is fine)
 * @param {Date} dtstart local wall-clock start date/time
 */
function parseRule(ruleString, dtstart) {
  if (!ruleString) return null;
  const body = ruleString.trim().startsWith("RRULE:") ? ruleString.trim() : `RRULE:${ruleString.trim()}`;
  const dtstartLine = `DTSTART:${toIcsFloating(dtstart)}`;
  return RRule.fromString(`${dtstartLine}\n${body}`);
}

function toIcsFloating(localDate) {
  const utc = toFloatingUTC(localDate);
  return (
    utc.getUTCFullYear() +
    pad2(utc.getUTCMonth() + 1) +
    pad2(utc.getUTCDate()) +
    "T" +
    pad2(utc.getUTCHours()) +
    pad2(utc.getUTCMinutes()) +
    pad2(utc.getUTCSeconds()) +
    "Z"
  );
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Builds an RFC5545 RRULE text string from a friendly config object,
 * as produced by the recurrence editor UI.
 * @param {{freq:string, interval?:number, byweekday?:string[], bymonthday?:number[],
 *           bysetpos?:number[], count?:number, until?:Date}} cfg
 */
function buildRuleString(cfg) {
  const parts = [`FREQ=${cfg.freq}`];
  if (cfg.interval && cfg.interval > 1) parts.push(`INTERVAL=${cfg.interval}`);
  if (cfg.byweekday && cfg.byweekday.length) parts.push(`BYDAY=${cfg.byweekday.join(",")}`);
  if (cfg.bymonthday && cfg.bymonthday.length) parts.push(`BYMONTHDAY=${cfg.bymonthday.join(",")}`);
  if (cfg.bysetpos && cfg.bysetpos.length) parts.push(`BYSETPOS=${cfg.bysetpos.join(",")}`);
  if (cfg.count) parts.push(`COUNT=${cfg.count}`);
  if (cfg.until) parts.push(`UNTIL=${toIcsFloating(cfg.until)}`);
  return parts.join(";");
}

/** Human-readable description, e.g. "every 2 weeks on Monday, Wednesday" */
function describeRule(ruleString, dtstart) {
  const rule = parseRule(ruleString, dtstart);
  if (!rule) return "";
  try {
    return rule.toText();
  } catch {
    return ruleString;
  }
}

/**
 * Expands a recurring item into concrete occurrences within [rangeStart, rangeEnd],
 * applying exceptions (dropped) and overrides (patched fields) on top of the base item.
 * Non-recurring items should not call this — callers check `item.recurrence` first.
 *
 * @param {object} item task or event record, with recurrence + its own base date field
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @param {Date} baseDate the item's own due/start date (dtstart)
 * @returns {Array<{occurrenceDate: Date, key: string, isOverride: boolean, data: object}>}
 */
function expandOccurrences(item, rangeStart, rangeEnd, baseDate) {
  const recurrence = item.recurrence;
  if (!recurrence || !recurrence.rule || !baseDate) return [];

  const rule = parseRule(recurrence.rule, baseDate);
  const floatingStart = toFloatingUTC(rangeStart);
  const floatingEnd = toFloatingUTC(rangeEnd);
  const occurrencesUTC = rule.between(floatingStart, floatingEnd, true);

  const exceptions = new Set(recurrence.exceptions || []);
  const overrides = recurrence.overrides || {};

  return occurrencesUTC
    .map((utcDate) => fromFloatingUTC(utcDate))
    .map((occurrenceDate) => ({ occurrenceDate, key: dateKey(occurrenceDate) }))
    .filter(({ key }) => !exceptions.has(key))
    .map(({ occurrenceDate, key }) => {
      const override = overrides[key];
      return {
        occurrenceDate,
        key,
        isOverride: Boolean(override),
        data: override ? { ...item, ...override } : item,
      };
    });
}

/** Returns a new recurrence object with a single instance removed from the series. */
function deleteInstance(recurrence, occurrenceDate) {
  const key = dateKey(occurrenceDate);
  const exceptions = new Set(recurrence.exceptions || []);
  exceptions.add(key);
  const overrides = { ...(recurrence.overrides || {}) };
  delete overrides[key];
  return { ...recurrence, exceptions: [...exceptions], overrides };
}

/** Returns a new recurrence object where a single instance carries a field patch. */
function editInstance(recurrence, occurrenceDate, patch) {
  const key = dateKey(occurrenceDate);
  const overrides = { ...(recurrence.overrides || {}), [key]: patch };
  return { ...recurrence, overrides };
}

/**
 * Splits a series "going forward": the original series gets an UNTIL the day
 * before `fromDate`, and the caller is expected to create a brand-new
 * task/event starting at `fromDate` carrying the edited fields + the same
 * (or a new) recurrence rule. Returns the truncated original recurrence,
 * or null if fromDate is on/before the series start (nothing to truncate).
 */
function truncateSeriesBefore(recurrence, fromDate) {
  const until = new Date(fromDate);
  until.setDate(until.getDate() - 1);
  until.setHours(23, 59, 59, 0);
  return { ...recurrence, rule: appendUntil(recurrence.rule, until) };
}

function appendUntil(ruleString, until) {
  const withoutUntil = ruleString
    .split(";")
    .filter((p) => !p.startsWith("UNTIL=") && !p.startsWith("COUNT="))
    .join(";");
  return `${withoutUntil};UNTIL=${toIcsFloating(until)}`;
}

export const Recurrence = {
  parseRule,
  buildRuleString,
  describeRule,
  expandOccurrences,
  deleteInstance,
  editInstance,
  truncateSeriesBefore,
  dateKey,
};
