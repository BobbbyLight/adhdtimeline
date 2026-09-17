import { Storage } from "./storage.js";
import { Theming, THEMES } from "./theming.js";
import { Recurrence } from "./recurrence.js";
import { Chunking } from "./chunking.js";
import { Ripening } from "./ripening.js";
import { Notifications } from "./notifications.js";
import { Capture } from "./capture.js";
import { IcsImport } from "./ics-import.js";
import { Backup } from "./backup.js";
import { ensureDefaultCategories, nextCustomColor, defaultCustomIcon } from "./categories.js";
import { renderDatePicker } from "./date-picker.js";
import { QuickAddRules } from "./quickAddRules.js";
import { renderVerticalTimeline, updateCountdownRings } from "./timeline-vertical.js";
import { renderHorizontalTimeline } from "./timeline-horizontal.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  tasks: [],
  events: [],
  categories: [],
  viewMode: "vertical", // vertical | horizontal
  hZoom: "day", // day | week
  hViewDate: new Date(),
  settings: {},
};

const RANGE_PAST_DAYS = 7;
const RANGE_FUTURE_DAYS = 90;

const el = {
  timelineContainer: document.getElementById("timeline-container"),
  quickAddContainer: document.getElementById("quick-add-container"),
  toastRegion: document.getElementById("toast-region"),
  modalRoot: document.getElementById("modal-root"),
  viewToggleBtn: document.getElementById("view-toggle-btn"),
  settingsBtn: document.getElementById("settings-btn"),
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function dateKeyLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function toHHMM(date) {
  const d = new Date(date);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function combineDateAndTime(date, hhmm, fallbackHour) {
  const d = new Date(date);
  if (hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    d.setHours(h, m, 0, 0);
  } else {
    d.setHours(fallbackHour, 0, 0, 0);
  }
  return d;
}

/** Dates (YYYY-MM-DD) that already have a task/event on them — feeds the date-picker's dots. */
function computeMarkedDates() {
  const { items } = buildTimelineItems();
  const marked = new Set();
  for (const item of items) marked.add(dateKeyLocal(item.start));
  return marked;
}

// ---------------------------------------------------------------------------
// Timeline item normalization
// ---------------------------------------------------------------------------

function makeTaskItem(task, catMap, occurrenceDate, end, isOverride, now) {
  const categories = (task.categoryIds || []).map((id) => catMap.get(id)).filter(Boolean);
  const allDay = Boolean(task.allDay);
  return {
    key: `task:${task.id}:${occurrenceDate.toISOString()}`,
    sourceType: "task",
    sourceId: task.id,
    occurrenceDate,
    title: task.title,
    start: occurrenceDate,
    end,
    isToday: startOfDay(occurrenceDate).getTime() === startOfDay(now).getTime(),
    isTimed: !allDay,
    allDay,
    category: categories[0] || null,
    categories,
    importance: task.importance,
    status: task.status,
    raw: task,
    isRecurringInstance: Boolean(task.recurrence),
    isOverride,
  };
}

function makeEventItem(evt, catMap, start, end, isOverride, now) {
  const categories = (evt.categoryIds || []).map((id) => catMap.get(id)).filter(Boolean);
  const allDay = Boolean(evt.allDay);
  return {
    key: `event:${evt.id}:${start.toISOString()}`,
    sourceType: "event",
    sourceId: evt.id,
    occurrenceDate: start,
    title: evt.title,
    start,
    end,
    isToday: startOfDay(start).getTime() === startOfDay(now).getTime(),
    isTimed: !allDay,
    allDay,
    category: categories[0] || null,
    categories,
    importance: evt.importance,
    status: null,
    raw: evt,
    isRecurringInstance: Boolean(evt.recurrence),
    isOverride,
  };
}

function buildTimelineItems() {
  const rangeStart = addDays(startOfDay(new Date()), -RANGE_PAST_DAYS);
  const rangeEnd = addDays(startOfDay(new Date()), RANGE_FUTURE_DAYS);
  const catMap = new Map(state.categories.map((c) => [c.id, c]));
  const now = new Date();
  const items = [];
  const undatedTasks = [];

  for (const task of state.tasks) {
    const hasDuration = Boolean(task.endTime && task.dueDate);
    const durationMs = hasDuration ? new Date(task.endTime).getTime() - new Date(task.dueDate).getTime() : 0;

    if (task.recurrence && task.recurrence.rule && task.dueDate) {
      const occurrences = Recurrence.expandOccurrences(task, rangeStart, rangeEnd, new Date(task.dueDate));
      for (const occ of occurrences) {
        const end = hasDuration ? new Date(occ.occurrenceDate.getTime() + durationMs) : null;
        items.push(makeTaskItem(occ.data, catMap, occ.occurrenceDate, end, occ.isOverride, now));
      }
    } else if (task.dueDate) {
      const d = new Date(task.dueDate);
      if (d >= rangeStart && d <= rangeEnd) {
        const end = hasDuration ? new Date(task.endTime) : null;
        items.push(makeTaskItem(task, catMap, d, end, false, now));
      }
    } else {
      undatedTasks.push(task);
    }
  }

  for (const evt of state.events) {
    if (!evt.startTime) continue;
    if (evt.recurrence && evt.recurrence.rule) {
      const durationMs = new Date(evt.endTime).getTime() - new Date(evt.startTime).getTime();
      const occurrences = Recurrence.expandOccurrences(evt, rangeStart, rangeEnd, new Date(evt.startTime));
      for (const occ of occurrences) {
        const start = occ.occurrenceDate;
        const end = new Date(start.getTime() + durationMs);
        items.push(makeEventItem(occ.data, catMap, start, end, occ.isOverride, now));
      }
    } else {
      const s = new Date(evt.startTime);
      const e = new Date(evt.endTime);
      if (s >= rangeStart && s <= rangeEnd) items.push(makeEventItem(evt, catMap, s, e, false, now));
    }
  }

  return { items, undatedTasks };
}

// ---------------------------------------------------------------------------
// Data loading + rendering
// ---------------------------------------------------------------------------

async function reloadData() {
  const [tasks, events, categories] = await Promise.all([
    Storage.getAllTasks(),
    Storage.getAllEvents(),
    Storage.getAllCategories(),
  ]);
  state.tasks = tasks;
  state.events = events;
  state.categories = categories;
}

function renderTimeline() {
  const { items, undatedTasks } = buildTimelineItems();
  if (state.viewMode === "vertical") {
    renderVerticalTimeline(el.timelineContainer, {
      items,
      undatedTasks: undatedTasks.filter((t) => t.status !== "done"),
      categories: state.categories,
      ripeningEnabled: state.settings.ripeningEnabled,
      onItemClick: openDetailForItem,
      onToggleTaskDone: toggleTaskDone,
    });
  } else {
    renderHorizontalTimeline(el.timelineContainer, {
      items,
      categories: state.categories,
      viewDate: state.hViewDate,
      zoom: state.hZoom,
      onItemClick: openDetailForItem,
      onToggleTaskDone: toggleTaskDone,
      onZoomChange: (zoom) => {
        state.hZoom = zoom;
        renderTimeline();
      },
      onNavigate: (dir) => {
        state.hViewDate = addDays(state.hViewDate, state.hZoom === "day" ? dir : dir * 7);
        renderTimeline();
      },
    });
  }
}

async function toggleTaskDone(task) {
  if (task.status === "done") await Storage.reopenTask(task.id);
  else await Storage.completeTask(task.id);
  await reloadData();
  renderTimeline();
}

// ---------------------------------------------------------------------------
// "When" section — shared date-picker + all-day/timed control, used by the
// quick-add panel and both detail modals so date entry works identically
// everywhere in the app.
// ---------------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 * @param {{mode:'no-date'|'all-day'|'timed', date:Date|null, startTime:string|null, endTime:string|null}} initial
 * @param {(state:object)=>void} onChange
 * @param {{allowNoDate?: boolean}} [options]
 */
function renderWhenSection(container, initial, onChange, options = {}) {
  const allowNoDate = options.allowNoDate !== false;
  const whenState = { ...initial };
  const markedDates = computeMarkedDates();

  function draw() {
    container.innerHTML = "";
    container.className = "when-section";

    const modeRow = document.createElement("div");
    modeRow.className = "when-mode-row";
    const modes = allowNoDate
      ? [["no-date", "No date"], ["all-day", "All day"], ["timed", "Timed"]]
      : [["all-day", "All day"], ["timed", "Timed"]];
    for (const [key, label] of modes) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "when-mode-btn" + (whenState.mode === key ? " is-selected" : "");
      btn.textContent = label;
      btn.addEventListener("click", () => {
        whenState.mode = key;
        if (key !== "no-date" && !whenState.date) whenState.date = new Date();
        draw();
        onChange(whenState);
      });
      modeRow.appendChild(btn);
    }
    container.appendChild(modeRow);

    if (whenState.mode !== "no-date") {
      const pickerContainer = document.createElement("div");
      pickerContainer.className = "when-date-picker";
      container.appendChild(pickerContainer);
      renderDatePicker(pickerContainer, {
        selectedDate: whenState.date,
        markedDates,
        onSelect: (date) => {
          whenState.date = date;
          onChange(whenState);
        },
      });
    }

    if (whenState.mode === "timed") {
      const timeRow = document.createElement("div");
      timeRow.className = "when-time-row";

      const startLabel = document.createElement("label");
      startLabel.className = "field-label when-time-label";
      startLabel.append("Start");
      const startInput = document.createElement("input");
      startInput.type = "time";
      startInput.className = "field-input when-start-time";
      startInput.value = whenState.startTime || "";
      startInput.addEventListener("input", () => {
        whenState.startTime = startInput.value;
        onChange(whenState);
      });
      startLabel.appendChild(startInput);

      const endLabel = document.createElement("label");
      endLabel.className = "field-label when-time-label";
      endLabel.append("End");
      const endInput = document.createElement("input");
      endInput.type = "time";
      endInput.className = "field-input when-end-time";
      endInput.value = whenState.endTime || "";
      endInput.addEventListener("input", () => {
        whenState.endTime = endInput.value;
        onChange(whenState);
      });
      endLabel.appendChild(endInput);

      timeRow.append(startLabel, endLabel);
      container.appendChild(timeRow);
    }
  }

  draw();
  return { getState: () => whenState };
}

function whenStateFromTask(task) {
  if (!task.dueDate) return { mode: "no-date", date: null, startTime: null, endTime: null };
  if (task.allDay) return { mode: "all-day", date: new Date(task.dueDate), startTime: null, endTime: null };
  return {
    mode: "timed",
    date: new Date(task.dueDate),
    startTime: toHHMM(task.dueDate),
    endTime: task.endTime ? toHHMM(task.endTime) : null,
  };
}

function whenStateFromEvent(evt) {
  if (!evt.startTime || evt.allDay) {
    return { mode: "all-day", date: evt.startTime ? new Date(evt.startTime) : new Date(), startTime: null, endTime: null };
  }
  return {
    mode: "timed",
    date: new Date(evt.startTime),
    startTime: toHHMM(evt.startTime),
    endTime: evt.endTime ? toHHMM(evt.endTime) : null,
  };
}

function taskFieldsFromWhen(whenState) {
  if (whenState.mode === "no-date") return { dueDate: null, endTime: null, allDay: false };
  if (whenState.mode === "all-day") {
    const d = startOfDay(whenState.date || new Date());
    return { dueDate: d.toISOString(), endTime: null, allDay: true };
  }
  const date = whenState.date || new Date();
  const start = combineDateAndTime(date, whenState.startTime, 9);
  const end = whenState.endTime ? combineDateAndTime(date, whenState.endTime, 9) : null;
  return { dueDate: start.toISOString(), endTime: end ? end.toISOString() : null, allDay: false };
}

function eventFieldsFromWhen(whenState) {
  const date = whenState.date || new Date();
  if (whenState.mode === "all-day") {
    const start = startOfDay(date);
    const end = new Date(start);
    end.setHours(23, 59, 59, 0);
    return { startTime: start.toISOString(), endTime: end.toISOString(), allDay: true };
  }
  const start = combineDateAndTime(date, whenState.startTime, 9);
  const end = whenState.endTime ? combineDateAndTime(date, whenState.endTime, 9) : new Date(start.getTime() + 3600000);
  return { startTime: start.toISOString(), endTime: end.toISOString(), allDay: false };
}

// ---------------------------------------------------------------------------
// Quick add — text/voice capture opens a confirm-before-create panel
// ---------------------------------------------------------------------------

function setupQuickAdd() {
  Capture.renderQuickAdd(el.quickAddContainer, (parsed) => openQuickAddPanel(parsed));
}

function openQuickAddPanel(parsed) {
  const expansion = QuickAddRules.expandQuickAddText(parsed.title);
  const matchedCategoryIds = expansion.categoryNames
    .map((name) => state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id)
    .filter(Boolean);

  const draft = {
    type: "task", // task | event
    title: expansion.title,
    categoryIds: matchedCategoryIds,
    recurrence: parsed.recurrenceRule ? { rule: parsed.recurrenceRule, exceptions: [], overrides: {} } : null,
  };
  const initialWhen = parsed.dueDate
    ? { mode: "timed", date: parsed.dueDate, startTime: toHHMM(parsed.dueDate), endTime: null }
    : { mode: "no-date", date: null, startTime: null, endTime: null };

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay quick-add-panel-overlay";
  overlay.innerHTML = `
    <div class="modal-card quick-add-panel">
      <button type="button" class="modal-close-btn" aria-label="Close">×</button>
      <h2 class="modal-heading">Quick Add</h2>

      <label class="field-label">Title
        <input type="text" class="qa-title-input field-input" />
      </label>

      <div class="qa-section">
        <h3 class="qa-section-header">Type</h3>
        <div class="qa-type-row">
          <button type="button" class="qa-type-btn" data-type="task">Task</button>
          <button type="button" class="qa-type-btn" data-type="event">Event</button>
        </div>
      </div>

      <div class="qa-section">
        <h3 class="qa-section-header">When</h3>
        <div class="qa-when-container"></div>
      </div>

      <div class="qa-section">
        <h3 class="qa-section-header">Category</h3>
        <div class="qa-category-container"></div>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn-secondary qa-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary qa-add-btn">Add</button>
      </div>
    </div>`;
  el.modalRoot.innerHTML = "";
  el.modalRoot.appendChild(overlay);

  const titleInput = overlay.querySelector(".qa-title-input");
  titleInput.value = draft.title;

  const typeButtons = overlay.querySelectorAll(".qa-type-btn");
  function refreshTypeButtons() {
    typeButtons.forEach((btn) => btn.classList.toggle("is-selected", btn.dataset.type === draft.type));
  }
  typeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      draft.type = btn.dataset.type;
      refreshTypeButtons();
      refreshWhen();
    });
  });
  refreshTypeButtons();

  const whenContainer = overlay.querySelector(".qa-when-container");
  let whenController;
  function refreshWhen() {
    const allowNoDate = draft.type === "task";
    const current = whenController ? whenController.getState() : initialWhen;
    const seed = !allowNoDate && current.mode === "no-date" ? { ...current, mode: "all-day", date: new Date() } : current;
    whenController = renderWhenSection(whenContainer, seed, () => {}, { allowNoDate });
  }
  refreshWhen();

  const catContainer = overlay.querySelector(".qa-category-container");
  function refreshCategories() {
    renderCategoryPicker(catContainer, draft.categoryIds, (next) => {
      draft.categoryIds = next;
      refreshCategories();
    });
  }
  refreshCategories();

  overlay.querySelector(".modal-close-btn").addEventListener("click", closeModal);
  overlay.querySelector(".qa-cancel-btn").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  overlay.querySelector(".qa-add-btn").addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) return;
    const whenState = whenController.getState();

    if (draft.type === "task") {
      await Storage.addTask({ title, categoryIds: draft.categoryIds, recurrence: draft.recurrence, ...taskFieldsFromWhen(whenState) });
    } else {
      await Storage.addEvent({ title, categoryIds: draft.categoryIds, recurrence: draft.recurrence, ...eventFieldsFromWhen(whenState) });
    }

    closeModal();
    await reloadData();
    renderTimeline();
  });
}

