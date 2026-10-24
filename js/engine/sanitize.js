// Backup sanitising. A restored backup is untrusted input: every record is
// rebuilt field by field from a fixed schema, so unknown keys (including
// "__proto__"), wrong types, oversized strings and impossible numbers never
// reach the app. Anything that can't be repaired is dropped.

import { isDate } from "./dates.js";

const MAX_RECORDS = 20000;
const MAX_LINES = 5000;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v).slice(0, max) : "");
const num = (v, { min = -1e9, max = 1e9, int = false, fallback = null } = {}) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return int ? Math.round(n) : n;
};
const date = (v) => (isDate(v) ? v : null);
const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const dateTime = (v) => (typeof v === "string" && DT.test(v) ? v : null);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = (v, fallback) => (typeof v === "string" && HHMM.test(v) ? v : fallback);
const bool = (v) => v === true;
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const arr = (v, max = MAX_RECORDS) => (Array.isArray(v) ? v.slice(0, max) : []);
const id = (v) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
const IMG = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
export const isSafeImage = (u) => typeof u === "string" && u.length < 15 * 1024 * 1024 && IMG.test(u);

const SHIP_STATUS = ["EXPECTED", "IN_TRANSIT", "AT_PORT", "AT_DOCK", "RECEIVED", "CLOSED"];
const MODES = ["FCL", "LCL", "FTL", "LTL", "AIR", "PARCEL"];
const APPT_STATUS = ["BOOKED", "ARRIVED", "UNLOADING", "DONE", "NO_SHOW", "CANCELLED"];
const EQUIP = ["CONTAINER", "TRAILER", "BOX_TRUCK", "VAN"];
const CLAIM_STATUS = ["OPEN", "SUBMITTED", "SETTLED", "REJECTED"];
const PARTY = ["CARRIER", "SUPPLIER", "INSURER"];
const SIZES = ["20", "40", "40HC", "45", ""];
const RATE_KEYS = ["handlingInPerPallet", "handlingOutPerPallet", "storagePerPalletDay", "freeStorageDays", "devanning20", "devanning40", "minMonthly"];
const MONEY = { min: 0, max: 1e9 };

function docLine(l) {
  if (!isObj(l)) return null;
  const out = {
    sku: str(l.sku, 64), description: str(l.description, 200),
    qty: num(l.qty, { min: 0 }), cartons: num(l.cartons, { min: 0 }), grossKg: num(l.grossKg, { min: 0 }),
    hs: str(l.hs, 16), unitPrice: num(l.unitPrice, MONEY),
  };
  return out.sku || out.description ? out : null;
}

function doc(d) {
  if (!isObj(d)) return null;
  const h = isObj(d.header) ? d.header : {};
  return {
    ref: str(d.ref, 64),
    header: { grossKg: num(h.grossKg, { min: 0 }), packages: num(h.packages, { min: 0 }), containerNo: str(h.containerNo, 20), seal: str(h.seal, 32) },
    lines: arr(d.lines, MAX_LINES).map(docLine).filter(Boolean),
    ...(d.source === "ai" ? { source: "ai" } : {}),
  };
}

function receipt(r) {
  if (!isObj(r)) return null;
  return {
    lines: arr(r.lines, MAX_LINES).filter(isObj).map((l) => ({
      sku: str(l.sku, 64), description: str(l.description, 200), expected: num(l.expected, { min: 0, fallback: 0 }),
      received: num(l.received, { min: 0 }), damaged: num(l.damaged, { min: 0, fallback: 0 }), note: str(l.note, 200),
    })),
    receivedAt: date(r.receivedAt), pallets: num(r.pallets, { min: 0, max: 1e6, int: true }), sealNo: str(r.sealNo, 32),
    sealIntact: r.sealIntact !== false, receivedBy: str(r.receivedBy, 60), finalized: bool(r.finalized) && isDate(r.receivedAt), notes: str(r.notes, 2000),
  };
}

