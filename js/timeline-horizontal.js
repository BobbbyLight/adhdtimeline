/**
 * timeline-horizontal.js — secondary view. Time flows left to right along a
 * scrollable/zoomable axis: a day laid out hour-by-hour (schedule-strip
 * style, good for seeing a day's shape at a glance), zoomable out to a
 * 7-day week of compact agenda columns. Reads the same underlying item
 * list as the vertical view — this is a display toggle, not separate state.
 */

const PX_PER_HOUR = 84;
const DAY_START_HOUR = 0;
const DAY_END_HOUR = 24;
const LANE_HEIGHT = 68;

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

function startOfWeek(d) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function categoryColor(item) {
  return item.category?.color || "var(--border)";
}

function assignLanes(dayItems) {
  const lanes = []; // lane[i] = last item's end time in that lane
  return dayItems
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((item) => {
      // Tasks have no real duration — give them a nominal footprint wide
      // enough to read the title, rather than a sliver at their exact minute.
      const end = item.end || new Date(item.start.getTime() + 75 * 60000);
      let laneIndex = lanes.findIndex((laneEnd) => laneEnd <= item.start.getTime());
      if (laneIndex === -1) {
        laneIndex = lanes.length;
        lanes.push(end.getTime());
      } else {
        lanes[laneIndex] = end.getTime();
      }
      return { item, lane: laneIndex, end };
    });
}

function renderHourRuler() {
  const ruler = document.createElement("div");
  ruler.className = "h-ruler";
  ruler.style.width = `${(DAY_END_HOUR - DAY_START_HOUR) * PX_PER_HOUR}px`;
  for (let h = DAY_START_HOUR; h < DAY_END_HOUR; h++) {
    const tick = document.createElement("div");
    tick.className = "h-ruler-tick";
    tick.style.left = `${(h - DAY_START_HOUR) * PX_PER_HOUR}px`;
    const label = document.createElement("span");
    label.className = "h-ruler-label";
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    label.textContent = d.toLocaleTimeString([], { hour: "numeric" });
    tick.appendChild(label);
    ruler.appendChild(tick);
  }
  return ruler;
}

function renderDayTrack(dayItems, { onItemClick, onToggleTaskDone }) {
  const track = document.createElement("div");
  track.className = "h-track";
  track.style.width = `${(DAY_END_HOUR - DAY_START_HOUR) * PX_PER_HOUR}px`;

  const placed = assignLanes(dayItems);
  const laneCount = Math.max(1, ...placed.map((p) => p.lane + 1));
  track.style.height = `${laneCount * LANE_HEIGHT}px`;

  const now = new Date();
  if (startOfDay(now).getTime() === startOfDay(dayItems[0]?.start || now).getTime()) {
    const nowLine = document.createElement("div");
    nowLine.className = "h-now-line";
    const hours = now.getHours() + now.getMinutes() / 60;
    nowLine.style.left = `${(hours - DAY_START_HOUR) * PX_PER_HOUR}px`;
    track.appendChild(nowLine);
  }

  for (const { item, lane, end } of placed) {
    const startHours = item.start.getHours() + item.start.getMinutes() / 60;
    const durationHours = Math.max((end - item.start) / 3600000, 0.4);
    const block = document.createElement("div");
    block.className = `h-item h-item--${item.sourceType}`;
    if (item.importance === "critical") block.classList.add("h-item--critical");
    block.style.left = `${(startHours - DAY_START_HOUR) * PX_PER_HOUR}px`;
    block.style.width = `${durationHours * PX_PER_HOUR - 4}px`;
    block.style.top = `${lane * LANE_HEIGHT}px`;
    block.style.setProperty("--item-color", categoryColor(item));
    block.setAttribute("role", "button");
    block.tabIndex = 0;

    const title = document.createElement("span");
    title.className = "h-item-title";
    title.textContent = item.title;
    block.appendChild(title);

    if (item.sourceType === "task") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "h-item-checkbox";
      checkbox.checked = item.status === "done";
      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
        onToggleTaskDone(item.raw);
      });
      block.appendChild(checkbox);
    }

    block.addEventListener("click", () => onItemClick(item));
    block.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onItemClick(item);
      }
    });

    track.appendChild(block);
  }

  return track;
}