// ---------------------------------------------------------------------------
// In-progress resurfacing toast
// ---------------------------------------------------------------------------

async function checkResurfacing() {
  const todayKey = new Date().toDateString();
  const lastToastDate = await Storage.getSetting("lastResurfaceToastDate", null);
  if (lastToastDate === todayKey) return;

  const dismissed = new Set(await Storage.getSetting("resurfaceDismissed", []));
  const todayStart = startOfDay(new Date()).getTime();
  const candidates = state.tasks.filter(
    (t) => t.lastOpenedAt && t.status !== "done" && t.lastOpenedAt < todayStart && !dismissed.has(t.id)
  );
  if (!candidates.length) return;

  candidates.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const target = candidates[0];
  await Storage.setSetting("lastResurfaceToastDate", todayKey);
  showResurfaceToast(target, dismissed);
}

function showResurfaceToast(task, dismissedSet) {
  const toast = document.createElement("div");
  toast.className = "toast resurface-toast";
  toast.setAttribute("role", "status");

  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = `"${task.title}" — this one's been sitting since yesterday.`;

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "toast-action";
  openBtn.textContent = "Open";
  openBtn.addEventListener("click", () => {
    toast.remove();
    openTaskDetail(task.id);
  });

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "toast-dismiss";
  dismissBtn.textContent = "Not now";
  dismissBtn.addEventListener("click", async () => {
    dismissedSet.add(task.id);
    await Storage.setSetting("resurfaceDismissed", [...dismissedSet]);
    toast.remove();
  });

  toast.append(text, openBtn, dismissBtn);
  el.toastRegion.appendChild(toast);
  setTimeout(() => toast.remove(), 12000);
}

