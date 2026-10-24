// Dock schedule: one lane per door, appointment booking with live conflict
// checks and slot suggestions, and check-in → unloading → done workflow.

import { h, mount, toast } from "../dom.js";
import { state, save, uid, byId, today } from "../state.js";
import { addDays, hhmmToMin, localDateTime, minToHHMM } from "../engine/dates.js";
import { conflicts, freeSlots, liveState, utilization, INACTIVE } from "../engine/schedule.js";
import { APPT_STATUS, EQUIP_LABEL, badge, bind, bindCheck, bindSelect, confirmDialog, field, letterhead, openDialog, options, printNodes } from "../ui.js";
import { register, go, rerender } from "../router.js";

const ROW_MIN = 30;

function render(el, [dateArg]) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateArg || "") ? dateArg : today();
  const docks = state.docks.filter((d) => d.active !== false);
  const appts = state.appointments.filter((a) => a.start.slice(0, 10) === date && a.status !== "CANCELLED").sort((a, b) => a.start.localeCompare(b.start));
  const util = utilization(state.appointments, docks, date);

  const head = h("div", { class: "page-head" },
    h("h1", { text: "Dock schedule" }),
    h("div", { class: "row" },
      h("a", { class: "btn sm", href: `#/dock/${addDays(date, -1)}`, "aria-label": "Previous day", text: "‹" }),
      dateInput(date),
      h("a", { class: "btn sm", href: `#/dock/${addDays(date, 1)}`, "aria-label": "Next day", text: "›" }),
      date !== today() ? h("a", { class: "btn sm", href: `#/dock/${today()}`, text: "Today" }) : null,
      h("button", { class: "btn sm", onclick: () => printSchedule(date, appts), text: "Print" }),
      h("button", { class: "btn primary", onclick: () => editAppointment({ date }), text: "+ Book appointment" })));

  if (!docks.length) {
    mount(el, head, h("div", { class: "card empty" }, "No dock doors yet. ", h("a", { href: "#/settings/docks", text: "Add doors in Settings" }), "."));
    return;
  }

  mount(el, head,
    h("div", { class: "card" }, timeline(date, docks, appts, util)),
    h("div", { class: "card mt-16" },
      h("div", { class: "card-head" }, h("h2", { text: `Appointments (${appts.length})` })),
      appts.length ? apptTable(appts) : h("p", { class: "empty", text: "Nothing booked on this day." })));
}

function dateInput(date) {
  const el = h("input", { type: "date", value: date, class: "w-auto", "aria-label": "Date" });
  el.addEventListener("change", () => el.value && go(`#/dock/${el.value}`));
  return el;
}

