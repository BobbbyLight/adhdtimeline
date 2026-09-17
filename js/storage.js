/**
 * storage.js — IndexedDB wrapper for the whole app.
 *
 * Everything lives in one database, five object stores:
 *   tasks, events, categories, photos, settings
 *
 * Assumption: recurrence exceptions (single-instance edits/deletes) are
 * stored inline on the owning task/event record as `recurrence.exceptions`
 * rather than in a separate store — for a local single-user app a join
 * buys nothing and inline keeps reads simple. See recurrence.js.
 *
 * No framework — a tiny hand-rolled promise wrapper is enough for five
 * stores and keeps the dependency list at zero for the storage layer.
 */

const DB_NAME = "adhd-timeline";
const DB_VERSION = 1;

/** @type {IDBDatabase|null} */
let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("tasks")) {
        const tasks = db.createObjectStore("tasks", { keyPath: "id" });
        tasks.createIndex("dueDate", "dueDate", { unique: false });
        tasks.createIndex("status", "status", { unique: false });
        tasks.createIndex("createdAt", "createdAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("events")) {
        const events = db.createObjectStore("events", { keyPath: "id" });
        events.createIndex("startTime", "startTime", { unique: false });
      }

      if (!db.objectStoreNames.contains("categories")) {
        db.createObjectStore("categories", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("photos")) {
        const photos = db.createObjectStore("photos", { keyPath: "id" });
        photos.createIndex("ownerId", "ownerId", { unique: false });
      }

      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };

    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Generic CRUD helpers shared by tasks/events/categories/photos
// ---------------------------------------------------------------------------

async function putRecord(storeName, record) {
  const store = await tx(storeName, "readwrite");
  await reqToPromise(store.put(record));
  return record;
}

async function getRecord(storeName, id) {
  const store = await tx(storeName, "readonly");
  return reqToPromise(store.get(id));
}

async function getAllRecords(storeName) {
  const store = await tx(storeName, "readonly");
  return reqToPromise(store.getAll());
}

async function deleteRecord(storeName, id) {
  const store = await tx(storeName, "readwrite");
  await reqToPromise(store.delete(id));
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function newTaskDefaults() {
  const now = Date.now();
  return {
    id: uid(),
    type: "task",
    title: "",
    notes: [], // array of short strings — rendered as a bulleted list
    photoIds: [],
    dueDate: null, // ISO string or null — undated is first-class; doubles as "start" when timed
    endTime: null, // ISO string or null — optional, sizes the horizontal-view tile by duration
    allDay: false, // true = tied to a date but no specific clock time (no countdown ring, no duration block)
    categoryIds: [],
    importance: "normal", // low | normal | high | critical
    timeEstimate: "", // free text, e.g. "15 min"
    recurrence: null, // { rule: 'RRULE:...', exceptions: [] } | null
    status: "not_started", // not_started | in_progress | done
    chunks: [], // [{ id, text, done }]
    createdAt: now,
    lastOpenedAt: null,
    completedAt: null,
  };
}

async function addTask(partial) {
  const task = { ...newTaskDefaults(), ...partial };
  return putRecord("tasks", task);
}

async function updateTask(id, patch) {
  const existing = await getRecord("tasks", id);
  if (!existing) throw new Error(`Task not found: ${id}`);
  const updated = { ...existing, ...patch };
  return putRecord("tasks", updated);
}

async function deleteTask(id) {
  await deletePhotosForOwner(id);
  return deleteRecord("tasks", id);
}

function getTask(id) {
  return getRecord("tasks", id);
}

function getAllTasks() {
  return getAllRecords("tasks");
}

/** Marks a task opened "now" without touching completedAt — drives in-progress resurfacing. */
async function touchTaskOpened(id) {
  return updateTask(id, { lastOpenedAt: Date.now() });
}

async function completeTask(id) {
  return updateTask(id, { status: "done", completedAt: Date.now() });
}

async function reopenTask(id) {
  return updateTask(id, { status: "not_started", completedAt: null });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function newEventDefaults() {
  const now = Date.now();
  return {
    id: uid(),
    type: "event",
    title: "",
    startTime: null, // ISO string, required
    endTime: null, // ISO string, required
    allDay: false, // true = spans the whole day, no specific clock time
    location: "",
    mapLink: "",
    dialInNumber: "",
    dialInCode: "",
    notes: [],
    photoIds: [],
    categoryIds: [],
    importance: "normal",
    recurrence: null,
    createdAt: now,
    lastOpenedAt: null,
  };
}

async function addEvent(partial) {
  const evt = { ...newEventDefaults(), ...partial };
  return putRecord("events", evt);
}

async function updateEvent(id, patch) {
  const existing = await getRecord("events", id);
  if (!existing) throw new Error(`Event not found: ${id}`);
  return putRecord("events", { ...existing, ...patch });
}

async function deleteEvent(id) {
  await deletePhotosForOwner(id);
  return deleteRecord("events", id);
}

function getEvent(id) {
  return getRecord("events", id);
}

function getAllEvents() {
  return getAllRecords("events");
}

async function touchEventOpened(id) {
  return updateEvent(id, { lastOpenedAt: Date.now() });
}

// ---------------------------------------------------------------------------
// Categories — shared pool for tasks and events
// ---------------------------------------------------------------------------

async function addCategory({ id, name, color, icon, createdAt }) {
  const category = { id: id || uid(), name, color, icon: icon || "🏷️", createdAt: createdAt || Date.now() };
  return putRecord("categories", category);
}

async function updateCategory(id, patch) {
  const existing = await getRecord("categories", id);
  if (!existing) throw new Error(`Category not found: ${id}`);
  return putRecord("categories", { ...existing, ...patch });
}

async function deleteCategory(id) {
  return deleteRecord("categories", id);
}

function getAllCategories() {
  return getAllRecords("categories");
}

// ---------------------------------------------------------------------------
// Photos — blobs, referenced by owner (task/event) id
// ---------------------------------------------------------------------------

async function addPhoto(ownerId, blob, name) {
  const photo = { id: uid(), ownerId, blob, name: name || "", createdAt: Date.now() };
  await putRecord("photos", photo);
  return photo;
}

async function getPhotosForOwner(ownerId) {
  const store = await tx("photos", "readonly");
  const index = store.index("ownerId");
  return reqToPromise(index.getAll(ownerId));
}

async function deletePhoto(id) {
  return deleteRecord("photos", id);
}

async function deletePhotosForOwner(ownerId) {
  const photos = await getPhotosForOwner(ownerId);
  await Promise.all(photos.map((p) => deleteRecord("photos", p.id)));
}

// ---------------------------------------------------------------------------
// Settings — single key/value row per setting
// ---------------------------------------------------------------------------

async function getSetting(key, fallback) {
  const row = await getRecord("settings", key);
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  return putRecord("settings", { key, value });
}

async function getAllSettings() {
  const rows = await getAllRecords("settings");
  const map = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

export const Storage = {
  uid,
  openDB,
  // tasks
  addTask,
  updateTask,
  deleteTask,
  getTask,
  getAllTasks,
  touchTaskOpened,
  completeTask,
  reopenTask,
  // events
  addEvent,
  updateEvent,
  deleteEvent,
  getEvent,
  getAllEvents,
  touchEventOpened,
  // categories
  addCategory,
  updateCategory,
  deleteCategory,
  getAllCategories,
  // photos
  addPhoto,
  getPhotosForOwner,
  deletePhoto,
  deletePhotosForOwner,
  // settings
  getSetting,
  setSetting,
  getAllSettings,
};