// ---------------------------------------------------------------------------
// Notifications wiring
// ---------------------------------------------------------------------------

function getDueReminders() {
  const { items } = buildTimelineItems();
  return items
    .filter((item) => !item.allDay) // all-day items have no meaningful due *moment* to alert on
    .filter((item) => (item.sourceType === "task" ? item.status !== "done" : true))
    .map((item) => ({
      key: item.key,
      title: item.title,
      subtitle: item.sourceType === "event" ? item.raw.location : "",
      whenMs: item.start.getTime(),
      importance: item.importance,
    }));
}

async function runDueTodaySummary() {
  const todayEnd = addDays(startOfDay(new Date()), 1);
  const { items } = buildTimelineItems();
  const dueToday = items.filter(
    (i) => i.start >= startOfDay(new Date()) && i.start < todayEnd && (i.sourceType !== "task" || i.status !== "done")
  );
  await Notifications.fireDueTodaySummaryOnce(dueToday.length);
}

// ---------------------------------------------------------------------------
// Category picker (shared by task + event forms + the quick-add panel)
// ---------------------------------------------------------------------------

function renderCategoryPicker(container, selectedIds, onChange) {
  container.innerHTML = "";
  container.className = "category-picker";

  const chipRow = document.createElement("div");
  chipRow.className = "category-chip-row";
  for (const cat of state.categories) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "category-chip" + (selectedIds.includes(cat.id) ? " is-selected" : "");
    chip.style.setProperty("--chip-color", cat.color);
    const icon = document.createElement("span");
    icon.className = "category-chip-icon";
    icon.textContent = cat.icon || "🏷️";
    const name = document.createElement("span");
    name.textContent = cat.name;
    chip.append(icon, name);
    chip.addEventListener("click", () => {
      const next = selectedIds.includes(cat.id) ? selectedIds.filter((id) => id !== cat.id) : [...selectedIds, cat.id];
      onChange(next);
    });
    chipRow.appendChild(chip);
  }
  container.appendChild(chipRow);

  const addRow = document.createElement("div");
  addRow.className = "category-add-row";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "New category name";
  nameInput.className = "category-add-name";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "category-add-color";
  colorInput.value = nextCustomColor(state.categories.length);
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "category-add-btn";
  addBtn.textContent = "Add category";
  addBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const category = await Storage.addCategory({ name, color: colorInput.value, icon: defaultCustomIcon() });
    state.categories.push(category);
    nameInput.value = "";
    onChange([...selectedIds, category.id]);
  });
  addRow.append(nameInput, colorInput, addBtn);
  container.appendChild(addRow);
}

// ---------------------------------------------------------------------------
// Bulleted notes editor
// ---------------------------------------------------------------------------