function renderDayView(container, viewDate, items, handlers) {
  const dayStart = startOfDay(viewDate);
  const dayEnd = addDays(dayStart, 1);
  const dayItems = items.filter((i) => i.start >= dayStart && i.start < dayEnd);

  const scroller = document.createElement("div");
  scroller.className = "h-day-scroller";
  const inner = document.createElement("div");
  inner.className = "h-day-inner";
  inner.appendChild(renderHourRuler());
  inner.appendChild(renderDayTrack(dayItems, handlers));
  scroller.appendChild(inner);
  container.appendChild(scroller);

  // Scroll to a sensible starting point: 2 hours before the first item, or 7am.
  requestAnimationFrame(() => {
    const firstHour = dayItems.length ? Math.max(0, dayItems[0].start.getHours() - 2) : 7;
    scroller.scrollLeft = firstHour * PX_PER_HOUR;
  });
}

function renderWeekView(container, viewDate, items, categories, handlers) {
  const weekStart = startOfWeek(viewDate);
  const grid = document.createElement("div");
  grid.className = "h-week-grid";

  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const dayEnd = addDays(day, 1);
    const dayItems = items.filter((it) => it.start >= day && it.start < dayEnd).sort((a, b) => a.start - b.start);

    const col = document.createElement("div");
    col.className = "h-week-col";
    if (startOfDay(new Date()).getTime() === day.getTime()) col.classList.add("h-week-col--today");

    const header = document.createElement("div");
    header.className = "h-week-col-header";
    header.textContent = day.toLocaleDateString([], { weekday: "short", day: "numeric" });
    col.appendChild(header);

    for (const item of dayItems) {
      const chip = document.createElement("div");
      chip.className = `h-week-chip h-item--${item.sourceType}`;
      chip.style.setProperty("--item-color", categoryColor(item));
      chip.setAttribute("role", "button");
      chip.tabIndex = 0;
      const time = document.createElement("span");
      time.className = "h-week-chip-time";
      time.textContent = item.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const title = document.createElement("span");
      title.className = "h-week-chip-title";
      title.textContent = item.title;
      chip.append(time, title);
      chip.addEventListener("click", () => handlers.onItemClick(item));
      chip.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handlers.onItemClick(item);
        }
      });
      col.appendChild(chip);
    }

    if (!dayItems.length) {
      const empty = document.createElement("div");
      empty.className = "h-week-col-empty";
      empty.textContent = "—";
      col.appendChild(empty);
    }

    grid.appendChild(col);
  }

  void categories;
  container.appendChild(grid);
}

/**
 * @param {HTMLElement} container
 * @param {{items: Array, categories: Array, viewDate: Date, zoom: 'day'|'week',
 *           onItemClick: Function, onToggleTaskDone: Function,
 *           onZoomChange: Function, onNavigate: (dir:1|-1)=>void}} ctx
 */
export function renderHorizontalTimeline(container, ctx) {
  const { items, categories, viewDate, zoom, onItemClick, onToggleTaskDone, onZoomChange, onNavigate } = ctx;
  container.innerHTML = "";
  container.className = "timeline-horizontal-root";

  const toolbar = document.createElement("div");
  toolbar.className = "h-toolbar";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "h-nav-btn";
  prevBtn.textContent = "‹";
  prevBtn.setAttribute("aria-label", zoom === "day" ? "Previous day" : "Previous week");
  prevBtn.addEventListener("click", () => onNavigate(-1));

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "h-nav-btn";
  nextBtn.textContent = "›";
  nextBtn.setAttribute("aria-label", zoom === "day" ? "Next day" : "Next week");
  nextBtn.addEventListener("click", () => onNavigate(1));

  const label = document.createElement("span");
  label.className = "h-toolbar-label";
  label.textContent =
    zoom === "day"
      ? viewDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })
      : `Week of ${startOfWeek(viewDate).toLocaleDateString([], { month: "short", day: "numeric" })}`;

  const zoomToggle = document.createElement("button");
  zoomToggle.type = "button";
  zoomToggle.className = "h-zoom-toggle";
  zoomToggle.textContent = zoom === "day" ? "Zoom to week" : "Zoom to day";
  zoomToggle.addEventListener("click", () => onZoomChange(zoom === "day" ? "week" : "day"));

  toolbar.append(prevBtn, label, nextBtn, zoomToggle);
  container.appendChild(toolbar);

  const handlers = { onItemClick, onToggleTaskDone };
  if (zoom === "day") renderDayView(container, viewDate, items, handlers);
  else renderWeekView(container, viewDate, items, categories, handlers);
}