function timeline(date, docks, appts, util) {
  const opens = docks.map((d) => hhmmToMin(d.open)).filter(Number.isFinite);
  const closes = docks.map((d) => hhmmToMin(d.close)).filter(Number.isFinite);
  let from = Math.floor(Math.min(...opens, ...appts.map((a) => hhmmToMin(a.start.slice(11, 16)))) / 60) * 60;
  let to = Math.ceil(Math.max(...closes, ...appts.map((a) => hhmmToMin(a.start.slice(11, 16)) + a.durationMin)) / 60) * 60;
  if (!Number.isFinite(from)) from = 360;
  if (!Number.isFinite(to)) to = 1320;
  to = Math.min(to, 1440);
  const rows = (to - from) / ROW_MIN;

  const grid = h("div", { class: "tl-grid", role: "grid", "aria-label": `Dock schedule for ${date}` });
  grid.style.gridTemplateColumns = `56px repeat(${docks.length}, minmax(150px, 1fr))`;
  grid.style.gridTemplateRows = `auto repeat(${rows}, 26px)`;

  grid.append(h("div", { class: "tl-corner" }));
  docks.forEach((d, i) => {
    const u = util.find((x) => x.dockId === d.id);
    const cell = h("div", { class: "tl-head" },
      h("div", { class: "tl-dock", text: d.name }),
      h("div", { class: "muted small" }, `${d.open}–${d.close}`, d.reefer ? " · reefer" : "", d.hazmat ? " · DG" : ""),
      h("div", { class: "bar mt-4", title: `${Math.round((u?.ratio || 0) * 100)}% booked` }, (() => { const b = h("div"); b.style.width = `${Math.min(100, (u?.ratio || 0) * 100)}%`; return b; })()));
    cell.style.gridColumn = String(i + 2);
    grid.append(cell);
  });

  for (let r = 0; r < rows; r++) {
    const t = from + r * ROW_MIN;
    const lab = h("div", { class: "tl-time" + (t % 60 ? " half" : ""), text: t % 60 ? "" : minToHHMM(t) });
    lab.style.gridRow = String(r + 2);
    lab.style.gridColumn = "1";
    grid.append(lab);
    docks.forEach((d, i) => {
      const closed = t < hhmmToMin(d.open) || t >= hhmmToMin(d.close);
      const slot = h("button", { class: "tl-slot" + (closed ? " closed" : "") + (t % 60 ? "" : " hour"), "aria-label": `Book ${d.name} at ${minToHHMM(t)}`, onclick: () => editAppointment({ date, time: minToHHMM(t), dockId: d.id }) });
      slot.style.gridRow = String(r + 2);
      slot.style.gridColumn = String(i + 2);
      grid.append(slot);
    });
  }

  if (date === today()) {
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    if (nowMin >= from && nowMin < to) {
      const line = h("div", { class: "tl-now", "aria-hidden": "true" });
      line.style.gridRow = String(Math.floor((nowMin - from) / ROW_MIN) + 2);
      line.style.gridColumn = `2 / span ${docks.length}`;
      line.style.marginTop = `${(((nowMin - from) % ROW_MIN) / ROW_MIN) * 26}px`;
      grid.append(line);
    }
  }

  for (const a of appts) {
    const col = docks.findIndex((d) => d.id === a.dockId);
    if (col < 0) continue;
    const st = liveState(a, Date.now(), state.settings.graceMin);
    const startRow = Math.floor((hhmmToMin(a.start.slice(11, 16)) - from) / ROW_MIN);
    const span = Math.max(1, Math.ceil(a.durationMin / ROW_MIN));
    const ship = byId("shipments", a.shipmentId);
    const cls = ["tl-appt", `st-${a.status.toLowerCase()}`, st.flag ? `fl-${st.flag.toLowerCase()}` : ""].join(" ");
    const block = h("button", { class: cls, onclick: () => editAppointment({ appt: a }) },
      h("div", { class: "tl-appt-top" }, h("b", { text: a.start.slice(11, 16) }), " ", a.direction === "OUT" ? "OUT " : "", a.carrier || "—"),
      h("div", { class: "small", text: [ship?.ref, ship?.containerNo, EQUIP_LABEL[a.equipment]].filter(Boolean).join(" · ") }),
      h("div", { class: "small", text: { LATE: "Late, not checked in", MISSED: "Missed slot", OVERRUN: "Overrunning" }[st.flag] || APPT_STATUS[a.status] }));
    block.style.gridRow = `${startRow + 2} / span ${span}`;
    block.style.gridColumn = String(col + 2);
    grid.append(block);
  }
  return h("div", { class: "tl-wrap" }, grid);
}

function apptTable(appts) {
  return h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, ["Time", "Door", "Carrier", "Shipment", "Status", "Arrived", ""].map((x) => h("th", { text: x })))),
    h("tbody", {}, appts.map((a) => {
      const st = liveState(a, Date.now(), state.settings.graceMin);
      const ship = byId("shipments", a.shipmentId);
      return h("tr", {},
        h("td", { class: "mono", text: `${a.start.slice(11, 16)} (${a.durationMin}m)` }),
        h("td", { text: byId("docks", a.dockId)?.name || "—" }),
        h("td", { text: `${a.carrier || "—"}${a.direction === "OUT" ? " · outbound" : ""}` }),
        h("td", {}, ship ? h("a", { href: `#/shipment/${ship.id}`, text: ship.ref }) : "—"),
        h("td", {}, statusBadge(a, st)),
        h("td", { text: a.arrivedAt ? `${a.arrivedAt.slice(11, 16)}${st.lateMin > state.settings.graceMin ? ` (+${st.lateMin}m)` : ""}` : "—" }),
        h("td", {}, h("div", { class: "row nowrap" }, quickActions(a))));
    }))));
}

const statusBadge = (a, st) =>
  st.flag === "LATE" ? badge("Late", "warn") : st.flag === "MISSED" ? badge("Missed", "bad") : st.flag === "OVERRUN" ? badge("Overrunning", "warn")
    : badge(APPT_STATUS[a.status], a.status === "DONE" ? "good" : a.status === "UNLOADING" || a.status === "ARRIVED" ? "accent" : a.status === "NO_SHOW" ? "bad" : "");

function quickActions(a) {
  const act = (label, fn, cls = "") => h("button", { class: `btn sm ${cls}`, onclick: (e) => { e.stopPropagation(); fn(); save("appointments"); rerender(); }, text: label });
  const now = localDateTime();
  switch (a.status) {
    case "BOOKED": return [act("Check in", () => { a.status = "ARRIVED"; a.arrivedAt = now; markShipmentAtDock(a); }), act("No-show", () => { a.status = "NO_SHOW"; }, "danger")];
    case "ARRIVED": return [act("Start unloading", () => { a.status = "UNLOADING"; a.startedAt = now; })];
    case "UNLOADING": return [act("Done", () => { a.status = "DONE"; a.doneAt = now; })];
    default: return [];
  }
}

