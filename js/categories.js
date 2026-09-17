/**
 * categories.js — a small predefined "standard" category set so the app
 * isn't a blank slate on first launch, plus color/icon assignment for any
 * category the user adds beyond it.
 *
 * Colors are chosen to spread evenly around the hue wheel (so any two are
 * easy to tell apart at a glance — the whole point of categories being a
 * *color* concept first) and picked for a loose real-world logic: warm
 * orange/gold for errands and home, green for money, teal for health,
 * blue for work, purple for family, pink for social, red for appointments.
 */

export const PREDEFINED_CATEGORIES = [
  { name: "Appointments", color: "#ef5350", icon: "📅" },
  { name: "Errands", color: "#ff9f43", icon: "🛒" },
  { name: "Home", color: "#d4b13f", icon: "🏠" },
  { name: "Finance", color: "#2f9e44", icon: "💳" },
  { name: "Health", color: "#2ec4a6", icon: "🩺" },
  { name: "Work", color: "#3d7cf4", icon: "💼" },
  { name: "Family", color: "#8c6fe6", icon: "👪" },
  { name: "Social", color: "#ff5fa2", icon: "👥" },
];

/** Cycled for user-created categories beyond the predefined set. */
const CUSTOM_COLOR_CYCLE = [
  "#ef5350", "#ff9f43", "#d4b13f", "#2f9e44", "#2ec4a6", "#3d7cf4", "#8c6fe6", "#ff5fa2",
  "#c2410c", "#65a30d", "#0891b2", "#7c3aed",
];
const CUSTOM_DEFAULT_ICON = "🏷️";

/** Deterministic next color for a new custom category based on how many already exist. */
export function nextCustomColor(existingCount) {
  return CUSTOM_COLOR_CYCLE[existingCount % CUSTOM_COLOR_CYCLE.length];
}

export function defaultCustomIcon() {
  return CUSTOM_DEFAULT_ICON;
}

/**
 * Seeds the predefined categories once, on first launch. Gated by a
 * settings flag rather than "table is empty" so a user who deletes every
 * category later doesn't have them silently reappear.
 * @param {import('./storage.js').Storage} Storage
 */
export async function ensureDefaultCategories(Storage) {
  const alreadySeeded = await Storage.getSetting("defaultCategoriesSeeded", false);
  if (alreadySeeded) return;
  for (const cat of PREDEFINED_CATEGORIES) {
    await Storage.addCategory(cat);
  }
  await Storage.setSetting("defaultCategoriesSeeded", true);
}
