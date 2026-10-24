// App state: collections loaded from IndexedDB, saved back on change.
// The Claude API key is kept out of IndexedDB and out of backups: it lives in
// sessionStorage (cleared when the tab closes) unless the user opts to
// remember it on this device.

import * as db from "./db.js";
import { DEFAULT_MODEL } from "./engine/extract.js";
import { localDate } from "./engine/dates.js";

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
  const saved = await db.getKV("settings");
  state.settings = { ...DEFAULT_SETTINGS(), ...(saved || {}) };
  state.settings.warehouse = { ...DEFAULT_SETTINGS().warehouse, ...(saved?.warehouse || {}) };
  state.settings.nextNo = { ...DEFAULT_SETTINGS().nextNo, ...(saved?.nextNo || {}) };
  for (const c of COLLECTIONS) state[c] = (await db.getKV(c)) || [];
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
  if (!data || data.app !== "dockflow") throw new Error("This is not a DockFlow backup file.");
  for (const c of COLLECTIONS) if (data[c] != null && !Array.isArray(data[c])) throw new Error(`Backup field "${c}" is not a list.`);
  state.settings = { ...DEFAULT_SETTINGS(), ...(data.settings || {}) };
  state.settings.warehouse = { ...DEFAULT_SETTINGS().warehouse, ...(data.settings?.warehouse || {}) };
  if (state.settings.warehouse.logo && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(state.settings.warehouse.logo)) state.settings.warehouse.logo = "";
  for (const c of COLLECTIONS) state[c] = (data[c] || []).filter((x) => x && typeof x === "object" && typeof x.id === "string");
  // Drop records the views can't render rather than crash on them.
  state.appointments = state.appointments.filter((a) => typeof a.start === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(a.start));
  state.shipments = state.shipments.filter((s) => typeof s.ref === "string");
  for (const s of state.shipments) if (s.docs && typeof s.docs !== "object") s.docs = {};
  state.claims = state.claims.filter((c) => typeof c.createdAt === "string");
  for (const p of photos) if (isSafeImage(p?.dataUrl) && typeof p.id === "string") await db.putPhoto(p);
  saveAll();
}

export const isSafeImage = (u) => typeof u === "string" && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(u);

export async function wipeAll() {
  await db.wipe();
  setApiKey("");
  state.settings = DEFAULT_SETTINGS();
  for (const c of COLLECTIONS) state[c] = [];
}
