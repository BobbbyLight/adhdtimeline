/**
 * timeline-vertical.js — primary view. A center spine represents time,
 * top to bottom; items alternate left/right purely by sequence position
 * (1st left, 2nd right, 3rd left...) regardless of task-vs-event — the
 * alternation is for visual separation only, it carries no meaning.
 * Category color (the node dot + a stripe on the card) is the meaningful
 * channel. Undated tasks live in a separate "Anytime" pool above the
 * spine, since they're a first-class state, not something to force onto
 * a chronological line.
 */

import { Ripening } from "./ripening.js";

const COUNTDOWN_LEAD_MS = 3 * 3600 * 1000; // ring starts shrinking 3h before an item's start

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Status: not started / in progress / done — "in progress" is derived, not stored. */
function getEffectiveStatus(task) {
  if (task.status === "done") return "done";
  if (task.lastOpenedAt) return "in_progress";
  return "not_started";
}

function formatTimeLabel(item) {
  if (!item.start) return "";
  if (item.allDay) return "All day";
  const opts = { hour: "numeric", minute: "2-digit" };
  if (item.end) {
    return `${item.start.toLocaleTimeString([], opts)} – ${item.end.toLocaleTimeString([], opts)}`;
  }
  return item.start.toLocaleTimeString([], opts);
}

function formatDateDivider(date, today) {
  const d0 = startOfDay(date).getTime();
  const t0 = startOfDay(today).getTime();
  const diffDays = Math.round((d0 - t0) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function computeCountdownProgress(item, now) {
  const start = item.start;
  const end = item.end || item.start;
  if (!start) return null;
  const windowStart = new Date(Math.max(startOfDay(now).getTime(), start.getTime() - COUNTDOWN_LEAD_MS));
  if (now <= windowStart) return 1;
  if (now >= end) return 0;
  return 1 - (now - windowStart) / (end - windowStart);
}

function categoryStripe(categories) {
  if (!categories.length) return "var(--border)";
  if (categories.length === 1) return categories[0].color;
  const stops = categories.map((c, i) => `${c.color} ${(i / categories.length) * 100}%, ${c.color} ${((i + 1) / categories.length) * 100}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function renderCountdownRing(item) {
  const progress = computeCountdownProgress(item, new Date());
  if (progress === null) return null;
  const r = 16;
  const c = 2 * Math.PI * r;
  const wrap = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  wrap.setAttribute("viewBox", "0 0 40 40");
  wrap.setAttribute("width", "36");
  wrap.setAttribute("height", "36");
  wrap.classList.add("countdown-ring");
  wrap.dataset.start = item.start.getTime();
  wrap.dataset.end = (item.end || item.start).getTime();
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", "Time remaining indicator");
  wrap.innerHTML = `
    <circle cx="20" cy="20" r="${r}" class="countdown-ring-track" fill="none" stroke-width="4"></circle>
    <circle cx="20" cy="20" r="${r}" class="countdown-ring-fill" fill="none" stroke-width="4"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - progress)}" transform="rotate(-90 20 20)"></circle>`;
  return wrap;
}

/** Re-reads each rendered ring's stored start/end and updates its fill — call on an interval. */
export function updateCountdownRings(root) {
  const now = new Date();
  root.querySelectorAll(".countdown-ring").forEach((svg) => {
    const start = new Date(Number(svg.dataset.start));
    const end = new Date(Number(svg.dataset.end));
    const progress = computeCountdownProgress({ start, end }, now);
    const fill = svg.querySelector(".countdown-ring-fill");
    const r = 16;
    const c = 2 * Math.PI * r;
    fill.setAttribute("stroke-dashoffset", String(c * (1 - progress)));
  });
}

function renderAnytimeCard(task, { ripeningEnabled, onItemClick, onToggleTaskDone, categories }) {
  const card = document.createElement("div");
  card.className = "anytime-card";
  card.setAttribute("role", "button");
  card.tabIndex = 0;

  const taskCategories = (task.categoryIds || []).map((id) => categories.find((c) => c.id === id)).filter(Boolean);
  card.style.setProperty("--card-category-color", taskCategories[0]?.color || "var(--border)");
  if (getEffectiveStatus(task) === "in_progress") card.classList.add("is-in-progress");

  Ripening.applyRipening(card, task, ripeningEnabled);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "anytime-checkbox";
  checkbox.checked = task.status === "done";
  checkbox.setAttribute("aria-label", `Mark "${task.title}" done`);
  checkbox.addEventListener("click", (e) => {
    e.stopPropagation();
    onToggleTaskDone(task);
  });

  if (taskCategories[0]) {
    const icon = document.createElement("span");
    icon.className = "anytime-card-icon";
    icon.textContent = taskCategories[0].icon || "🏷️";
    card.appendChild(icon);
  }

  const title = document.createElement("span");
  title.className = "anytime-card-title";
  title.textContent = task.title;

  card.append(checkbox, title);
  card.addEventListener("click", () => onItemClick({ sourceType: "task", sourceId: task.id, raw: task }));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onItemClick({ sourceType: "task", sourceId: task.id, raw: task });
    }
  });
  return card;
}

