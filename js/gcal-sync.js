/**
 * gcal-sync.js — optional, opt-in, read-only Google Calendar sync.
 *
 * This is the one deliberate exception to the app's local-only design: it
 * exists because the user asked for it explicitly, not by default. A few
 * things that make the exception as narrow as possible:
 *
 *  - Nothing here runs until the user pastes in their own Google OAuth
 *    Client ID (in Settings) and clicks Connect. Google's Identity
 *    Services script is only injected into the page at that point — a
 *    user who never touches this feature makes zero requests to Google.
 *  - Read-only scope (`calendar.readonly`) — this app can never create,
 *    edit, or delete anything on the user's real Google Calendar.
 *  - The OAuth Client ID is not a secret (that's how public/SPA OAuth
 *    clients work — it's meant to be visible in frontend code) but it
 *    IS specific to the user's own Google Cloud project, so it's stored
 *    locally like any other setting, never hardcoded here.
 *  - The access token lives in memory only (a module-level variable) —
 *    never written to IndexedDB/localStorage — so it disappears on
 *    reload rather than sitting around as a stored credential. A silent
 *    refresh is attempted on reload; if that fails the user just clicks
 *    Connect again.
 *  - Fetched events are never written into the tasks/events stores —
 *    they're normalized in memory each session and merged into the
 *    timeline read-only, so there's no drift/sync-conflict state to
 *    manage and nothing to accidentally "own" here.
 */

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

let gisLoadPromise = null;
let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;

function loadGisScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't reach Google — check your connection and try again."));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

function getOrCreateTokenClient(clientId, onToken) {
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: READONLY_SCOPE,
      callback: () => {}, // replaced per-call below
    });
  }
  tokenClient.callback = (resp) => {
    if (resp.error) {
      onToken(null, new Error(resp.error_description || resp.error));
      return;
    }
    accessToken = resp.access_token;
    tokenExpiresAt = Date.now() + resp.expires_in * 1000;
    onToken(accessToken, null);
  };
  return tokenClient;
}

/** Opens the Google consent popup. Resolves once a token is granted. */
export async function connect(clientId) {
  await loadGisScript();
  return new Promise((resolve, reject) => {
    const client = getOrCreateTokenClient(clientId, (token, err) => (err ? reject(err) : resolve(token)));
    client.requestAccessToken({ prompt: "consent" });
  });
}

/** Tries to get a usable token without a popup; throws if the user needs to re-connect. */
export async function ensureFreshToken(clientId) {
  if (accessToken && Date.now() < tokenExpiresAt - 60_000) return accessToken;
  await loadGisScript();
  return new Promise((resolve, reject) => {
    const client = getOrCreateTokenClient(clientId, (token, err) => (err ? reject(err) : resolve(token)));
    client.requestAccessToken({ prompt: "" });
  });
}

export function disconnect() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  tokenClient = null;
}

export function isConnected() {
  return Boolean(accessToken) && Date.now() < tokenExpiresAt;
}

async function apiFetch(path, params = {}) {
  const url = new URL(`${CALENDAR_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google Calendar API error (${res.status})`);
  return res.json();
}

/** @returns {Promise<Array<{id:string, summary:string, backgroundColor:string, primary:boolean}>>} */
export async function listCalendars() {
  const data = await apiFetch("/users/me/calendarList");
  return (data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary || c.id,
    backgroundColor: c.backgroundColor || "#4285f4",
    primary: Boolean(c.primary),
  }));
}

/** Fetches all events (recurrence already expanded by Google) in [timeMin, timeMax]. */
export async function listEvents(calendarId, timeMin, timeMax) {
  const events = [];
  let pageToken;
  do {
    const data = await apiFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      pageToken,
    });
    events.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return events;
}

/** Converts a raw Google event into this app's normalized shape. */
export function normalizeEvent(gEvent, calendarId) {
  const isAllDay = Boolean(gEvent.start?.date) && !gEvent.start?.dateTime;
  const start = isAllDay ? new Date(`${gEvent.start.date}T00:00:00`) : new Date(gEvent.start.dateTime);
  const end = isAllDay
    ? new Date(new Date(`${gEvent.end.date}T00:00:00`).getTime() - 1000)
    : new Date(gEvent.end.dateTime);
  return {
    id: gEvent.id,
    calendarId,
    title: gEvent.summary || "(untitled)",
    start,
    end,
    allDay: isAllDay,
    location: gEvent.location || "",
    description: gEvent.description || "",
    htmlLink: gEvent.htmlLink,
  };
}

export const GCalSync = {
  connect,
  ensureFreshToken,
  disconnect,
  isConnected,
  listCalendars,
  listEvents,
  normalizeEvent,
};
