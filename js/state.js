// App state: collections loaded from IndexedDB, saved back on change.
// The Claude API key is kept out of IndexedDB and out of backups: it lives in
// sessionStorage (cleared when the tab closes) unless the user opts to
// remember it on this device.

import * as db from "./db.js";
import { DEFAULT_MODEL } from "./engine/extract.js";
import { localDate } from "./engine/dates.js";
import { sanitizeCollections, sanitizePhoto, sanitizeSettings, isSafeImage } from "./engine/sanitize.js";

export const COLLECTIONS = ["docks", "clients", "tariffs", "shipments", "appointments", "claims", "invoices"];

export const DEFAULT_SETTINGS = () => ({
  warehouse: { name: "My Warehouse", address: "", phone: "", email: "", logo: "" },
  currency: "USD",
  graceMin: 15,
  qtyTolPct: 0,
  weightTolPct: 2,
  model: DEFAULT_MODEL,
  nextNo: { shipment: 1, claim: 1, invoice: 1 },
});

export const state = {
  settings: DEFAULT_SETTINGS(),
  docks: [], clients: [], tariffs: [], shipments: [], appointments: [], claims: [], invoices: [],
};

export async function loadState() {
  // Stored data is re-validated on every load too: IndexedDB is shared with
  // every page on this origin, so it is not trusted blindly.
  const saved = await db.getKV("settings");
  state.settings = sanitizeSettings(saved, DEFAULT_SETTINGS());
  const raw = {};
  for (const c of COLLECTIONS) raw[c] = await db.getKV(c);
  Object.assign(state, sanitizeCollections(raw));
  return Boolean(saved);
}

const timers = {};
export function save(name) {
  clearTimeout(timers[name]);
  timers[name] = setTimeout(() => db.setKV(name, name === "settings" ? state.settings : state[name]), 150);
}
export function saveAll() {
  save("settings");
  for (const c of COLLECTIONS) save(c);
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export function nextNumber(kind, prefix) {
  const n = state.settings.nextNo[kind]++;
  save("settings");
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

export const byId = (coll, id) => state[coll].find((x) => x.id === id) || null;

export const today = () => localDate();

// ------------------------------------------------------------- API key

const KEY_NAME = "dockflow.apiKey";
export function getApiKey() {
  try { return sessionStorage.getItem(KEY_NAME) || localStorage.getItem(KEY_NAME) || ""; } catch { return ""; }
}
export function setApiKey(key, remember) {
  try {
    sessionStorage.removeItem(KEY_NAME);
    localStorage.removeItem(KEY_NAME);
    if (!key) return;
    (remember ? localStorage : sessionStorage).setItem(KEY_NAME, key);
  } catch { /* storage blocked: key is not kept */ }
}
export function keyRemembered() {
  try { return Boolean(localStorage.getItem(KEY_NAME)); } catch { return false; }
}

// ------------------------------------------------------------- HS codes

let hs = null, hsLoading = null;
/** Lazily load the HS 2022 subheadings: Map code(6 digits) → description. */
export function loadHs() {
  if (hs) return Promise.resolve(hs);
  if (!hsLoading) {
    hsLoading = fetch("data/hs-codes.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((rows) => (hs = new Map(rows.map(([c, d]) => [c, d]))))
      .catch(() => { hsLoading = null; return null; });
  }
  return hsLoading;
}
export const hsCodes = () => (hs ? new Set(hs.keys()) : null);
export const hsDescription = (code) => hs?.get(String(code).replace(/\D/g, "").slice(0, 6)) || "";

// ------------------------------------------------------------- backup

export function exportBackup() {
  const out = { app: "dockflow", version: 1, exportedAt: new Date().toISOString(), settings: state.settings };
  for (const c of COLLECTIONS) out[c] = state[c];
  return out;
}

export async function importBackup(data, photos = []) {
  if (!data || typeof data !== "object" || data.app !== "dockflow") throw new Error("This is not a DockFlow backup file.");
  for (const c of COLLECTIONS) if (data[c] != null && !Array.isArray(data[c])) throw new Error(`Backup field "${c}" is not a list.`);
  const clean = sanitizeCollections(data);
  await db.wipe();
  state.settings = sanitizeSettings(data.settings, DEFAULT_SETTINGS());
  for (const c of COLLECTIONS) state[c] = clean[c];
  for (const p of Array.isArray(photos) ? photos.slice(0, 5000) : []) {
    const safe = sanitizePhoto(p);
    if (safe) await db.putPhoto(safe);
  }
  saveAll();
}

export { isSafeImage };

export async function wipeAll() {
  await db.wipe();
  setApiKey("");
  state.settings = DEFAULT_SETTINGS();
  for (const c of COLLECTIONS) state[c] = [];
}
