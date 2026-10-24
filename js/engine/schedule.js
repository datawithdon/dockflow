// Dock appointment rules: conflicts, live state (late / no-show), free slots
// and door utilisation. Appointment start is a local "YYYY-MM-DDTHH:MM".

import { hhmmToMin, parseLocal } from "./dates.js";

const MIN = 60000;
export const INACTIVE = new Set(["CANCELLED", "NO_SHOW"]);
export const EQUIPMENT = ["CONTAINER", "TRAILER", "BOX_TRUCK", "VAN"];

const startMin = (a) => hhmmToMin(a.start.slice(11, 16));
const endMin = (a) => startMin(a) + (Number(a.durationMin) || 0);
const sameDay = (a, b) => a.start.slice(0, 10) === b.start.slice(0, 10);

export const overlaps = (a, b) => sameDay(a, b) && startMin(a) < endMin(b) && startMin(b) < endMin(a);

/** Problems with booking `appt`. Each issue: { level: "bad"|"warn", message }. */
export function conflicts(appt, appts, docks) {
  const issues = [];
  const dock = docks.find((d) => d.id === appt.dockId);
  if (!dock) return [{ level: "bad", message: "Choose a dock door." }];
  if (!appt.start || Number.isNaN(parseLocal(appt.start))) return [{ level: "bad", message: "Enter a valid date and time." }];
  if (!(Number(appt.durationMin) > 0)) issues.push({ level: "bad", message: "Duration must be more than 0 minutes." });
  if (dock.active === false) issues.push({ level: "bad", message: `${dock.name} is out of service.` });

  for (const other of appts) {
    if (other.id === appt.id || other.dockId !== appt.dockId || INACTIVE.has(other.status)) continue;
    if (overlaps(appt, other)) issues.push({ level: "bad", message: `Overlaps ${other.carrier || "another booking"} at ${other.start.slice(11, 16)} on ${dock.name}.` });
  }

  const open = hhmmToMin(dock.open), close = hhmmToMin(dock.close);
  if (Number.isFinite(open) && Number.isFinite(close) && (startMin(appt) < open || endMin(appt) > close)) {
    issues.push({ level: "warn", message: `Outside ${dock.name} hours (${dock.open}–${dock.close}).` });
  }
  if (appt.needsReefer && !dock.reefer) issues.push({ level: "bad", message: `${dock.name} has no reefer plug-in; this load needs one.` });
  if (appt.hazmat && !dock.hazmat) issues.push({ level: "bad", message: `${dock.name} is not approved for dangerous goods.` });
  if (appt.equipment && dock.equipment?.length && !dock.equipment.includes(appt.equipment)) {
    issues.push({ level: "warn", message: `${dock.name} is not set up for ${label(appt.equipment)}.` });
  }
  return issues;
}

const label = (e) => e.replace("_", " ").toLowerCase();

/**
 * Derived live state. LATE: not arrived and past start + grace. MISSED: not
 * arrived and the whole slot has passed (a no-show candidate).
 * Also reports how late a truck arrived and dwell time.
 */
export function liveState(appt, now, graceMin = 15) {
  const start = parseLocal(appt.start);
  const end = start + (Number(appt.durationMin) || 0) * MIN;
  const arrived = appt.arrivedAt ? parseLocal(appt.arrivedAt) : null;
  const done = appt.doneAt ? parseLocal(appt.doneAt) : null;
  const out = { flag: null, lateMin: null, dwellMin: null, onTime: null };
  if (arrived != null) {
    out.lateMin = Math.round((arrived - start) / MIN);
    out.onTime = out.lateMin <= graceMin;
    if (done != null) out.dwellMin = Math.round((done - arrived) / MIN);
  }
  if (appt.status === "BOOKED" && arrived == null) {
    if (now > end) out.flag = "MISSED";
    else if (now > start + graceMin * MIN) out.flag = "LATE";
  }
  if ((appt.status === "ARRIVED" || appt.status === "UNLOADING") && now > end + 60 * MIN) out.flag = "OVERRUN";
  return out;
}

/**
 * Free slots on a date for a booking of durationMin, stepping every stepMin,
 * across docks that meet the requirements. Returns [{ dockId, start }].
 */
export function freeSlots(appts, docks, date, durationMin, req = {}, stepMin = 30) {
  const out = [];
  for (const dock of docks) {
    if (dock.active === false) continue;
    if (req.needsReefer && !dock.reefer) continue;
    if (req.hazmat && !dock.hazmat) continue;
    if (req.equipment && dock.equipment?.length && !dock.equipment.includes(req.equipment)) continue;
    const open = hhmmToMin(dock.open), close = hhmmToMin(dock.close);
    const busy = appts.filter((a) => a.dockId === dock.id && !INACTIVE.has(a.status) && a.start.slice(0, 10) === date);
    for (let t = open; t + durationMin <= close; t += stepMin) {
      const probe = { start: `${date}T${hh(t)}`, durationMin };
      if (!busy.some((b) => overlaps(probe, b))) out.push({ dockId: dock.id, start: probe.start });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

const hh = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;

/** Booked minutes / open minutes for each dock on a date. */
export function utilization(appts, docks, date) {
  return docks.map((dock) => {
    const open = hhmmToMin(dock.open), close = hhmmToMin(dock.close);
    const openMin = Math.max(0, close - open);
    let booked = 0;
    for (const a of appts) {
      if (a.dockId !== dock.id || INACTIVE.has(a.status) || a.start.slice(0, 10) !== date) continue;
      booked += Math.max(0, Math.min(endMin(a), close) - Math.max(startMin(a), open));
    }
    return { dockId: dock.id, name: dock.name, openMin, bookedMin: booked, ratio: openMin ? booked / openMin : 0 };
  });
}