function renderNotesEditor(container, notes, onChange) {
  container.innerHTML = "";
  container.className = "notes-editor";
  const list = document.createElement("ul");
  list.className = "notes-list";

  notes.forEach((note, index) => {
    const li = document.createElement("li");
    li.className = "notes-list-item";
    const input = document.createElement("input");
    input.type = "text";
    input.value = note;
    input.addEventListener("input", () => {
      const next = [...notes];
      next[index] = input.value;
      onChange(next);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onChange([...notes.slice(0, index + 1), "", ...notes.slice(index + 1)]);
        requestAnimationFrame(() => {
          const inputs = list.querySelectorAll("input");
          inputs[index + 1]?.focus();
        });
      } else if (e.key === "Backspace" && !input.value && notes.length > 1) {
        e.preventDefault();
        onChange(notes.filter((_, i) => i !== index));
      }
    });
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "notes-remove-btn";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", "Remove note line");
    removeBtn.addEventListener("click", () => onChange(notes.filter((_, i) => i !== index)));
    li.append(input, removeBtn);
    list.appendChild(li);
  });

  container.appendChild(list);
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "notes-add-btn";
  addBtn.textContent = "+ add line";
  addBtn.addEventListener("click", () => onChange([...notes, ""]));
  container.appendChild(addBtn);
}

// ---------------------------------------------------------------------------
// Recurrence editor
// ---------------------------------------------------------------------------

const WEEKDAY_OPTS = [
  ["MO", "Mon"], ["TU", "Tue"], ["WE", "Wed"], ["TH", "Thu"], ["FR", "Fri"], ["SA", "Sat"], ["SU", "Sun"],
];

function renderRecurrenceEditor(container, recurrence, baseDateGetter, onChange) {
  container.innerHTML = "";
  container.className = "recurrence-editor";

  const enableRow = document.createElement("label");
  enableRow.className = "recurrence-enable-row";
  const enableCheckbox = document.createElement("input");
  enableCheckbox.type = "checkbox";
  enableCheckbox.checked = Boolean(recurrence);
  enableRow.append(enableCheckbox, document.createTextNode(" Repeats"));
  container.appendChild(enableRow);

  const body = document.createElement("div");
  body.className = "recurrence-body";
  container.appendChild(body);

  let cfg = recurrenceToConfig(recurrence);

  function renderBody() {
    body.innerHTML = "";
    if (!enableCheckbox.checked) return;

    const freqSelect = document.createElement("select");
    for (const f of ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]) {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f[0] + f.slice(1).toLowerCase();
      if (f === cfg.freq) opt.selected = true;
      freqSelect.appendChild(opt);
    }
    freqSelect.addEventListener("change", () => {
      cfg.freq = freqSelect.value;
      commit();
      renderBody();
    });

    const intervalLabel = document.createElement("label");
    intervalLabel.className = "recurrence-interval-label";
    intervalLabel.append("Every ");
    const intervalInput = document.createElement("input");
    intervalInput.type = "number";
    intervalInput.min = "1";
    intervalInput.value = String(cfg.interval || 1);
    intervalInput.className = "recurrence-interval-input";
    intervalInput.addEventListener("input", () => {
      cfg.interval = Math.max(1, parseInt(intervalInput.value, 10) || 1);
      commit();
    });
    intervalLabel.appendChild(intervalInput);
    intervalLabel.append(" " + cfg.freq.toLowerCase().replace("ly", "(s)"));

    const freqRow = document.createElement("div");
    freqRow.className = "recurrence-row";
    freqRow.append(freqSelect, intervalLabel);
    body.appendChild(freqRow);

    if (cfg.freq === "WEEKLY") {
      const dayRow = document.createElement("div");
      dayRow.className = "recurrence-weekday-row";
      for (const [code, label] of WEEKDAY_OPTS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "weekday-toggle" + (cfg.byweekday.includes(code) ? " is-selected" : "");
        btn.textContent = label;
        btn.addEventListener("click", () => {
          cfg.byweekday = cfg.byweekday.includes(code) ? cfg.byweekday.filter((c) => c !== code) : [...cfg.byweekday, code];
          commit();
          renderBody();
        });
        dayRow.appendChild(btn);
      }
      body.appendChild(dayRow);
    }

    if (cfg.freq === "MONTHLY") {
      const modeRow = document.createElement("div");
      modeRow.className = "recurrence-row";
      const dayModeLabel = document.createElement("label");
      const dayModeRadio = document.createElement("input");
      dayModeRadio.type = "radio";
      dayModeRadio.name = "monthly-mode";
      dayModeRadio.checked = cfg.monthlyMode === "day";
      dayModeRadio.addEventListener("change", () => {
        cfg.monthlyMode = "day";
        commit();
        renderBody();
      });
      dayModeLabel.append(dayModeRadio, " On day ");
      const dayNumInput = document.createElement("input");
      dayNumInput.type = "number";
      dayNumInput.min = "1";
      dayNumInput.max = "31";
      dayNumInput.className = "recurrence-daynum-input";
      dayNumInput.value = String(cfg.bymonthday[0] || 1);
      dayNumInput.disabled = cfg.monthlyMode !== "day";
      dayNumInput.addEventListener("input", () => {
        cfg.bymonthday = [parseInt(dayNumInput.value, 10) || 1];
        commit();
      });
      dayModeLabel.appendChild(dayNumInput);

      const posModeLabel = document.createElement("label");
      const posModeRadio = document.createElement("input");
      posModeRadio.type = "radio";
      posModeRadio.name = "monthly-mode";
      posModeRadio.checked = cfg.monthlyMode === "position";
      posModeRadio.addEventListener("change", () => {
        cfg.monthlyMode = "position";
        commit();
        renderBody();
      });
      posModeLabel.append(posModeRadio, " On the ");
      const posSelect = document.createElement("select");
      for (const [val, label] of [["1", "1st"], ["2", "2nd"], ["3", "3rd"], ["4", "4th"], ["-1", "Last"]]) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = label;
        if (String(cfg.bysetpos[0]) === val) opt.selected = true;
        posSelect.appendChild(opt);
      }
      posSelect.disabled = cfg.monthlyMode !== "position";
      posSelect.addEventListener("change", () => {
        cfg.bysetpos = [parseInt(posSelect.value, 10)];
        commit();
      });
      const posDaySelect = document.createElement("select");
      for (const [val, label] of [...WEEKDAY_OPTS, ["MO,TU,WE,TH,FR", "weekday"], ["MO,TU,WE,TH,FR,SA,SU", "day"]]) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = label;
        if (cfg.posByday === val) opt.selected = true;
        posDaySelect.appendChild(opt);
      }
      posDaySelect.disabled = cfg.monthlyMode !== "position";
      posDaySelect.addEventListener("change", () => {
        cfg.posByday = posDaySelect.value;
        commit();
      });
      posModeLabel.append(posSelect, document.createTextNode(" "), posDaySelect);

      modeRow.append(dayModeLabel, posModeLabel);
      body.appendChild(modeRow);
    }

    const endRow = document.createElement("div");
    endRow.className = "recurrence-end-row";
    const endNeverLabel = document.createElement("label");
    const endNeverRadio = document.createElement("input");
    endNeverRadio.type = "radio";
    endNeverRadio.name = "end-mode";
    endNeverRadio.checked = cfg.endMode === "never";
    endNeverRadio.addEventListener("change", () => { cfg.endMode = "never"; commit(); renderBody(); });
    endNeverLabel.append(endNeverRadio, " Never ends");

    const endCountLabel = document.createElement("label");
    const endCountRadio = document.createElement("input");
    endCountRadio.type = "radio";
    endCountRadio.name = "end-mode";
    endCountRadio.checked = cfg.endMode === "count";
    endCountRadio.addEventListener("change", () => { cfg.endMode = "count"; commit(); renderBody(); });
    const countInput = document.createElement("input");
    countInput.type = "number";
    countInput.min = "1";
    countInput.className = "recurrence-count-input";
    countInput.value = String(cfg.count || 5);
    countInput.disabled = cfg.endMode !== "count";
    countInput.addEventListener("input", () => { cfg.count = parseInt(countInput.value, 10) || 1; commit(); });
    endCountLabel.append(endCountRadio, " After ", countInput, " times");

    const endUntilLabel = document.createElement("label");
    const endUntilRadio = document.createElement("input");
    endUntilRadio.type = "radio";
    endUntilRadio.name = "end-mode";
    endUntilRadio.checked = cfg.endMode === "until";
    endUntilRadio.addEventListener("change", () => { cfg.endMode = "until"; commit(); renderBody(); });
    const untilInput = document.createElement("input");
    untilInput.type = "date";
    untilInput.className = "recurrence-until-input";
    if (cfg.until) untilInput.value = cfg.until.toISOString().slice(0, 10);
    untilInput.disabled = cfg.endMode !== "until";
    untilInput.addEventListener("input", () => { cfg.until = untilInput.value ? new Date(untilInput.value) : null; commit(); });
    endUntilLabel.append(endUntilRadio, " Until ", untilInput);

    endRow.append(endNeverLabel, endCountLabel, endUntilLabel);
    body.appendChild(endRow);

    const preview = document.createElement("p");
    preview.className = "recurrence-preview";
    try {
      const ruleString = configToRuleString(cfg);
      preview.textContent = Recurrence.describeRule(ruleString, baseDateGetter());
    } catch {
      preview.textContent = "";
    }
    body.appendChild(preview);
  }

  function commit() {
    if (!enableCheckbox.checked) {
      onChange(null);
      return;
    }
    const ruleString = configToRuleString(cfg);
    onChange({ rule: ruleString, exceptions: recurrence?.exceptions || [], overrides: recurrence?.overrides || {} });
  }

  enableCheckbox.addEventListener("change", () => {
    if (enableCheckbox.checked && !cfg) cfg = recurrenceToConfig(null);
    commit();
    renderBody();
  });

  renderBody();
}

