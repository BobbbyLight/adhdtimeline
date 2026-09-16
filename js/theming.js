/**
 * theming.js — three independent axes: palette, flair intensity, reduce motion,
 * plus the accessibility typography settings (font family, line-height, letter-spacing).
 *
 * Persistence: IndexedDB (via storage.js) is the source of truth; a mirror in
 * localStorage lets a tiny inline script in index.html apply the theme
 * synchronously before first paint (IndexedDB access is async, so relying on
 * it alone would flash unstyled/wrong-theme content). theming.js reconciles
 * the two on init and keeps the mirror updated on every change.
 */

import { Storage } from "./storage.js";

export const THEMES = [
  { id: "vaporwave-bold", label: "Vaporwave Bold", mode: "dark" },
  { id: "vaporwave-soft", label: "Vaporwave Soft", mode: "light" },
  { id: "dark-gray", label: "Dark Gray", mode: "dark" },
  { id: "oled", label: "Black OLED", mode: "dark" },
  { id: "dark-blue", label: "Dark Blue", mode: "dark" },
  { id: "light-neutral", label: "Light Neutral", mode: "light" },
];

const DEFAULTS = {
  theme: null, // resolved from system preference on first launch
  flair: "subtle",
  reduceMotion: false,
  font: "atkinson",
  lineHeight: 1.5,
  letterSpacing: 0,
  ripeningEnabled: true,
};

const LS_PREFIX = "adhdtimeline:";

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function defaultThemeForSystem() {
  return systemPrefersDark() ? "dark-gray" : "light-neutral";
}

function readLocalMirror() {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw !== null) {
      try {
        out[key] = JSON.parse(raw);
      } catch {
        /* ignore corrupt entry */
      }
    }
  }
  return out;
}

function writeLocalMirror(key, value) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    /* localStorage unavailable (private mode etc) — IndexedDB remains source of truth */
  }
}

function applyToDocument(settings) {
  const root = document.documentElement;
  root.setAttribute("data-theme", settings.theme || defaultThemeForSystem());
  root.setAttribute("data-flair", settings.flair);
  root.setAttribute("data-reduce-motion", String(Boolean(settings.reduceMotion)));
  root.setAttribute("data-font", settings.font);
  root.style.setProperty("--line-height-base", String(settings.lineHeight));
  root.style.setProperty("--letter-spacing-base", `${settings.letterSpacing}em`);
}

let current = { ...DEFAULTS };
const listeners = new Set();

function notify() {
  for (const fn of listeners) fn({ ...current });
}

/** Applies whatever is in the localStorage mirror immediately (call as early as possible). */
export function applyImmediate() {
  const mirrored = readLocalMirror();
  current = { ...DEFAULTS, ...mirrored };
  if (!current.theme) current.theme = defaultThemeForSystem();
  applyToDocument(current);
  return { ...current };
}

/** Reconciles with IndexedDB (source of truth) once it's available; call once at startup. */
export async function init() {
  applyImmediate();
  const stored = await Storage.getAllSettings();
  const merged = { ...current };
  for (const key of Object.keys(DEFAULTS)) {
    if (stored[key] !== undefined) merged[key] = stored[key];
  }
  if (!merged.theme) merged.theme = defaultThemeForSystem();
  current = merged;
  applyToDocument(current);
  for (const key of Object.keys(DEFAULTS)) writeLocalMirror(key, current[key]);
  notify();
  return { ...current };
}

async function set(key, value) {
  current = { ...current, [key]: value };
  applyToDocument(current);
  writeLocalMirror(key, value);
  await Storage.setSetting(key, value);
  notify();
}

export const Theming = {
  THEMES,
  applyImmediate,
  init,
  get: () => ({ ...current }),
  onChange: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setTheme: (id) => set("theme", id),
  setFlair: (v) => set("flair", v),
  setReduceMotion: (v) => set("reduceMotion", v),
  setFont: (v) => set("font", v),
  setLineHeight: (v) => set("lineHeight", v),
  setLetterSpacing: (v) => set("letterSpacing", v),
  setRipeningEnabled: (v) => set("ripeningEnabled", v),
};
