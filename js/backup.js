/**
 * backup.js — the user's deliberate backup mechanism, given the app is
 * deliberately no-account/local-only: manual export to a JSON file and
 * manual import to restore from one. Photos are embedded as base64 so a
 * single file is a complete backup.
 */

import { Storage } from "./storage.js";

const BACKUP_FORMAT_VERSION = 1;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result); // data: URL, includes mime prefix
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** @returns {Promise<object>} the full backup payload (also used by exportToFile) */
export async function buildBackupPayload() {
  const [tasks, events, categories] = await Promise.all([
    Storage.getAllTasks(),
    Storage.getAllEvents(),
    Storage.getAllCategories(),
  ]);

  const allOwnerIds = [...tasks.map((t) => t.id), ...events.map((e) => e.id)];
  const photosByOwner = await Promise.all(allOwnerIds.map((id) => Storage.getPhotosForOwner(id)));
  const photos = photosByOwner.flat();
  const photosEncoded = await Promise.all(
    photos.map(async (p) => ({ ...p, blob: await blobToBase64(p.blob) }))
  );

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    tasks,
    events,
    categories,
    photos: photosEncoded,
  };
}

export async function exportToFile() {
  const payload = await buildBackupPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `adhd-timeline-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Restores from a previously exported JSON file. Additive: existing
 * records are left alone, backup records are written by their original
 * id (so re-importing the same file is idempotent rather than duplicating).
 * @param {File} file
 */
export async function importFromFile(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  if (!payload || !Array.isArray(payload.tasks) || !Array.isArray(payload.events)) {
    throw new Error("This file doesn't look like an ADHD Timeline backup.");
  }

  for (const category of payload.categories || []) {
    await Storage.addCategory(category).catch(() => {});
  }
  for (const task of payload.tasks) {
    await Storage.addTask(task);
  }
  for (const evt of payload.events) {
    await Storage.addEvent(evt);
  }
  for (const photo of payload.photos || []) {
    const blob = await dataUrlToBlob(photo.blob);
    await Storage.addPhoto(photo.ownerId, blob, photo.name);
  }

  return {
    tasks: payload.tasks.length,
    events: payload.events.length,
    categories: (payload.categories || []).length,
    photos: (payload.photos || []).length,
  };
}

export const Backup = { buildBackupPayload, exportToFile, importFromFile };
