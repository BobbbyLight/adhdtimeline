/**
 * chunking.js — low-friction task breakdown: inline add (~1 keystroke + Enter,
 * no modal), a spice-level dial controlling how many empty step-slots are
 * proactively shown, and optional one-tap suggestions from chunkingRules.js.
 */

import { Storage } from "./storage.js";
import { ChunkingRules } from "./chunkingRules.js";

export const SPICE_LEVELS = [3, 6, 10];
const DEFAULT_SPICE = 6;

export async function getSpiceLevel() {
  return Storage.getSetting("spiceLevel", DEFAULT_SPICE);
}

export async function setSpiceLevel(level) {
  return Storage.setSetting("spiceLevel", level);
}

function uid() {
  return Storage.uid();
}

// ---------------------------------------------------------------------------
// Pure data operations on a task's `chunks` array
// ---------------------------------------------------------------------------

export function addChunk(chunks, text) {
  const trimmed = text.trim();
  if (!trimmed) return chunks;
  return [...chunks, { id: uid(), text: trimmed, done: false }];
}

export function removeChunk(chunks, chunkId) {
  return chunks.filter((c) => c.id !== chunkId);
}

export function toggleChunk(chunks, chunkId) {
  return chunks.map((c) => (c.id === chunkId ? { ...c, done: !c.done } : c));
}

export function reorderChunk(chunks, fromIndex, toIndex) {
  const next = [...chunks];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function editChunkText(chunks, chunkId, text) {
  return chunks.map((c) => (c.id === chunkId ? { ...c, text } : c));
}

// ---------------------------------------------------------------------------
// Inline editor UI
// ---------------------------------------------------------------------------

/**
 * Renders (or re-renders) the chunk editor into `container`.
 * @param {HTMLElement} container
 * @param {{title: string, chunks: Array<{id,text,done}>}} task
 * @param {(nextChunks: Array) => void} onChange called with the updated chunks array
 */
export async function renderChunkEditor(container, task, onChange) {
  const spiceLevel = await getSpiceLevel();
  container.innerHTML = "";
  container.className = "chunk-editor";

  const list = document.createElement("ul");
  list.className = "chunk-list";
  list.setAttribute("aria-label", "Steps");

  task.chunks.forEach((chunk, index) => {
    list.appendChild(renderChunkRow(chunk, index, task.chunks, onChange));
  });
  container.appendChild(list);

  // Suggestions (opt-in, only shown when the placeholder ruleset has a match)
  const suggestions = ChunkingRules.suggestChunks(task.title, task.categoryNames || []).filter(
    (s) => !task.chunks.some((c) => c.text === s)
  );
  if (suggestions.length) {
    const suggestWrap = document.createElement("div");
    suggestWrap.className = "chunk-suggestions";
    const label = document.createElement("span");
    label.className = "chunk-suggestions-label";
    label.textContent = "Suggested:";
    suggestWrap.appendChild(label);
    for (const s of suggestions) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chunk-suggestion-chip";
      chip.textContent = s;
      chip.addEventListener("click", () => {
        onChange(addChunk(task.chunks, s));
      });
      suggestWrap.appendChild(chip);
    }
    container.appendChild(suggestWrap);
  }

  // Empty step-slots — the spice-level dial controls how many show at once.
  const slotsToShow = Math.max(0, spiceLevel - task.chunks.length);
  const slots = document.createElement("div");
  slots.className = "chunk-slots";
  for (let i = 0; i < slotsToShow; i++) {
    slots.appendChild(renderSlotInput(task, onChange));
  }
  container.appendChild(slots);
}

function renderChunkRow(chunk, index, chunks, onChange) {
  const li = document.createElement("li");
  li.className = "chunk-row" + (chunk.done ? " is-done" : "");
  li.setAttribute("data-chunk-id", chunk.id);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "chunk-checkbox";
  checkbox.checked = chunk.done;
  checkbox.setAttribute("aria-label", `Mark "${chunk.text}" done`);
  checkbox.addEventListener("change", () => onChange(toggleChunk(chunks, chunk.id)));

  const text = document.createElement("input");
  text.type = "text";
  text.className = "chunk-text";
  text.value = chunk.text;
  text.addEventListener("change", () => onChange(editChunkText(chunks, chunk.id, text.value)));

  const up = document.createElement("button");
  up.type = "button";
  up.className = "chunk-move-btn";
  up.setAttribute("aria-label", "Move step up");
  up.textContent = "↑";
  up.disabled = index === 0;
  up.addEventListener("click", () => onChange(reorderChunk(chunks, index, index - 1)));

  const down = document.createElement("button");
  down.type = "button";
  down.className = "chunk-move-btn";
  down.setAttribute("aria-label", "Move step down");
  down.textContent = "↓";
  down.disabled = index === chunks.length - 1;
  down.addEventListener("click", () => onChange(reorderChunk(chunks, index, index + 1)));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "chunk-remove-btn";
  remove.setAttribute("aria-label", `Remove "${chunk.text}"`);
  remove.textContent = "×";
  remove.addEventListener("click", () => onChange(removeChunk(chunks, chunk.id)));

  li.append(checkbox, text, up, down, remove);
  return li;
}

function renderSlotInput(task, onChange) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "chunk-slot-input";
  input.placeholder = "+ add a step";
  const commit = () => {
    const value = input.value.trim();
    if (!value) return;
    onChange(addChunk(task.chunks, value));
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  });
  input.addEventListener("blur", commit);
  return input;
}

export const Chunking = {
  SPICE_LEVELS,
  getSpiceLevel,
  setSpiceLevel,
  addChunk,
  removeChunk,
  toggleChunk,
  reorderChunk,
  editChunkText,
  renderChunkEditor,
};