function renderSpineCard(item, side, { onItemClick, onToggleTaskDone }) {
  const wrap = document.createElement("div");
  wrap.className = `spine-item spine-item--${side}`;

  const node = document.createElement("div");
  node.className = "spine-node";
  node.style.background = item.category?.color || "var(--border)";
  if (item.importance === "critical") node.classList.add("spine-node--critical");

  const card = document.createElement("div");
  card.className = "spine-card";
  card.style.setProperty("--card-stripe", categoryStripe(item.categories));
  card.setAttribute("role", "button");
  card.tabIndex = 0;

  const stripe = document.createElement("div");
  stripe.className = "spine-card-stripe";

  const titleRow = document.createElement("div");
  titleRow.className = "spine-card-title-row";
  if (item.category) {
    const icon = document.createElement("span");
    icon.className = "spine-card-icon";
    icon.textContent = item.category.icon || "🏷️";
    titleRow.appendChild(icon);
  }
  const title = document.createElement("h3");
  title.className = "spine-card-title";
  title.textContent = item.title;
  titleRow.appendChild(title);

  const time = document.createElement("div");
  time.className = "spine-card-time";
  time.textContent = formatTimeLabel(item);

  card.append(stripe, titleRow, time);

  if (item.sourceType === "task") {
    if (getEffectiveStatus(item.raw) === "in_progress") card.classList.add("is-in-progress");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "spine-card-checkbox";
    checkbox.checked = item.status === "done";
    checkbox.setAttribute("aria-label", `Mark "${item.title}" done`);
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      onToggleTaskDone(item.raw);
    });
    card.appendChild(checkbox);
  }

  if (item.isToday && item.isTimed) {
    const ring = renderCountdownRing(item);
    if (ring) card.appendChild(ring);
  }

  card.addEventListener("click", () => onItemClick(item));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onItemClick(item);
    }
  });

  wrap.append(node, card);
  return wrap;
}

/**
 * @param {HTMLElement} container
 * @param {{items: Array, undatedTasks: Array, categories: Array, ripeningEnabled: boolean,
 *           onItemClick: Function, onToggleTaskDone: Function}} ctx
 */
export function renderVerticalTimeline(container, ctx) {
  const { items, undatedTasks, categories, ripeningEnabled, onItemClick, onToggleTaskDone } = ctx;
  container.innerHTML = "";
  container.className = "timeline-vertical-root";

  if (undatedTasks.length) {
    const pool = document.createElement("section");
    pool.className = "anytime-pool";
    const heading = document.createElement("h2");
    heading.className = "anytime-pool-heading";
    heading.textContent = "Anytime";
    const scroller = document.createElement("div");
    scroller.className = "anytime-pool-scroller";
    for (const task of undatedTasks) {
      scroller.appendChild(renderAnytimeCard(task, { ripeningEnabled, onItemClick, onToggleTaskDone, categories }));
    }
    pool.append(heading, scroller);
    container.appendChild(pool);
  }

  const spine = document.createElement("div");
  spine.className = "timeline-vertical";
  const spineLine = document.createElement("div");
  spineLine.className = "spine-line";
  spine.appendChild(spineLine);

  const today = new Date();
  let lastDayKey = null;
  let sequenceIndex = 0;

  const sorted = [...items].sort((a, b) => a.start - b.start);
  for (const item of sorted) {
    const dayKey = startOfDay(item.start).getTime();
    if (dayKey !== lastDayKey) {
      lastDayKey = dayKey;
      const divider = document.createElement("div");
      divider.className = "spine-date-divider";
      divider.textContent = formatDateDivider(item.start, today);
      spine.appendChild(divider);
    }
    const side = sequenceIndex % 2 === 0 ? "left" : "right";
    sequenceIndex++;
    spine.appendChild(renderSpineCard(item, side, { onItemClick, onToggleTaskDone }));
  }

  if (!sorted.length) {
    const empty = document.createElement("p");
    empty.className = "timeline-empty-state";
    empty.textContent = "Nothing scheduled in this window yet.";
    spine.appendChild(empty);
  }

  container.appendChild(spine);
}
