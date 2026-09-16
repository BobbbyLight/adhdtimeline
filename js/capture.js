/**
 * capture.js — quick-add bar: equally-weighted text + mic input, both
 * feeding the same local freeform parser (regex/date-math only, no
 * AI/network call). Voice uses the on-device Web Speech API and always
 * lands back in the text input, editable, before anything commits.
 */

// ---------------------------------------------------------------------------
// Freeform natural-language parser
// ---------------------------------------------------------------------------

const DAY_TOKENS = {
  sunday: "SU", sun: "SU",
  monday: "MO", mon: "MO",
  tuesday: "TU", tue: "TU", tues: "TU",
  wednesday: "WE", wed: "WE",
  thursday: "TH", thu: "TH", thur: "TH", thurs: "TH",
  friday: "FR", fri: "FR",
  saturday: "SA", sat: "SA",
};

const MONTH_TOKENS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sept: 8, sep: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

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

function strip(text, match) {
  return text.slice(0, match.index) + " " + text.slice(match.index + match[0].length);
}

function nextWeekday(now, code, forceNext) {
  const order = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const targetIdx = order.indexOf(code);
  const todayIdx = now.getDay();
  let diff = (targetIdx - todayIdx + 7) % 7;
  if (diff === 0 && forceNext) diff = 7;
  return addDays(startOfDay(now), diff);
}

function dayAlternationPattern() {
  return Object.keys(DAY_TOKENS).sort((a, b) => b.length - a.length).join("|");
}

/**
 * @param {string} input raw quick-add text
 * @param {Date} [now]
 * @returns {{ title: string, dueDate: Date|null, recurrenceRule: string|null }}
 */
