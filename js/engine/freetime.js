// Demurrage & detention (D&D) clocks.
//
// Demurrage runs while the full container sits at the terminal: from the
// discharge date until gate-out. Detention runs while the container is outside
// the terminal: from gate-out until the empty is returned. Some lines merge the
// two into one clock ("combined") from discharge to empty return.
//
// Days are counted inclusively: a box discharged on the 1st and gated out on
// the 3rd has used 3 days. Free days are consumed first; each chargeable day is
// priced at the tier whose fromDay is the highest one not exceeding that
// chargeable day number (1-based).

import { addDays, dayDiff, isDate } from "./dates.js";

export function tierCost(chargeableDays, tiers) {
  if (!(chargeableDays > 0) || !tiers?.length) return 0;
  const sorted = [...tiers].filter((t) => t.fromDay >= 1).sort((a, b) => a.fromDay - b.fromDay);
  if (!sorted.length) return 0;
  let cost = 0;
  for (let d = 1; d <= chargeableDays; d++) {
    let rate = 0;
    for (const t of sorted) if (t.fromDay <= d) rate = Number(t.rate) || 0;
    cost += rate;
  }
  return Math.round(cost * 100) / 100;
}

/**
 * One clock. start/end are dates; end null means still running (counted to
 * today). Returns status NOT_STARTED | RUNNING | STOPPED.
 */
export function clock(start, end, freeDays, tiers, today) {
  const free = Math.max(0, Number(freeDays) || 0);
  if (!isDate(start) || start > today) {
    return { status: "NOT_STARTED", days: 0, free, chargeable: 0, cost: 0, lastFreeDay: isDate(start) ? addDays(start, free - 1) : null, daysLeft: null };
  }
  const stopped = isDate(end) && end >= start;
  const until = stopped ? end : today;
  const days = dayDiff(start, until) + 1;
  const chargeable = Math.max(0, days - free);
  const lastFreeDay = addDays(start, free - 1);
  return {
    status: stopped ? "STOPPED" : "RUNNING",
    days,
    free,
    chargeable,
    cost: tierCost(chargeable, tiers),
    lastFreeDay,
    // Days of free time left after today (0 = today is the last free day,
    // negative = already in charges). Only meaningful while running.
    daysLeft: stopped ? null : dayDiff(today, lastFreeDay),
  };
}

/** Cost of a running clock if it is stopped `extraDays` from today. */
export function projectedCost(start, freeDays, tiers, today, extraDays) {
  return clock(start, addDays(today, extraDays), freeDays, tiers, addDays(today, extraDays)).cost;
}

/** Full D&D picture for a shipment under its tariff. */
export function dnd(shipment, tariff, today) {
  if (!tariff || !["FCL"].includes(shipment.mode)) return null;
  const s = shipment;
  if (tariff.combined) {
    const c = clock(s.dischargeDate, s.emptyReturnDate, tariff.demFreeDays, tariff.demTiers, today);
    return { combined: true, dem: c, det: null, total: c.cost, urgency: urgency([c]) };
  }
  const dem = clock(s.dischargeDate, s.gateOutDate, tariff.demFreeDays, tariff.demTiers, today);
  const det = isDate(s.gateOutDate)
    ? clock(s.gateOutDate, s.emptyReturnDate, tariff.detFreeDays, tariff.detTiers, today)
    : clock(null, null, tariff.detFreeDays, tariff.detTiers, today);
  return { combined: false, dem, det, total: Math.round((dem.cost + det.cost) * 100) / 100, urgency: urgency([dem, det]) };
}

/**
 * Urgency for sorting: the smallest daysLeft among running clocks.
 * Already-charging clocks are most urgent. Infinity when nothing is running.
 */
function urgency(clocks) {
  let u = Infinity;
  for (const c of clocks) if (c && c.status === "RUNNING" && c.daysLeft != null) u = Math.min(u, c.daysLeft);
  return u;
}

export const DEFAULT_TIERS = () => [{ fromDay: 1, rate: 75 }, { fromDay: 5, rate: 150 }, { fromDay: 10, rate: 250 }];
