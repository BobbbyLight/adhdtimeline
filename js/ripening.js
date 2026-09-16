/**
 * ripening.js — undated tasks slowly drift color the longer they sit
 * untouched, cool tones toward warm tones, within the active theme's own
 * palette (--ripening-start / --ripening-end, defined per-theme in
 * tokens.css — never a hardcoded color here, and never red/alarm).
 *
 * "Untouched" = time since the task was last opened, or created if it's
 * never been opened. Opening the task (storage.js touchTaskOpened) resets
 * the clock — the same lastOpenedAt field the in-progress-resurfacing
 * toast reads, so touching a task quiets both signals at once.
 */

/** Days of neglect to reach full ripeness. Assumption: 14 days feels like a
 *  meaningful-but-not-alarming span for a "this has been sitting" cue. */
const FULL_RIPEN_DAYS = 14;

/** True only for tasks ripening actually applies to: undated, not done. */
export function isRipenable(task) {
  return task.type === "task" && !task.dueDate && task.status !== "done";
}

/** 0 (just touched) .. 1 (fully ripened) */
export function computeRipeness(task, now = Date.now()) {
  if (!isRipenable(task)) return 0;
  const since = task.lastOpenedAt || task.createdAt;
  const days = Math.max(0, (now - since) / 86400000);
  return Math.min(1, days / FULL_RIPEN_DAYS);
}

/**
 * Applies (or clears) the ripening visual on an element via a CSS custom
 * property the stylesheet reads for a color-mix background/border.
 * @param {HTMLElement} el
 * @param {object} task
 * @param {boolean} enabled the user's Settings > Ripening toggle
 */
export function applyRipening(el, task, enabled) {
  if (!enabled || !isRipenable(task)) {
    el.classList.remove("is-ripening");
    el.style.removeProperty("--ripen");
    return;
  }
  el.classList.add("is-ripening");
  el.style.setProperty("--ripen", computeRipeness(task).toFixed(3));
}

export const Ripening = { isRipenable, computeRipeness, applyRipening, FULL_RIPEN_DAYS };