const tiers = (t) => arr(t, 50).filter(isObj).map((x) => ({ fromDay: num(x.fromDay, { min: 1, max: 3650, int: true }), rate: num(x.rate, MONEY) }))
  .filter((x) => x.fromDay != null && x.rate != null).sort((a, b) => a.fromDay - b.fromDay);

const SANITIZERS = {
  docks: (d) => ({
    id: id(d.id), name: str(d.name, 40) || "Door", open: hhmm(d.open, "06:00"), close: hhmm(d.close, "22:00"),
    reefer: bool(d.reefer), hazmat: bool(d.hazmat), equipment: arr(d.equipment, 4).filter((e) => EQUIP.includes(e)), active: d.active !== false,
  }),
  clients: (c) => {
    const r = isObj(c.rates) ? c.rates : {};
    return { id: id(c.id), name: str(c.name, 80) || "Client", code: str(c.code, 8), contact: str(c.contact, 120),
      rates: Object.fromEntries(RATE_KEYS.map((k) => [k, num(r[k], { ...MONEY, fallback: 0 })])) };
  },
  tariffs: (t) => ({
    id: id(t.id), name: str(t.name, 80) || "Tariff", carrier: str(t.carrier, 80), combined: bool(t.combined),
    demFreeDays: num(t.demFreeDays, { min: 0, max: 365, int: true, fallback: 0 }), detFreeDays: num(t.detFreeDays, { min: 0, max: 365, int: true, fallback: 0 }),
    demTiers: tiers(t.demTiers), detTiers: tiers(t.detTiers),
  }),
  shipments: (s) => {
    const docs = {};
    if (isObj(s.docs)) for (const k of ["PO", "PACKING_LIST", "INVOICE", "BOL"]) { const d = doc(s.docs[k]); if (d) docs[k] = d; }
    return {
      id: id(s.id), ref: str(s.ref, 40) || "IN-?", clientId: id(s.clientId) || "", mode: oneOf(s.mode, MODES, "FCL"),
      carrier: str(s.carrier, 80), supplier: str(s.supplier, 80), containerNo: str(s.containerNo, 15).toUpperCase().replace(/[^A-Z0-9]/g, ""),
      containerSize: oneOf(s.containerSize, SIZES, ""), seal: str(s.seal, 32), eta: date(s.eta), tariffId: id(s.tariffId) || "",
      dischargeDate: date(s.dischargeDate), gateOutDate: date(s.gateOutDate), emptyReturnDate: date(s.emptyReturnDate),
      status: oneOf(s.status, SHIP_STATUS, "EXPECTED"), reefer: bool(s.reefer), hazmat: bool(s.hazmat), notes: str(s.notes, 2000),
      docs, receipt: receipt(s.receipt),
      releases: arr(s.releases, MAX_LINES).filter(isObj).map((r) => ({ id: id(r.id) || undefined, date: date(r.date), pallets: num(r.pallets, { min: 0, max: 1e6, int: true }), ref: str(r.ref, 40) }))
        .filter((r) => r.date && r.pallets != null),
      services: arr(s.services, MAX_LINES).filter(isObj).map((v) => ({ id: id(v.id) || undefined, date: date(v.date), description: str(v.description, 80), qty: num(v.qty, { min: 0 }), rate: num(v.rate, MONEY) }))
        .filter((v) => v.date && v.qty != null && v.rate != null),
    };
  },
  appointments: (a) => {
    const start = dateTime(a.start);
    if (!start) return null;
    return {
      id: id(a.id), dockId: id(a.dockId) || "", shipmentId: id(a.shipmentId) || "", carrier: str(a.carrier, 80), start,
      durationMin: num(a.durationMin, { min: 5, max: 24 * 60, int: true, fallback: 60 }), direction: oneOf(a.direction, ["IN", "OUT"], "IN"),
      equipment: oneOf(a.equipment, EQUIP, "CONTAINER"), needsReefer: bool(a.needsReefer), hazmat: bool(a.hazmat),
      status: oneOf(a.status, APPT_STATUS, "BOOKED"), notes: str(a.notes, 300),
      arrivedAt: dateTime(a.arrivedAt), startedAt: dateTime(a.startedAt), doneAt: dateTime(a.doneAt),
    };
  },
  claims: (c) => ({
    id: id(c.id), no: str(c.no, 20) || "CLM-?", shipmentId: id(c.shipmentId) || "", createdAt: date(c.createdAt) || "1970-01-01",
    status: oneOf(c.status, CLAIM_STATUS, "OPEN"), party: str(c.party, 80), partyType: oneOf(c.partyType, PARTY, "CARRIER"),
    amountClaimed: num(c.amountClaimed, { ...MONEY, fallback: 0 }), amountSettled: num(c.amountSettled, MONEY), notes: str(c.notes, 2000),
  }),
  invoices: (i) => {
    const period = typeof i.period === "string" && /^\d{4}-\d{2}$/.test(i.period) ? i.period : null;
    if (!period) return null;
    return {
      id: id(i.id), no: str(i.no, 40), clientId: id(i.clientId) || "", clientName: str(i.clientName, 80), period,
      from: date(i.from) || `${period}-01`, to: date(i.to) || `${period}-01`, currency: str(i.currency, 3), issuedAt: date(i.issuedAt), paid: bool(i.paid),
      total: num(i.total, { ...MONEY, fallback: 0 }), days: num(i.days, { min: 0, max: 31, int: true, fallback: 0 }),
      lines: arr(i.lines, MAX_LINES).filter(isObj).map((l) => ({ code: str(l.code, 8), description: str(l.description, 200), ref: str(l.ref, 40),
        qty: num(l.qty, { min: 0, fallback: 0 }), rate: num(l.rate, { ...MONEY, fallback: 0 }), amount: num(l.amount, { ...MONEY, fallback: 0 }) })),
    };
  },
};