// A truck checking in for an inbound shipment puts it at the dock; for a
// container that also means it has left the terminal (gate-out).
function markShipmentAtDock(a) {
  const s = byId("shipments", a.shipmentId);
  if (!s || a.direction === "OUT") return;
  if (["EXPECTED", "IN_TRANSIT", "AT_PORT"].includes(s.status)) s.status = "AT_DOCK";
  if (s.mode === "FCL" && !s.gateOutDate) s.gateOutDate = a.start.slice(0, 10);
  save("shipments");
}

export function editAppointment({ appt, date, time, dockId, shipmentId } = {}) {
  const isNew = !appt;
  const ship0 = byId("shipments", shipmentId);
  const a = appt ? { ...appt } : {
    id: uid(), dockId: dockId || "", start: `${date || today()}T${time || "08:00"}`, durationMin: 90, carrier: ship0?.carrier || "",
    shipmentId: shipmentId || "", direction: "IN", equipment: ship0 ? (ship0.mode === "FCL" ? "CONTAINER" : ship0.mode === "AIR" || ship0.mode === "PARCEL" ? "VAN" : "TRAILER") : "CONTAINER",
    needsReefer: Boolean(ship0?.reefer), hazmat: Boolean(ship0?.hazmat), status: "BOOKED", notes: "", arrivedAt: null, doneAt: null,
  };
  const parts = { date: a.start.slice(0, 10), time: a.start.slice(11, 16) };
  const issuesBox = h("div", { class: "issues" });
  const slotsBox = h("div", { class: "slots" });
  const docks = state.docks.filter((d) => d.active !== false || d.id === a.dockId);

  const sync = () => {
    a.start = `${parts.date}T${parts.time}`;
    const list = conflicts(a, state.appointments, state.docks);
    mount(issuesBox, list.length
      ? h("ul", { class: "notice-list" }, list.map((i) => h("li", { class: `notice ${i.level}`, text: i.message })))
      : h("div", { class: "notice good", text: "No conflicts." }));
  };
  const shipOptions = state.shipments.filter((s) => s.status !== "CLOSED" || s.id === a.shipmentId)
    .map((s) => h("option", { value: s.id, text: `${s.ref} · ${byId("clients", s.clientId)?.name || ""} · ${s.containerNo || s.mode}`, selected: s.id === a.shipmentId }));

  const suggest = () => {
    const slots = freeSlots(state.appointments.filter((x) => x.id !== a.id), state.docks, parts.date, Number(a.durationMin) || 60,
      { needsReefer: a.needsReefer, hazmat: a.hazmat, equipment: a.equipment }).slice(0, 12);
    const pick = (s) => {
      a.dockId = s.dockId;
      parts.time = s.start.slice(11, 16);
      dockSel.value = a.dockId;
      timeIn.value = parts.time;
      sync();
    };
    mount(slotsBox, slots.length
      ? [h("div", { class: "muted small mb-4", text: "Free slots that fit this load:" }), h("div", { class: "row wrap" }, slots.map((s) =>
        h("button", { class: "btn sm", onclick: () => pick(s), text: `${byId("docks", s.dockId).name} ${s.start.slice(11, 16)}` })))]
      : h("div", { class: "notice warn", text: "No free slot fits on this day. Try another date or a shorter duration." }));
  };

  const dockSel = bindSelect(a, "dockId", [h("option", { value: "", text: "Choose a door" }), ...docks.map((d) => h("option", { value: d.id, text: d.name }))], sync);
  const timeIn = bind(parts, "time", { type: "time", step: 300 }, sync);

  openDialog(isNew ? "Book appointment" : "Appointment", (closeFn) => {
    const shipSel = h("select", {}, h("option", { value: "", text: "— none —" }), shipOptions);
    shipSel.addEventListener("change", () => {
      a.shipmentId = shipSel.value;
      const s = byId("shipments", a.shipmentId);
      if (s) {
        if (!a.carrier) a.carrier = s.carrier || "";
        a.needsReefer = Boolean(s.reefer);
        a.hazmat = Boolean(s.hazmat);
      }
      carrierIn.value = a.carrier;
      reeferBox.querySelector("input").checked = a.needsReefer;
      hazBox.querySelector("input").checked = a.hazmat;
      sync();
    });
    const carrierIn = bind(a, "carrier", { maxlength: 80, list: "carrier-list" });
    const reeferBox = bindCheck(a, "needsReefer", "Needs reefer plug-in", sync);
    const hazBox = bindCheck(a, "hazmat", "Dangerous goods", sync);
    const st = liveState(a, Date.now(), state.settings.graceMin);
    return [
      h("div", { class: "fields" },
        field("Shipment", shipSel, { wide: true }),
        field("Door", dockSel),
        field("Date", bind(parts, "date", { type: "date" }, sync)),
        field("Time", timeIn),
        field("Duration (min)", bind(a, "durationMin", { type: "number", min: 15, step: 15 }, sync)),
        field("Carrier / haulier", carrierIn),
        field("Direction", bindSelect(a, "direction", options({ IN: "Inbound", OUT: "Outbound" }))),
        field("Equipment", bindSelect(a, "equipment", options(EQUIP_LABEL), sync)),
        h("div", { class: "field wide row" }, reeferBox, hazBox),
        field("Notes", bind(a, "notes", { maxlength: 300 }), { wide: true })),
      h("datalist", { id: "carrier-list" }, [...new Set(state.appointments.map((x) => x.carrier).concat(state.shipments.map((s) => s.carrier)).filter(Boolean))].sort().map((c) => h("option", { value: c }))),
      h("div", { class: "mt-12" }, issuesBox),
      h("div", { class: "mt-8" }, h("button", { class: "btn sm", onclick: suggest, text: "Suggest free slots" }), slotsBox),
      !isNew ? h("div", { class: "mt-12 status-row" },
        h("span", { class: "muted small", text: "Status: " }), badge(APPT_STATUS[a.status]),
        a.arrivedAt ? h("span", { class: "muted small", text: ` · arrived ${a.arrivedAt.slice(11, 16)}${st.lateMin != null ? ` (${st.lateMin > 0 ? "+" : ""}${st.lateMin} min)` : ""}` }) : null,
        a.doneAt ? h("span", { class: "muted small", text: ` · done ${a.doneAt.slice(11, 16)}` }) : null) : null,
      h("div", { class: "row space mt-16" },
        h("div", { class: "row" },
          !isNew && !INACTIVE.has(a.status) && a.status !== "DONE" ? h("button", { class: "btn danger", onclick: async () => { if (await confirmDialog("Cancel this appointment?", "Cancel appointment")) { appt.status = "CANCELLED"; save("appointments"); closeFn(); rerender(); } }, text: "Cancel appointment" }) : null,
          !isNew && INACTIVE.has(a.status) ? h("button", { class: "btn danger", onclick: async () => { if (await confirmDialog("Delete this appointment permanently?", "Delete")) { state.appointments = state.appointments.filter((x) => x.id !== a.id); save("appointments"); closeFn(); rerender(); } }, text: "Delete" }) : null),
        h("div", { class: "row" },
          h("button", { class: "btn", onclick: closeFn, text: "Close" }),
          h("button", { class: "btn primary", onclick: () => {
            sync();
            const bad = conflicts(a, state.appointments, state.docks).filter((i) => i.level === "bad");
            if (bad.length) { toast("Fix the conflicts first."); return; }
            if (isNew) state.appointments.push(a); else Object.assign(appt, a);
            save("appointments");
            closeFn();
            toast(isNew ? "Appointment booked." : "Appointment saved.");
            rerender();
          }, text: isNew ? "Book" : "Save" }))),
    ];
  }, { wide: true });
  sync();
}

function printSchedule(date, appts) {
  printNodes(`Dock schedule ${date}`, [
    letterhead("DOCK SCHEDULE", [date]),
    h("table", {},
      h("thead", {}, h("tr", {}, ["Time", "Door", "Dir", "Carrier", "Shipment", "Container", "Equipment", "Status", "Notes"].map((x) => h("th", { text: x })))),
      h("tbody", {}, appts.map((a) => {
        const s = byId("shipments", a.shipmentId);
        return h("tr", {},
          h("td", { text: `${a.start.slice(11, 16)} (${a.durationMin}m)` }), h("td", { text: byId("docks", a.dockId)?.name || "" }), h("td", { text: a.direction }),
          h("td", { text: a.carrier || "" }), h("td", { text: s?.ref || "" }), h("td", { text: s?.containerNo || "" }),
          h("td", { text: `${EQUIP_LABEL[a.equipment] || ""}${a.needsReefer ? " · reefer" : ""}${a.hazmat ? " · DG" : ""}` }),
          h("td", { text: APPT_STATUS[a.status] }), h("td", { text: a.notes || "" }));
      }))),
  ]);
}

register("dock", render);
