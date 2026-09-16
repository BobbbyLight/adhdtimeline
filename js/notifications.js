/**
 * notifications.js — foreground reminder engine + importance-driven intensity.
 *
 * Scope, per spec: reliable foreground notifications while the app is open,
 * plus an on-open "due today" summary. No attempt at exact-time background
 * push while the PWA is closed — that's a known-unreliable platform
 * limitation, not something to fake.
 *
 * This module owns *how* a reminder is presented (mechanism); it stays
 * decoupled from *what* is due by taking a `getDueReminders(nowMs)` callback
 * from the caller (app.js), which knows how to combine tasks, events and
 * expanded recurrence occurrences. A reminder looks like:
 *   { key: string, title: string, subtitle?: string, whenMs: number, importance: 'low'|'normal'|'high'|'critical' }
 */

import { Storage } from "./storage.js";

const CHECK_INTERVAL_MS = 20_000;
const FIRED_KEYS_SETTING = "firedNotificationKeys";
const FIRED_KEYS_RETENTION_MS = 3 * 86400000;

let firedKeys = new Map(); // key -> firedAtMs
let intervalHandle = null;
let getDueReminders = null;
let onCriticalAlert = null;

async function loadFiredKeys() {
  const stored = await Storage.getSetting(FIRED_KEYS_SETTING, []);
  const now = Date.now();
  firedKeys = new Map(stored.filter(([, at]) => now - at < FIRED_KEYS_RETENTION_MS));
}

async function persistFiredKeys() {
  await Storage.setSetting(FIRED_KEYS_SETTING, [...firedKeys.entries()]);
}

export async function requestPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "default") return Notification.requestPermission();
  return Notification.permission;
}

function canNotify() {
  return "Notification" in window && Notification.permission === "granted";
}

function fireBrowserNotification(reminder) {
  if (!canNotify()) return;
  const persistent = reminder.importance === "high" || reminder.importance === "critical";
  try {
    new Notification(reminder.title, {
      body: reminder.subtitle || "",
      tag: reminder.key,
      requireInteraction: persistent,
      silent: reminder.importance === "low",
    });
  } catch {
    /* some browsers throw constructing Notification outside a user gesture in edge cases — non-fatal */
  }
}

/** Small self-contained beep — no bundled audio asset needed. */
function playAlertTone() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.55);
  } catch {
    /* Web Audio unavailable/blocked — the overlay + browser notification still carry the alert */
  }
}

function presentReminder(reminder) {
  fireBrowserNotification(reminder);
  if (reminder.importance === "critical") {
    playAlertTone();
    if (onCriticalAlert) onCriticalAlert(reminder);
    else showBuiltInCriticalOverlay(reminder);
  }
}

function showBuiltInCriticalOverlay(reminder) {
  const overlay = document.createElement("div");
  overlay.className = "critical-alert-overlay";
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="critical-alert-card">
      <div class="critical-alert-label">Time-critical</div>
      <h2 class="critical-alert-title"></h2>
      <p class="critical-alert-subtitle"></p>
      <button type="button" class="critical-alert-dismiss">Got it</button>
    </div>`;
  overlay.querySelector(".critical-alert-title").textContent = reminder.title;
  overlay.querySelector(".critical-alert-subtitle").textContent = reminder.subtitle || "";
  overlay.querySelector(".critical-alert-dismiss").addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

async function tick() {
  if (!getDueReminders) return;
  const now = Date.now();
  const due = getDueReminders(now).filter((r) => r.whenMs <= now && !firedKeys.has(r.key));
  if (!due.length) return;
  for (const reminder of due) {
    presentReminder(reminder);
    firedKeys.set(reminder.key, now);
  }
  await persistFiredKeys();
}

/**
 * Starts the foreground reminder loop.
 * @param {(nowMs: number) => Array} dueReminderProvider
 * @param {(reminder: object) => void} [criticalAlertHandler] override for the built-in overlay
 */
export async function init(dueReminderProvider, criticalAlertHandler) {
  getDueReminders = dueReminderProvider;
  onCriticalAlert = criticalAlertHandler || null;
  await loadFiredKeys();
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(tick, CHECK_INTERVAL_MS);
  tick();
}

export function stop() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

/**
 * On-open summary notification for items due today. No shaming language,
 * no count-as-failure framing — just a neutral heads-up. Fires at most once
 * per calendar day (tracked via the `lastSummaryDate` setting).
 */
export async function fireDueTodaySummaryOnce(count) {
  const todayKey = new Date().toDateString();
  const lastDate = await Storage.getSetting("lastSummaryDate", null);
  if (lastDate === todayKey) return;
  await Storage.setSetting("lastSummaryDate", todayKey);
  if (count <= 0 || !canNotify()) return;
  const body = count === 1 ? "One thing on deck today." : `${count} things on deck today.`;
  try {
    new Notification("Today", { body, tag: "daily-summary", silent: true });
  } catch {
    /* non-fatal */
  }
}

export const Notifications = { requestPermission, init, stop, fireDueTodaySummaryOnce };
