// Operational metrics over a date range.

import { addDays, isDate } from "./dates.js";
import { dnd } from "./freetime.js";
import { liveState, utilization } from "./schedule.js";
import { osd } from "./receiving.js";

const groupBy = (items, key) => {
  const m = new Map();
  for (const it of items) {
    const k = key(it) || "Unknown";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
};

/** On-time arrival rate per carrier for appointments with an arrival time. */
export function carrierOnTime(appts, from, to, graceMin = 15) {
  const done = appts.filter((a) => a.arrivedAt && a.start.slice(0, 10) >= from && a.start.slice(0, 10) <= to);
  const noShows = appts.filter((a) => a.status === "NO_SHOW" && a.start.slice(0, 10) >= from && a.start.slice(0, 10) <= to);
  const g = groupBy([...done, ...noShows], (a) => a.carrier);
  return [...g].map(([carrier, list]) => {
    let onTime = 0, late = 0, noShow = 0, dwell = 0, dwellN = 0;
    for (const a of list) {
      if (a.status === "NO_SHOW") { noShow++; continue; }
      const st = liveState(a, Date.now(), graceMin);
      if (st.onTime) onTime++; else late++;
      if (st.dwellMin != null) { dwell += st.dwellMin; dwellN++; }
    }
    const total = onTime + late + noShow;
    return { carrier, total, onTime, late, noShow, rate: total ? onTime / total : 0, avgDwellMin: dwellN ? Math.round(dwell / dwellN) : null };
  }).sort((a, b) => b.total - a.total);
}

/** Average door utilisation per day across the range. */
export function utilizationByDay(appts, docks, from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const u = utilization(appts, docks.filter((x) => x.active !== false), d);
    const open = u.reduce((a, x) => a + x.openMin, 0);
    const booked = u.reduce((a, x) => a + x.bookedMin, 0);
    out.push({ date: d, ratio: open ? booked / open : 0 });
  }
  return out;
}

/** D&D cost by carrier (shipping line) for shipments discharged in range. */
export function dndByCarrier(shipments, tariffs, from, to, today) {
  const tmap = new Map(tariffs.map((t) => [t.id, t]));
  const rel = shipments.filter((s) => s.mode === "FCL" && isDate(s.dischargeDate) && s.dischargeDate >= from && s.dischargeDate <= to);
  const g = groupBy(rel, (s) => s.carrier);
  return [...g].map(([carrier, list]) => {
    let cost = 0, boxes = 0, charged = 0;
    for (const s of list) {
      const d = dnd(s, tmap.get(s.tariffId), today);
      if (!d) continue;
      boxes++;
      cost += d.total;
      if (d.total > 0) charged++;
    }
    return { carrier, boxes, charged, cost: Math.round(cost * 100) / 100 };
  }).sort((a, b) => b.cost - a.cost);
}

/** Receiving accuracy per supplier for receipts finalized in range. */
export function supplierAccuracy(shipments, from, to) {
  const rel = shipments.filter((s) => s.receipt?.finalized && s.receipt.receivedAt >= from && s.receipt.receivedAt <= to);
  const g = groupBy(rel, (s) => s.supplier);
  return [...g].map(([supplier, list]) => {
    let lines = 0, bad = 0, units = 0, short = 0, damaged = 0;
    for (const s of list) {
      const o = osd(s.receipt.lines || []);
      lines += o.rows.length;
      bad += o.exceptions;
      units += o.totals.expected;
      short += o.totals.short;
      damaged += o.totals.damaged;
    }
    return { supplier, receipts: list.length, lines, exceptionLines: bad, accuracy: lines ? 1 - bad / lines : 1, units, short, damaged };
  }).sort((a, b) => a.accuracy - b.accuracy);
}
