/**
 * date-picker.js — a small month-grid calendar control, used everywhere a
 * date needs picking (quick-add panel, task/event detail). Days that
 * already have something scheduled get a dot, so picking a date doubles
 * as a lightweight "what's already there" glance — useful for a brain
 * that doesn't reliably hold the week's shape in working memory.
 */

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * @param {HTMLElement} container
 * @param {{selectedDate?: Date|null, markedDates?: Set<string>, onSelect: (date: Date) => void}} opts
 * @returns {{ setSelected: (date: Date|null) => void, setMarkedDates: (set: Set<string>) => void }}
 */
export function renderDatePicker(container, opts) {
  let selectedDate = opts.selectedDate || null;
  let markedDates = opts.markedDates || new Set();
  let viewMonth = startOfMonth(selectedDate || new Date());
  const onSelect = opts.onSelect;

  function pick(date) {
    selectedDate = date;
    viewMonth = startOfMonth(date);
    draw();
    onSelect(date);
  }

  function draw() {
    container.innerHTML = "";
    container.className = "date-picker";

    const header = document.createElement("div");
    header.className = "date-picker-header";
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "date-picker-nav-btn";
    prevBtn.textContent = "‹";
    prevBtn.setAttribute("aria-label", "Previous month");
    prevBtn.addEventListener("click", () => {
      viewMonth = addMonths(viewMonth, -1);
      draw();
    });
    const label = document.createElement("span");
    label.className = "date-picker-month-label";
    label.textContent = viewMonth.toLocaleDateString([], { month: "long", year: "numeric" });
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "date-picker-nav-btn";
    nextBtn.textContent = "›";
    nextBtn.setAttribute("aria-label", "Next month");
    nextBtn.addEventListener("click", () => {
      viewMonth = addMonths(viewMonth, 1);
      draw();
    });
    header.append(prevBtn, label, nextBtn);
    container.appendChild(header);

    const weekdayRow = document.createElement("div");
    weekdayRow.className = "date-picker-weekday-row";
    for (const label of WEEKDAY_LABELS) {
      const cell = document.createElement("span");
      cell.textContent = label;
      weekdayRow.appendChild(cell);
    }
    container.appendChild(weekdayRow);

    const grid = document.createElement("div");
    grid.className = "date-picker-grid";
    const today = startOfDay(new Date());
    const firstCell = addDays(viewMonth, -viewMonth.getDay());

    for (let i = 0; i < 42; i++) {
      const cellDate = addDays(firstCell, i);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "date-picker-day";
      if (cellDate.getMonth() !== viewMonth.getMonth()) btn.classList.add("is-outside-month");
      if (cellDate.getTime() === today.getTime()) btn.classList.add("is-today");
      if (selectedDate && cellDate.getTime() === startOfDay(selectedDate).getTime()) btn.classList.add("is-selected");

      const num = document.createElement("span");
      num.className = "date-picker-day-num";
      num.textContent = String(cellDate.getDate());
      btn.appendChild(num);

      if (markedDates.has(dateKey(cellDate))) {
        const dot = document.createElement("span");
        dot.className = "date-picker-day-dot";
        btn.appendChild(dot);
      }

      btn.addEventListener("click", () => pick(cellDate));
      grid.appendChild(btn);
    }
    container.appendChild(grid);
  }

  draw();

  return {
    setSelected: (date) => {
      selectedDate = date;
      if (date) viewMonth = startOfMonth(date);
      draw();
    },
    setMarkedDates: (set) => {
      markedDates = set;
      draw();
    },
  };
}