function recurrenceToConfig(recurrence) {
  const cfg = {
    freq: "WEEKLY", interval: 1, byweekday: [], bymonthday: [new Date().getDate()],
    bysetpos: [1], posByday: "MO", monthlyMode: "day", endMode: "never", count: 5, until: null,
  };
  if (!recurrence || !recurrence.rule) return cfg;
  const parts = Object.fromEntries(recurrence.rule.split(";").map((p) => p.split("=")));
  if (parts.FREQ) cfg.freq = parts.FREQ;
  if (parts.INTERVAL) cfg.interval = parseInt(parts.INTERVAL, 10);
  if (parts.BYDAY) {
    if (parts.BYSETPOS) {
      cfg.monthlyMode = "position";
      cfg.posByday = parts.BYDAY;
      cfg.bysetpos = [parseInt(parts.BYSETPOS, 10)];
    } else {
      cfg.byweekday = parts.BYDAY.split(",");
    }
  }
  if (parts.BYMONTHDAY) {
    cfg.monthlyMode = "day";
    cfg.bymonthday = parts.BYMONTHDAY.split(",").map(Number);
  }
  if (parts.COUNT) { cfg.endMode = "count"; cfg.count = parseInt(parts.COUNT, 10); }
  if (parts.UNTIL) { cfg.endMode = "until"; cfg.until = parseIcsDateOnly(parts.UNTIL); }
  return cfg;
}

function parseIcsDateOnly(val) {
  const m = val.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function configToRuleString(cfg) {
  const builderCfg = { freq: cfg.freq, interval: cfg.interval };
  if (cfg.freq === "WEEKLY" && cfg.byweekday.length) builderCfg.byweekday = cfg.byweekday;
  if (cfg.freq === "MONTHLY") {
    if (cfg.monthlyMode === "day") builderCfg.bymonthday = cfg.bymonthday;
    else {
      builderCfg.byweekday = cfg.posByday.split(",");
      builderCfg.bysetpos = cfg.bysetpos;
    }
  }
  if (cfg.endMode === "count") builderCfg.count = cfg.count;
  if (cfg.endMode === "until" && cfg.until) builderCfg.until = cfg.until;
  return Recurrence.buildRuleString(builderCfg);
}

// ---------------------------------------------------------------------------
// Recurrence edit-scope chooser (Just this one / This and future / Entire series)
// ---------------------------------------------------------------------------

function chooseRecurrenceScope(actionLabel) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay scope-chooser-overlay";
    overlay.innerHTML = `
      <div class="scope-chooser-card">
        <p>${actionLabel} —</p>
        <button type="button" class="scope-btn" data-scope="instance">Just this one</button>
        <button type="button" class="scope-btn" data-scope="future">This and future</button>
        <button type="button" class="scope-btn" data-scope="all">Entire series</button>
        <button type="button" class="scope-btn scope-btn--cancel" data-scope="">Cancel</button>
      </div>`;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });
    overlay.querySelectorAll(".scope-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const scope = btn.dataset.scope || null;
        overlay.remove();
        resolve(scope);
      });
    });
    document.body.appendChild(overlay);
  });
}

// ---------------------------------------------------------------------------
// Text-to-speech
// ---------------------------------------------------------------------------

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(utterance);
}

// ---------------------------------------------------------------------------
// Detail modal — task + event create/edit
// ---------------------------------------------------------------------------

function closeModal() {
  el.modalRoot.innerHTML = "";
}

async function openDetailForItem(item) {
  if (item.sourceType === "task") await openTaskDetail(item.sourceId, item.occurrenceDate, item.isOverride);
  else await openEventDetail(item.sourceId, item.occurrenceDate, item.isOverride);
}

async function openTaskDetail(taskId, occurrenceDate, isOverride) {
  await Storage.touchTaskOpened(taskId);
  const dismissed = new Set(await Storage.getSetting("resurfaceDismissed", []));
  if (dismissed.has(taskId)) {
    dismissed.delete(taskId);
    await Storage.setSetting("resurfaceDismissed", [...dismissed]);
  }
  await reloadData();
  const base = await Storage.getTask(taskId);
  const override = occurrenceDate && isOverride ? base.recurrence.overrides[Recurrence.dateKey(occurrenceDate)] : null;
  const draft = { ...base, ...override, notes: [...(override?.notes || base.notes)], chunks: [...base.chunks] };
  if (!draft.notes.length) draft.notes = [""];

  renderTaskModal(draft, base, occurrenceDate);
}