export function sanitizeSettings(s, defaults) {
  const src = isObj(s) ? s : {};
  const w = isObj(src.warehouse) ? src.warehouse : {};
  const n = isObj(src.nextNo) ? src.nextNo : {};
  const cur = str(src.currency, 3).toUpperCase().replace(/[^A-Z]/g, "");
  return {
    warehouse: { name: str(w.name, 80) || defaults.warehouse.name, address: str(w.address, 300), phone: str(w.phone, 40), email: str(w.email, 80), logo: isSafeImage(w.logo) && w.logo.length < 500000 ? w.logo : "" },
    currency: cur.length === 3 ? cur : defaults.currency,
    graceMin: num(src.graceMin, { min: 0, max: 600, int: true, fallback: defaults.graceMin }),
    qtyTolPct: num(src.qtyTolPct, { min: 0, max: 100, fallback: defaults.qtyTolPct }),
    weightTolPct: num(src.weightTolPct, { min: 0, max: 100, fallback: defaults.weightTolPct }),
    model: typeof src.model === "string" ? src.model : defaults.model,
    nextNo: Object.fromEntries(Object.entries(defaults.nextNo).map(([k, v]) => [k, num(n[k], { min: 1, max: 1e8, int: true, fallback: v })])),
  };
}

/** Rebuild every collection; records without a valid id are dropped. */
export function sanitizeCollections(data) {
  const out = {};
  for (const [name, fn] of Object.entries(SANITIZERS)) {
    const seen = new Set();
    out[name] = arr(data?.[name]).filter(isObj).map(fn).filter((x) => x && x.id && !seen.has(x.id) && seen.add(x.id));
  }
  return out;
}

export function sanitizePhoto(p) {
  if (!isObj(p) || !id(p.id) || !id(p.shipmentId) || !isSafeImage(p.dataUrl)) return null;
  return { id: p.id, shipmentId: p.shipmentId, dataUrl: p.dataUrl, caption: str(p.caption, 120), takenAt: str(p.takenAt, 30) };
}
