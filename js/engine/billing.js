// Client billing for a 3PL warehouse: handling in/out per pallet, devanning
// per container, storage per pallet-day and extra services, with an optional
// monthly minimum.
//
// Storage convention: a pallet is charged for the day it is received and not
// for the day it is released. The client's free storage days count from the
// receipt date.

import { addDays, dayDiff, isDate, maxDate, minDate, periodBounds } from "./dates.js";

const r2 = (n) => Math.round(n * 100) / 100;

export const DEFAULT_RATES = () => ({
  handlingInPerPallet: 6.5,
  handlingOutPerPallet: 6.5,
  storagePerPalletDay: 0.85,
  freeStorageDays: 0,
  devanning20: 180,
  devanning40: 260,
  minMonthly: 0,
});

/** Pallets on hand at the start of `date` (after earlier releases). */
export function onHand(shipment, date) {
  const rec = shipment.receipt;
  if (!rec?.finalized || !isDate(rec.receivedAt) || date < rec.receivedAt) return 0;
  const released = (shipment.releases || []).filter((r) => isDate(r.date) && r.date <= date).reduce((a, r) => a + (Number(r.pallets) || 0), 0);
  return Math.max(0, (Number(rec.pallets) || 0) - released);
}

/** Chargeable pallet-days for one shipment within [from, to]. */
export function palletDays(shipment, from, to, freeDays = 0) {
  const rec = shipment.receipt;
  if (!rec?.finalized || !isDate(rec.receivedAt)) return 0;
  const start = maxDate(from, addDays(rec.receivedAt, Math.max(0, freeDays)));
  if (start > to) return 0;
  let total = 0;
  for (let d = start; d <= to; d = addDays(d, 1)) total += onHand(shipment, d);
  return total;
}

const devanKey = (size) => (String(size).startsWith("20") ? "devanning20" : "devanning40");

/**
 * Build an invoice draft for one client and "YYYY-MM" period. `asOf` caps the
 * storage count for the current month.
 */
export function buildInvoice(client, shipments, period, asOf) {
  const rates = { ...DEFAULT_RATES(), ...(client.rates || {}) };
  const { start, end } = periodBounds(period);
  const until = asOf ? minDate(end, asOf) : end;
  const inPeriod = (d) => isDate(d) && d >= start && d <= until;
  const mine = shipments.filter((s) => s.clientId === client.id);
  const lines = [];
  const push = (code, description, qty, rate, ref = "") => {
    if (!(qty > 0)) return;
    lines.push({ code, description, ref, qty: r2(qty), rate, amount: r2(qty * rate) });
  };

  for (const s of mine) {
    const rec = s.receipt;
    if (rec?.finalized && inPeriod(rec.receivedAt)) {
      push("HIN", `Handling in — ${rec.pallets} pallets`, Number(rec.pallets) || 0, rates.handlingInPerPallet, s.ref);
      if (s.mode === "FCL") push("DEV", `Devanning ${s.containerSize || ""}' container ${s.containerNo || ""}`.replace(/\s+/g, " ").trim(), 1, rates[devanKey(s.containerSize)], s.ref);
    }
    for (const r of s.releases || []) {
      if (inPeriod(r.date)) push("HOUT", `Handling out — ${r.ref || "release"}`, Number(r.pallets) || 0, rates.handlingOutPerPallet, s.ref);
    }
    if (until >= start) {
      const pd = palletDays(s, start, until, rates.freeStorageDays);
      push("STO", `Storage ${start} to ${until}`, pd, rates.storagePerPalletDay, s.ref);
    }
    for (const v of s.services || []) {
      if (inPeriod(v.date)) push("VAS", v.description || "Service", Number(v.qty) || 0, Number(v.rate) || 0, s.ref);
    }
  }

  let subtotal = r2(lines.reduce((a, l) => a + l.amount, 0));
  if (rates.minMonthly > 0 && lines.length && subtotal < rates.minMonthly) {
    lines.push({ code: "MIN", description: "Monthly minimum top-up", ref: "", qty: 1, rate: r2(rates.minMonthly - subtotal), amount: r2(rates.minMonthly - subtotal) });
    subtotal = rates.minMonthly;
  }
  return { clientId: client.id, period, from: start, to: until, lines, total: r2(subtotal), days: dayDiff(start, until) + 1 };
}