function renderTaskModal(draft, base, occurrenceDate) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <button type="button" class="modal-close-btn" aria-label="Close">×</button>
      <h2 class="modal-heading">Task</h2>
      <label class="field-label">Title
        <input type="text" class="task-title-input field-input" />
      </label>
      <div class="qa-section">
        <h3 class="qa-section-header">When</h3>
        <div class="task-when-container"></div>
      </div>
      <div class="qa-section">
        <h3 class="qa-section-header">Category</h3>
        <div class="task-category-picker"></div>
      </div>
      <div class="qa-section">
        <h3 class="qa-section-header">Notes</h3>
        <div class="task-notes-editor"></div>
      </div>
      <div class="qa-section">
        <h3 class="qa-section-header">Photos</h3>
        <div class="photo-editor task-photo-editor"></div>
      </div>
      <div class="field-row">
        <label class="field-label">Importance
          <select class="task-importance-select field-input">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label class="field-label">Time estimate
          <input type="text" class="task-estimate-input field-input" placeholder="e.g. 15 min" />
        </label>
      </div>
      <div class="qa-section">
        <h3 class="qa-section-header">Repeats</h3>
        <div class="task-recurrence-editor"></div>
      </div>
      <div class="qa-section">
        <h3 class="qa-section-header">Steps</h3>
        <div class="task-chunk-editor"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-speak">🔊 Read aloud</button>
        <button type="button" class="btn-danger task-delete-btn">Delete</button>
        <button type="button" class="btn-primary task-save-btn">Save</button>
      </div>
    </div>`;
  el.modalRoot.innerHTML = "";
  el.modalRoot.appendChild(overlay);

  const titleInput = overlay.querySelector(".task-title-input");
  titleInput.value = draft.title;
  const importanceSelect = overlay.querySelector(".task-importance-select");
  importanceSelect.value = draft.importance;
  const estimateInput = overlay.querySelector(".task-estimate-input");
  estimateInput.value = draft.timeEstimate || "";

  const whenContainer = overlay.querySelector(".task-when-container");
  const whenController = renderWhenSection(whenContainer, whenStateFromTask(draft), () => {}, { allowNoDate: true });

  const notesContainer = overlay.querySelector(".task-notes-editor");
  function refreshNotes() {
    renderNotesEditor(notesContainer, draft.notes, (next) => {
      draft.notes = next;
      refreshNotes();
    });
  }
  refreshNotes();

  const catContainer = overlay.querySelector(".task-category-picker");
  function refreshCategories() {
    renderCategoryPicker(catContainer, draft.categoryIds || [], (next) => {
      draft.categoryIds = next;
      refreshCategories();
    });
  }
  refreshCategories();

  const chunkContainer = overlay.querySelector(".task-chunk-editor");
  function refreshChunks() {
    const catNames = (draft.categoryIds || []).map((id) => state.categories.find((c) => c.id === id)?.name).filter(Boolean);
    Chunking.renderChunkEditor(chunkContainer, { title: draft.title, chunks: draft.chunks, categoryNames: catNames }, (next) => {
      draft.chunks = next;
      refreshChunks();
    });
  }
  refreshChunks();

  const recContainer = overlay.querySelector(".task-recurrence-editor");
  renderRecurrenceEditor(recContainer, draft.recurrence, () => whenController.getState().date || new Date(), (next) => {
    draft.recurrence = next;
  });

  renderPhotoEditor(overlay.querySelector(".task-photo-editor"), base.id);

  overlay.querySelector(".modal-close-btn").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

  overlay.querySelector(".btn-speak").addEventListener("click", () => {
    speak([draft.title, ...draft.notes].filter(Boolean).join(". "));
  });

  overlay.querySelector(".task-delete-btn").addEventListener("click", async () => {
    if (base.recurrence && occurrenceDate) {
      const scope = await chooseRecurrenceScope("Delete");
      if (!scope) return;
      if (scope === "instance") {
        await Storage.updateTask(base.id, { recurrence: Recurrence.deleteInstance(base.recurrence, occurrenceDate) });
      } else if (scope === "future") {
        await Storage.updateTask(base.id, { recurrence: Recurrence.truncateSeriesBefore(base.recurrence, occurrenceDate) });
      } else {
        await Storage.deleteTask(base.id);
      }
    } else {
      await Storage.deleteTask(base.id);
    }
    closeModal();
    await reloadData();
    renderTimeline();
  });

  overlay.querySelector(".task-save-btn").addEventListener("click", async () => {
    const patch = {
      title: titleInput.value.trim() || "Untitled task",
      notes: draft.notes.filter((n) => n.trim()),
      categoryIds: draft.categoryIds || [],
      importance: importanceSelect.value,
      timeEstimate: estimateInput.value,
      chunks: draft.chunks,
      ...taskFieldsFromWhen(whenController.getState()),
    };

    if (base.recurrence && occurrenceDate) {
      const scope = await chooseRecurrenceScope("Save changes");
      if (!scope) return;
      if (scope === "instance") {
        await Storage.updateTask(base.id, {
          recurrence: Recurrence.editInstance(base.recurrence, occurrenceDate, patch),
        });
      } else if (scope === "future") {
        const truncated = Recurrence.truncateSeriesBefore(base.recurrence, occurrenceDate);
        await Storage.updateTask(base.id, { recurrence: truncated });
        await Storage.addTask({ ...patch, recurrence: { rule: base.recurrence.rule, exceptions: [], overrides: {} } });
      } else {
        await Storage.updateTask(base.id, { ...patch, recurrence: draft.recurrence });
      }
    } else {
      await Storage.updateTask(base.id, { ...patch, recurrence: draft.recurrence });
    }

    closeModal();
    await reloadData();
    renderTimeline();
  });
}

async function openEventDetail(eventId, occurrenceDate, isOverride) {
  await Storage.touchEventOpened(eventId);
  await reloadData();
  const base = await Storage.getEvent(eventId);
  const override = occurrenceDate && isOverride ? base.recurrence.overrides[Recurrence.dateKey(occurrenceDate)] : null;
  const draft = { ...base, ...override, notes: [...(override?.notes || base.notes)] };
  if (!draft.notes.length) draft.notes = [""];
  renderEventModal(draft, base, occurrenceDate);
}

function renderEventModal(draft, base, occurrenceDate) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card">
      <button type="button" class="modal-close-btn" aria-label="Close">×</button>
      <h2 class="modal-heading">Event</h2>
      <label class="field-label">Title
        <input type="text" class="event-title-input field-input" />
      </label>
      <div class="qa-section">
        <h3 class="qa-section-header">When</h3>
        <div class="event-when-container"></div>
      </div>
      <div class="qa-section">
        <h3 class="qa-section-header">Category</h3>
        <div class="event-category-picker"></div>
      </div>
      <label class="field-label">📍 Location
        <input type="text" class="event-location-input field-input" />
      </label>
      <label class="field-label">🔗 Map link
        <input type="url" class="event-maplink-input field-input" />
      </label>
      <div class="field-row">
        <label class="field-label">📞 Dial-in number
          <input type="text" class="event-dialin-input field-input" />
        </label>
        <label class="field-label">🔢 Access code
          <input type="text" class="event-dialincode-input field-input" />
        </label>
      </div>
      <div class="qa-section">
        <h3 class="qa-section-header">Notes</h3>
        <div class="event-notes-editor"></div>
      </div>
      <div class="qa-section">
        <h3 class="qa-section-header">Photos</h3>
        <div class="photo-editor event-photo-editor"></div>
      </div>
      <label class="field-label">Importance
        <select class="event-importance-select field-input">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </label>
      <div class="qa-section">
        <h3 class="qa-section-header">Repeats</h3>
        <div class="event-recurrence-editor"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-speak">🔊 Read aloud</button>
        <button type="button" class="btn-danger event-delete-btn">Delete</button>
        <button type="button" class="btn-primary event-save-btn">Save</button>
      </div>
    </div>`;
  el.modalRoot.innerHTML = "";
  el.modalRoot.appendChild(overlay);

  overlay.querySelector(".event-title-input").value = draft.title;
  overlay.querySelector(".event-location-input").value = draft.location || "";
  overlay.querySelector(".event-maplink-input").value = draft.mapLink || "";
  overlay.querySelector(".event-dialin-input").value = draft.dialInNumber || "";
  overlay.querySelector(".event-dialincode-input").value = draft.dialInCode || "";
  overlay.querySelector(".event-importance-select").value = draft.importance;

  const whenContainer = overlay.querySelector(".event-when-container");
  const whenController = renderWhenSection(whenContainer, whenStateFromEvent(draft), () => {}, { allowNoDate: false });

  const notesContainer = overlay.querySelector(".event-notes-editor");
  function refreshNotes() {
    renderNotesEditor(notesContainer, draft.notes, (next) => {
      draft.notes = next;
      refreshNotes();
    });
  }
  refreshNotes();

  const catContainer = overlay.querySelector(".event-category-picker");
  function refreshCategories() {
    renderCategoryPicker(catContainer, draft.categoryIds || [], (next) => {
      draft.categoryIds = next;
      refreshCategories();
    });
  }
  refreshCategories();

  const recContainer = overlay.querySelector(".event-recurrence-editor");
  renderRecurrenceEditor(recContainer, draft.recurrence, () => whenController.getState().date || new Date(), (next) => {
    draft.recurrence = next;
  });

  renderPhotoEditor(overlay.querySelector(".event-photo-editor"), base.id);

  overlay.querySelector(".modal-close-btn").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

  overlay.querySelector(".btn-speak").addEventListener("click", () => {
    speak([draft.title, draft.location, ...draft.notes].filter(Boolean).join(". "));
  });

  overlay.querySelector(".event-delete-btn").addEventListener("click", async () => {
    if (base.recurrence && occurrenceDate) {
      const scope = await chooseRecurrenceScope("Delete");
      if (!scope) return;
      if (scope === "instance") {
        await Storage.updateEvent(base.id, { recurrence: Recurrence.deleteInstance(base.recurrence, occurrenceDate) });
      } else if (scope === "future") {
        await Storage.updateEvent(base.id, { recurrence: Recurrence.truncateSeriesBefore(base.recurrence, occurrenceDate) });
      } else {
        await Storage.deleteEvent(base.id);
      }
    } else {
      await Storage.deleteEvent(base.id);
    }
    closeModal();
    await reloadData();
    renderTimeline();
  });

  overlay.querySelector(".event-save-btn").addEventListener("click", async () => {
    const patch = {
      title: overlay.querySelector(".event-title-input").value.trim() || "Untitled event",
      location: overlay.querySelector(".event-location-input").value,
      mapLink: overlay.querySelector(".event-maplink-input").value,
      dialInNumber: overlay.querySelector(".event-dialin-input").value,
      dialInCode: overlay.querySelector(".event-dialincode-input").value,
      notes: draft.notes.filter((n) => n.trim()),
      categoryIds: draft.categoryIds || [],
      importance: overlay.querySelector(".event-importance-select").value,
      ...eventFieldsFromWhen(whenController.getState()),
    };

    if (base.recurrence && occurrenceDate) {
      const scope = await chooseRecurrenceScope("Save changes");
      if (!scope) return;
      if (scope === "instance") {
        await Storage.updateEvent(base.id, { recurrence: Recurrence.editInstance(base.recurrence, occurrenceDate, patch) });
      } else if (scope === "future") {
        const truncated = Recurrence.truncateSeriesBefore(base.recurrence, occurrenceDate);
        await Storage.updateEvent(base.id, { recurrence: truncated });
        await Storage.addEvent({ ...patch, recurrence: { rule: base.recurrence.rule, exceptions: [], overrides: {} } });
      } else {
        await Storage.updateEvent(base.id, { ...patch, recurrence: draft.recurrence });
      }
    } else {
      await Storage.updateEvent(base.id, { ...patch, recurrence: draft.recurrence });
    }

    closeModal();
    await reloadData();
    renderTimeline();
  });
}