export function parseFreeform(input, now = new Date()) {
  let text = ` ${input.trim()} `;
  let recurrenceRule = null;
  let dateBase = null;
  let impliedEveningDefault = false;

  // --- Recurrence ---
  let m = text.match(/\bevery\s+week ?day\b/i);
  if (m) {
    recurrenceRule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    text = strip(text, m);
  }

  if (!recurrenceRule) {
    m = text.match(/\bevery\s+(\d+)\s+(day|week|month|year)s?\b/i);
    if (m) {
      const n = parseInt(m[1], 10);
      const freq = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" }[m[2].toLowerCase()];
      recurrenceRule = `FREQ=${freq};INTERVAL=${n}`;
      text = strip(text, m);
    }
  }

  if (!recurrenceRule) {
    const re = new RegExp(
      `\\bevery\\s+((?:${dayAlternationPattern()})(?:\\s*(?:,|/|and)\\s*(?:${dayAlternationPattern()}))*)\\b`,
      "i"
    );
    m = text.match(re);
    if (m) {
      const days = m[1]
        .split(/\s*(?:,|\/|and)\s*/i)
        .map((d) => DAY_TOKENS[d.toLowerCase()])
        .filter(Boolean);
      const unique = [...new Set(days)];
      if (unique.length) {
        recurrenceRule = `FREQ=WEEKLY;BYDAY=${unique.join(",")}`;
        text = strip(text, m);
      }
    }
  }

  if (!recurrenceRule) {
    if (/\bevery\s+day\b/i.test(text)) {
      recurrenceRule = "FREQ=DAILY";
      text = text.replace(/\bevery\s+day\b/i, " ");
    } else if (/\bdaily\b/i.test(text)) {
      recurrenceRule = "FREQ=DAILY";
      text = text.replace(/\bdaily\b/i, " ");
    } else if (/\bweekly\b/i.test(text)) {
      recurrenceRule = "FREQ=WEEKLY";
      text = text.replace(/\bweekly\b/i, " ");
    } else if (/\bmonthly\b/i.test(text)) {
      recurrenceRule = "FREQ=MONTHLY";
      text = text.replace(/\bmonthly\b/i, " ");
    } else if (/\b(yearly|annually)\b/i.test(text)) {
      recurrenceRule = "FREQ=YEARLY";
      text = text.replace(/\b(yearly|annually)\b/i, " ");
    }
  }

  // --- Date ---
  m = text.match(/\btomorrow\b/i);
  if (m) {
    dateBase = addDays(startOfDay(now), 1);
    text = strip(text, m);
  }
  if (!dateBase) {
    m = text.match(/\btoday\b/i);
    if (m) {
      dateBase = startOfDay(now);
      text = strip(text, m);
    }
  }
  if (!dateBase) {
    m = text.match(/\btonight\b/i);
    if (m) {
      dateBase = startOfDay(now);
      impliedEveningDefault = true;
      text = strip(text, m);
    }
  }
  if (!dateBase) {
    m = text.match(/\bin\s+(\d+)\s+(day|week)s?\b/i);
    if (m) {
      const n = parseInt(m[1], 10);
      const mult = /week/i.test(m[2]) ? 7 : 1;
      dateBase = addDays(startOfDay(now), n * mult);
      text = strip(text, m);
    }
  }
  if (!dateBase) {
    const re = new RegExp(`\\b(next\\s+)?(${dayAlternationPattern()})\\b`, "i");
    m = text.match(re);
    if (m) {
      dateBase = nextWeekday(now, DAY_TOKENS[m[2].toLowerCase()], Boolean(m[1]));
      text = strip(text, m);
    }
  }
  if (!dateBase) {
    m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (m) {
      let year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
      if (year < 100) year += 2000;
      dateBase = new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
      text = strip(text, m);
    }
  }
  if (!dateBase) {
    const re = new RegExp(
      `\\b(${Object.keys(MONTH_TOKENS).sort((a, b) => b.length - a.length).join("|")})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
      "i"
    );
    m = text.match(re);
    if (m) {
      const year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
      dateBase = new Date(year, MONTH_TOKENS[m[1].toLowerCase()], parseInt(m[2], 10));
      text = strip(text, m);
    }
  }

  // --- Time ---
  let hour = null;
  let minute = 0;
  m = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (m) {
    hour = parseInt(m[1], 10) % 12;
    if (m[3].toLowerCase() === "pm") hour += 12;
    minute = m[2] ? parseInt(m[2], 10) : 0;
    text = strip(text, m);
  } else if ((m = text.match(/\bnoon\b/i))) {
    hour = 12;
    text = strip(text, m);
  } else if ((m = text.match(/\bmidnight\b/i))) {
    hour = 0;
    text = strip(text, m);
  } else if ((m = text.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/))) {
    hour = parseInt(m[1], 10);
    minute = parseInt(m[2], 10);
    text = strip(text, m);
  }

  // --- Combine ---
  let dueDate = null;
  if (dateBase || hour !== null) {
    const base = dateBase ? new Date(dateBase) : startOfDay(now);
    if (hour !== null) base.setHours(hour, minute, 0, 0);
    // Assumption: a date with no explicit time defaults to 9am (or 8pm for "tonight")
    // rather than staying time-of-day-less, since dueDate is a single datetime field.
    else base.setHours(impliedEveningDefault ? 20 : 9, 0, 0, 0);
    dueDate = base;
  }

  let title = text.replace(/\s{2,}/g, " ").trim();
  title = title.replace(/\b(at|on|for|,)\s*$/i, "").trim();
  if (!title) title = input.trim();

  return { title, dueDate, recurrenceRule };
}

// ---------------------------------------------------------------------------
// Voice input — Web Speech API, on-device, transcript always editable
// ---------------------------------------------------------------------------

export function isVoiceSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * @param {{onInterim?:(text:string)=>void, onFinal?:(text:string)=>void,
 *           onEnd?:()=>void, onError?:(e:any)=>void}} handlers
 * @returns {{stop:()=>void}|null}
 */
export function startVoiceCapture(handlers) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    handlers.onError?.(new Error("Speech recognition not supported in this browser"));
    return null;
  }
  const recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";

  recognition.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += transcript;
      else interim += transcript;
    }
    if (interim) handlers.onInterim?.(interim);
    if (final) handlers.onFinal?.(final);
  };
  recognition.onerror = (e) => handlers.onError?.(e);
  recognition.onend = () => handlers.onEnd?.();
  recognition.start();
  return { stop: () => recognition.stop() };
}

// ---------------------------------------------------------------------------
// Quick-add bar UI
// ---------------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 * @param {(parsed: {title:string, dueDate:Date|null, recurrenceRule:string|null}) => void} onSubmit
 */
export function renderQuickAdd(container, onSubmit) {
  container.innerHTML = "";
  container.className = "quick-add-bar";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "quick-add-input";
  input.placeholder = 'Try "call vet tomorrow 3pm" or "trash every Tuesday"';
  input.setAttribute("aria-label", "Quick add a task or event");

  const micBtn = document.createElement("button");
  micBtn.type = "button";
  micBtn.className = "quick-add-mic-btn";
  micBtn.setAttribute("aria-label", "Add by voice");
  micBtn.textContent = "🎤";
  if (!isVoiceSupported()) micBtn.disabled = true;

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "quick-add-submit-btn";
  submitBtn.textContent = "Add";

  let voiceHandle = null;

  function commit() {
    const value = input.value.trim();
    if (!value) return;
    onSubmit(parseFreeform(value));
    input.value = "";
    input.classList.remove("is-listening");
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  });
  submitBtn.addEventListener("click", commit);

  micBtn.addEventListener("click", () => {
    if (voiceHandle) {
      voiceHandle.stop();
      voiceHandle = null;
      return;
    }
    input.classList.add("is-listening");
    micBtn.classList.add("is-listening");
    voiceHandle = startVoiceCapture({
      onInterim: (text) => {
        input.value = text;
      },
      onFinal: (text) => {
        // Editable before commit — never auto-submitted.
        input.value = text;
        input.focus();
      },
      onEnd: () => {
        voiceHandle = null;
        input.classList.remove("is-listening");
        micBtn.classList.remove("is-listening");
      },
      onError: () => {
        voiceHandle = null;
        input.classList.remove("is-listening");
        micBtn.classList.remove("is-listening");
      },
    });
  });

  container.append(input, micBtn, submitBtn);
}

export const Capture = { parseFreeform, isVoiceSupported, startVoiceCapture, renderQuickAdd };
