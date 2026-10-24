// "Today": the exceptions feed, the free-time board and today's dock.

import { h, mount, money, num } from "../dom.js";
import { state, today, hsCodes, byId } from "../state.js";
import { collectExceptions } from "../engine/exceptions.js";
import { dnd, projectedCost } from "../engine/freetime.js";
import { liveState } from "../engine/schedule.js";
import { monthOf } from "../engine/dates.js";
import { badge, sevBadge, APPT_STATUS } from "../ui.js";
import { register } from "../router.js";

export function exceptionsNow() {
  return collectExceptions(state, {
    today: today(), now: Date.now(), graceMin: state.settings.graceMin, hsCodes: hsCodes(),
    qtyTolPct: state.settings.qtyTolPct, weightTolPct: state.settings.weightTolPct,
  });
}

/** Running D&D clocks across open shipments, most urgent first. */
export function freeTimeBoard() {
  const t = today();
  const rows = [];
  for (const s of state.shipments) {
    if (s.status === "CLOSED") continue;
    const tariff = byId("tariffs", s.tariffId);
    const d = dnd(s, tariff, t);
    if (!d) continue;
    const running = [["Demurrage", d.dem], ["Detention", d.det]].find(([, c]) => c?.status === "RUNNING");
    if (!running) continue;
    const [stage, c] = running;
    const label = d.combined ? "Combined D&D" : stage;
    const start = stage === "Demurrage" ? s.dischargeDate : s.gateOutDate;
    const free = d.combined || stage === "Demurrage" ? tariff.demFreeDays : tariff.detFreeDays;
    const tiers = d.combined || stage === "Demurrage" ? tariff.demTiers : tariff.detTiers;
    rows.push({ s, stage: label, clock: c, total: d.total, in3: projectedCost(start, free, tiers, t, 3) - c.cost });
  }
  return rows.sort((a, b) => a.clock.daysLeft - b.clock.daysLeft);
}

export const daysLeftBadge = (c) =>
  c.daysLeft < 0 ? badge(`${-c.daysLeft} day${c.daysLeft === -1 ? "" : "s"} over`, "bad")
    : c.daysLeft === 0 ? badge("Last free day", "bad")
      : c.daysLeft <= 2 ? badge(`${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left`, "warn")
        : badge(`${c.daysLeft} days left`, "good");

function render(el) {
  const cur = state.settings.currency;
  const t = today();
  const ex = exceptionsNow();
  const board = freeTimeBoard();
  const appts = state.appointments.filter((a) => a.start.slice(0, 10) === t && a.status !== "CANCELLED").sort((a, b) => a.start.localeCompare(b.start));
  const arrived = appts.filter((a) => a.arrivedAt).length;
  const month = monthOf(t);
  const dndMonth = state.shipments.reduce((sum, s) => {
    const d = dnd(s, byId("tariffs", s.tariffId), t);
    return sum + (d && (s.dischargeDate || "").slice(0, 7) === month ? d.total : 0);
  }, 0);
  const openClaims = state.claims.filter((c) => c.status === "OPEN" || c.status === "SUBMITTED").length;

  if (!state.docks.length && !state.shipments.length) {
    mount(el, h("div", { class: "card empty-state" },
      h("h2", { text: "Welcome to DockFlow" }),
      h("p", { class: "muted", text: "Set up your dock doors, clients and shipping-line free-time tariffs in Settings, or load the demo data to explore." }),
      h("div", { class: "row center mt-12" },
        h("a", { class: "btn primary", href: "#/settings/data", text: "Load demo data" }),
        h("a", { class: "btn", href: "#/settings", text: "Set up my warehouse" }))));
    return;
  }

  mount(el,
    h("div", { class: "page-head" }, h("h1", { text: "Today" }), h("span", { class: "muted", text: new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }) })),
    h("div", { class: "stats mb-16" },
      stat("Needs action", ex.filter((e) => e.severity !== "low").length, `${ex.filter((e) => e.severity === "high").length} urgent`),
      stat("Dock today", `${arrived}/${appts.length}`, "trucks checked in"),
      stat("Boxes on the clock", board.length, `${board.filter((r) => r.clock.daysLeft <= 0).length} at or past free time`),
      stat("D&D this month", money(dndMonth, cur), "on boxes discharged this month"),
      stat("Open claims", openClaims, "")),
    h("div", { class: "grid-2" },
      h("div", { class: "card" },
        h("div", { class: "card-head" }, h("h2", { text: "Exceptions" }), badge(`${ex.length}`, ex.length ? "warn" : "good")),
        ex.length
          ? h("ul", { class: "feed" }, ex.map((e) => h("li", {},
            h("a", { href: e.link, class: "feed-item" },
              sevBadge(e.severity),
              h("div", {}, h("div", { class: "feed-title", text: e.title }), h("div", { class: "muted small", text: e.detail }))))))
          : h("p", { class: "empty", text: "Nothing needs attention. Nice." })),
      h("div", { class: "stack" },
        h("div", { class: "card" },
          h("div", { class: "card-head" }, h("h2", { text: "Free-time board" }), h("span", { class: "muted small", text: "Unload the top of this list first" })),
          board.length ? h("div", { class: "table-wrap" }, h("table", {},
            h("thead", {}, h("tr", {}, ["Container", "Clock", "Last free day", "", "So far", "+3 days"].map((x, i) => h("th", { class: i >= 4 ? "num" : "", text: x })))),
            h("tbody", {}, board.map((r) => h("tr", {},
              h("td", {}, h("a", { href: `#/shipment/${r.s.id}/freetime`, class: "mono", text: r.s.containerNo || r.s.ref }), h("div", { class: "muted small", text: byId("clients", r.s.clientId)?.name || "" })),
              h("td", { text: r.stage }),
              h("td", { text: r.clock.lastFreeDay }),
              h("td", {}, daysLeftBadge(r.clock)),
              h("td", { class: "num", text: money(r.total, cur) }),
              h("td", { class: "num " + (r.in3 > 0 ? "bad-text" : ""), text: r.in3 > 0 ? "+" + money(r.in3, cur) : "—" })))))) : h("p", { class: "empty", text: "No containers are on a demurrage or detention clock." })),
        h("div", { class: "card" },
          h("div", { class: "card-head" }, h("h2", { text: "Dock today" }), h("a", { class: "btn sm", href: `#/dock/${t}`, text: "Open schedule" })),
          appts.length ? h("div", { class: "table-wrap" }, h("table", {},
            h("tbody", {}, appts.map((a) => {
              const st = liveState(a, Date.now(), state.settings.graceMin);
              return h("tr", {},
                h("td", { class: "mono", text: a.start.slice(11, 16) }),
                h("td", { text: byId("docks", a.dockId)?.name || "—" }),
                h("td", {}, a.carrier || "—", a.direction === "OUT" ? h("span", { class: "muted small", text: " · outbound" }) : null),
                h("td", {}, st.flag === "LATE" ? badge("Late", "warn") : st.flag === "MISSED" ? badge("Missed", "bad") : badge(APPT_STATUS[a.status], a.status === "DONE" ? "good" : a.status === "UNLOADING" ? "accent" : "")));
            })))) : h("p", { class: "empty", text: "No appointments today." })))),
  );
}

const stat = (label, value, sub) => h("div", { class: "stat" }, h("div", { class: "label", text: label }), h("div", { class: "value", text: typeof value === "number" ? num(value) : value }), sub ? h("div", { class: "sub", text: sub }) : null);
export { stat };

register("today", render);