function renderPhotoEditor(container, ownerId) {
  container.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "photo-grid";

  async function refresh() {
    grid.innerHTML = "";
    const photos = await Storage.getPhotosForOwner(ownerId);
    for (const photo of photos) {
      const url = URL.createObjectURL(photo.blob);
      const thumb = document.createElement("div");
      thumb.className = "photo-thumb";
      const img = document.createElement("img");
      img.src = url;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "photo-remove-btn";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", async () => {
        await Storage.deletePhoto(photo.id);
        refresh();
      });
      thumb.append(img, removeBtn);
      grid.appendChild(thumb);
    }
  }

  const addLabel = document.createElement("label");
  addLabel.className = "photo-add-btn";
  addLabel.textContent = "+ add photo";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.className = "visually-hidden";
  fileInput.addEventListener("change", async () => {
    if (fileInput.files[0]) {
      await Storage.addPhoto(ownerId, fileInput.files[0], fileInput.files[0].name);
      fileInput.value = "";
      refresh();
    }
  });
  addLabel.appendChild(fileInput);

  container.append(grid, addLabel);
  refresh();
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

function renderSettingsModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card settings-card">
      <button type="button" class="modal-close-btn" aria-label="Close">×</button>
      <h2 class="modal-heading">Settings</h2>

      <section class="settings-section">
        <h3>Palette</h3>
        <div class="theme-swatch-row"></div>
      </section>

      <section class="settings-section">
        <h3>Flair intensity</h3>
        <div class="flair-toggle-row">
          <button type="button" class="flair-btn" data-flair="subtle">Subtle</button>
          <button type="button" class="flair-btn" data-flair="max">Max</button>
        </div>
      </section>

      <section class="settings-section settings-section--a11y">
        <h3>Accessibility</h3>
        <label class="field-label">Font
          <select class="font-select field-input">
            <option value="atkinson">Atkinson Hyperlegible</option>
            <option value="opendyslexic">OpenDyslexic</option>
          </select>
        </label>
        <label class="field-label">Line height
          <input type="range" min="1.2" max="2.2" step="0.1" class="line-height-slider" />
        </label>
        <label class="field-label">Letter spacing
          <input type="range" min="0" max="0.15" step="0.01" class="letter-spacing-slider" />
        </label>
        <label class="reduce-motion-row">
          <input type="checkbox" class="reduce-motion-checkbox" />
          Reduce motion (turns off all animation)
        </label>
      </section>

      <section class="settings-section">
        <h3>Ripening</h3>
        <label class="ripening-toggle-row">
          <input type="checkbox" class="ripening-checkbox" />
          Undated tasks slowly shift color the longer they sit
        </label>
      </section>

      <section class="settings-section">
        <h3>Chunking</h3>
        <label class="field-label">Spice level (how many empty step-slots to show)
          <select class="spice-select field-input">
            <option value="3">3</option>
            <option value="6">6</option>
            <option value="10">10</option>
          </select>
        </label>
      </section>

      <section class="settings-section">
        <h3>Notifications</h3>
        <button type="button" class="btn-secondary notif-enable-btn">Enable notifications</button>
        <span class="notif-status"></span>
      </section>

      <section class="settings-section">
        <h3>Calendar import</h3>
        <label class="btn-secondary ics-import-btn">
          Import .ics file
          <input type="file" accept=".ics,text/calendar" class="visually-hidden ics-file-input" />
        </label>
      </section>

      <section class="settings-section">
        <h3>Backup</h3>
        <button type="button" class="btn-secondary backup-export-btn">Export backup (JSON)</button>
        <label class="btn-secondary backup-import-btn">
          Import backup
          <input type="file" accept="application/json" class="visually-hidden backup-file-input" />
        </label>
      </section>
    </div>`;
  el.modalRoot.innerHTML = "";
  el.modalRoot.appendChild(overlay);

  overlay.querySelector(".modal-close-btn").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

  const swatchRow = overlay.querySelector(".theme-swatch-row");
  for (const theme of THEMES) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "theme-swatch" + (state.settings.theme === theme.id ? " is-selected" : "");
    swatch.setAttribute("data-theme-id", theme.id);
    swatch.setAttribute("aria-label", theme.label);
    swatch.title = theme.label;
    swatch.addEventListener("click", async () => {
      await Theming.setTheme(theme.id);
      state.settings = Theming.get();
      overlay.querySelectorAll(".theme-swatch").forEach((s) => s.classList.remove("is-selected"));
      swatch.classList.add("is-selected");
    });
    swatchRow.appendChild(swatch);
  }

  overlay.querySelectorAll(".flair-btn").forEach((btn) => {
    if (btn.dataset.flair === state.settings.flair) btn.classList.add("is-selected");
    btn.addEventListener("click", async () => {
      await Theming.setFlair(btn.dataset.flair);
      state.settings = Theming.get();
      overlay.querySelectorAll(".flair-btn").forEach((b) => b.classList.toggle("is-selected", b === btn));
    });
  });

  const fontSelect = overlay.querySelector(".font-select");
  fontSelect.value = state.settings.font;
  fontSelect.addEventListener("change", async () => {
    await Theming.setFont(fontSelect.value);
    state.settings = Theming.get();
  });

  const lineHeightSlider = overlay.querySelector(".line-height-slider");
  lineHeightSlider.value = state.settings.lineHeight;
  lineHeightSlider.addEventListener("input", async () => {
    await Theming.setLineHeight(parseFloat(lineHeightSlider.value));
    state.settings = Theming.get();
  });

  const letterSpacingSlider = overlay.querySelector(".letter-spacing-slider");
  letterSpacingSlider.value = state.settings.letterSpacing;
  letterSpacingSlider.addEventListener("input", async () => {
    await Theming.setLetterSpacing(parseFloat(letterSpacingSlider.value));
    state.settings = Theming.get();
  });

  const reduceMotionCheckbox = overlay.querySelector(".reduce-motion-checkbox");
  reduceMotionCheckbox.checked = Boolean(state.settings.reduceMotion);
  reduceMotionCheckbox.addEventListener("change", async () => {
    await Theming.setReduceMotion(reduceMotionCheckbox.checked);
    state.settings = Theming.get();
  });

  const ripeningCheckbox = overlay.querySelector(".ripening-checkbox");
  ripeningCheckbox.checked = Boolean(state.settings.ripeningEnabled);
  ripeningCheckbox.addEventListener("change", async () => {
    await Theming.setRipeningEnabled(ripeningCheckbox.checked);
    state.settings = Theming.get();
    renderTimeline();
  });

  const spiceSelect = overlay.querySelector(".spice-select");
  Chunking.getSpiceLevel().then((level) => (spiceSelect.value = String(level)));
  spiceSelect.addEventListener("change", async () => {
    await Chunking.setSpiceLevel(parseInt(spiceSelect.value, 10));
  });

  const notifStatus = overlay.querySelector(".notif-status");
  notifStatus.textContent = ("Notification" in window) ? Notification.permission : "unsupported";
  overlay.querySelector(".notif-enable-btn").addEventListener("click", async () => {
    const permission = await Notifications.requestPermission();
    notifStatus.textContent = permission;
    if (permission === "granted") startNotificationEngine();
  });

  overlay.querySelector(".ics-file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const result = await IcsImport.importICSFile(file);
    e.target.value = "";
    await reloadData();
    renderTimeline();
    alert(`Imported ${result.imported} event(s).`);
  });

  overlay.querySelector(".backup-export-btn").addEventListener("click", () => Backup.exportToFile());

  overlay.querySelector(".backup-file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const result = await Backup.importFromFile(file);
      await reloadData();
      renderTimeline();
      alert(`Restored ${result.tasks} task(s), ${result.events} event(s), ${result.categories} categor(ies), ${result.photos} photo(s).`);
    } catch (err) {
      alert(err.message);
    }
    e.target.value = "";
  });
}

// ---------------------------------------------------------------------------
// Notifications engine bootstrap
// ---------------------------------------------------------------------------

let notificationsStarted = false;
function startNotificationEngine() {
  if (notificationsStarted) return;
  notificationsStarted = true;
  Notifications.init(getDueReminders);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  state.settings = await Theming.init();
  await ensureDefaultCategories(Storage);
  await reloadData();

  state.viewMode = await Storage.getSetting("viewMode", "vertical");

  setupQuickAdd();
  renderTimeline();

  el.viewToggleBtn.addEventListener("click", async () => {
    state.viewMode = state.viewMode === "vertical" ? "horizontal" : "vertical";
    await Storage.setSetting("viewMode", state.viewMode);
    renderTimeline();
  });

  el.settingsBtn.addEventListener("click", renderSettingsModal);

  Theming.onChange(() => renderTimeline());

  await checkResurfacing();
  await runDueTodaySummary();

  if ("Notification" in window && Notification.permission === "granted") startNotificationEngine();

  setInterval(() => updateCountdownRings(el.timelineContainer), 30000);
  setInterval(renderTimeline, 60000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

init();
