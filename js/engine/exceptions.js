// One feed of everything that needs a person to act, worst first.

import { addDays, dayDiff, isDate } from "./dates.js";
import { dnd } from "./freetime.js";
import { liveState } from "./schedule.js";
import { matchDocuments } from "./match.js";
import { osd } from "./receiving.js";

const RANK = { high: 0, med: 1, low: 2 };

export function collectExceptions(data, { today, now, graceMin = 15, hsCodes = null, qtyTolPct = 0, weightTolPct = 2 }) {
  const out = [];
  const add = (severity, kind, title, detail, link) => out.push({ severity, kind, title, detail, link });
  const tariffs = new Map((data.tariffs || []).map((t) => [t.id, t]));
  const ships = new Map((data.shipments || []).map((s) => [s.id, s]));
  const docks = new Map((data.docks || []).map((d) => [d.id, d]));

  for (const s of data.shipments || []) {
    if (s.status === "CLOSED") continue;
    const link = `#/shipment/${s.id}`;
    const name = s.containerNo || s.ref;

    const d = dnd(s, tariffs.get(s.tariffId), today);
    if (d) {
      for (const [label, c] of [["Demurrage", d.dem], ["Detention", d.det]]) {
        if (!c || c.status !== "RUNNING") continue;
        if (c.chargeable > 0) add("high", "DND", `${name}: ${label.toLowerCase()} running`, `${c.chargeable} chargeable day(s), ${fmt(c.cost)} so far. Free time ended ${c.lastFreeDay}.`, link);
        else if (c.daysLeft <= 1) add("high", "DND", `${name}: ${label.toLowerCase()} free time ends ${c.daysLeft === 0 ? "today" : "tomorrow"}`, `Last free day ${c.lastFreeDay}.`, link);
        else if (c.daysLeft <= 3) add("med", "DND", `${name}: ${c.daysLeft} free day(s) of ${label.toLowerCase()} left`, `Last free day ${c.lastFreeDay}.`, link);
      }
      if (isDate(s.gateOutDate) && !isDate(s.emptyReturnDate) && s.receipt?.finalized) {
        add("med", "EMPTY", `${name}: unloaded but empty not returned`, `Received ${s.receipt.receivedAt}; return the empty to stop detention.`, link);
      }
    }

    if (s.eta && isDate(s.eta) && s.eta < today && ["EXPECTED", "IN_TRANSIT"].includes(s.status)) {
      add("med", "ETA", `${s.ref}: past ETA with no arrival`, `ETA was ${s.eta} (${dayDiff(s.eta, today)} day(s) ago).`, link);
    }

    const hasDocs = ["PO", "PACKING_LIST", "INVOICE", "BOL"].some((t) => s.docs?.[t]);
    if (hasDocs && !s.receipt?.finalized) {
      const m = matchDocuments(s.docs, { hsCodes, qtyTolPct, weightTolPct, containerNo: s.containerNo, seal: s.seal });
      if (m.counts.bad) add("med", "DOCS", `${s.ref}: ${m.counts.bad} document mismatch(es)`, m.issues.find((i) => i.level === "bad").message, link + "/docs");
    } else if (!hasDocs && s.eta && isDate(s.eta) && s.eta <= addDays(today, 2) && !s.receipt?.finalized) {
      add("low", "DOCS", `${s.ref}: no documents yet`, `Arriving ${s.eta}; add the packing list so receiving can check counts.`, link + "/docs");
    }

    if (s.receipt?.finalized) {
      const o = osd(s.receipt.lines || []);
      const hasClaim = (data.claims || []).some((c) => c.shipmentId === s.id);
      if ((o.totals.short > 0 || o.totals.damaged > 0) && !hasClaim) {
        add("high", "OSD", `${s.ref}: shortage/damage with no claim`, `${o.totals.short} short, ${o.totals.damaged} damaged. Carriers often require notice within days.`, link + "/receiving");
      }
      if (s.receipt.sealIntact === false) add("med", "SEAL", `${s.ref}: seal was broken or different at arrival`, `Seal recorded: ${s.receipt.sealNo || "—"}.`, link + "/receiving");
    }
  }

  for (const a of data.appointments || []) {
    if (a.start.slice(0, 10) !== today) continue;
    const st = liveState(a, now, graceMin);
    const where = docks.get(a.dockId)?.name || "dock";
    const who = a.carrier || ships.get(a.shipmentId)?.ref || "Appointment";
    if (st.flag === "MISSED") add("med", "APPT", `${who} missed ${a.start.slice(11, 16)} slot`, `${where}. Mark no-show or rebook.`, `#/dock/${today}`);
    else if (st.flag === "LATE") add("med", "APPT", `${who} late for ${a.start.slice(11, 16)}`, `${where}, not checked in.`, `#/dock/${today}`);
    else if (st.flag === "OVERRUN") add("low", "APPT", `${who} overrunning on ${where}`, `Booked ${a.durationMin} min from ${a.start.slice(11, 16)}.`, `#/dock/${today}`);
  }

  for (const c of data.claims || []) {
    if (c.status === "OPEN" && isDate(c.createdAt) && dayDiff(c.createdAt, today) >= 3) {
      add("med", "CLAIM", `Claim ${c.no} not submitted`, `Opened ${c.createdAt}, ${dayDiff(c.createdAt, today)} days ago.`, `#/claims`);
    }
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

const fmt = (n) => `$${n.toFixed(2)}`;
