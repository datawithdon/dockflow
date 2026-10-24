// Analytics: carrier punctuality, door utilisation, D&D cost and supplier
// receiving accuracy. Charts are single-series HTML bars with a table view.

import { h, mount, money, pct } from "../dom.js";
import { state, today } from "../state.js";
import { addDays } from "../engine/dates.js";
import { carrierOnTime, dndByCarrier, supplierAccuracy, utilizationByDay } from "../engine/analytics.js";
import { register, go } from "../router.js";

function render(el, [rangeArg]) {
  const days = [30, 60, 90].includes(Number(rangeArg)) ? Number(rangeArg) : 30;
  const to = today(), from = addDays(to, -days + 1);
  const cur = state.settings.currency;
  const ot = carrierOnTime(state.appointments, from, to, state.settings.graceMin);
  const util = utilizationByDay(state.appointments, state.docks, addDays(to, -13), to);
  const dd = dndByCarrier(state.shipments, state.tariffs, from, to, to);
  const sup = supplierAccuracy(state.shipments, from, to);

  const rangeSel = h("select", { class: "w-auto", "aria-label": "Date range" }, [30, 60, 90].map((n) => h("option", { value: n, text: `Last ${n} days`, selected: n === days })));
  rangeSel.addEventListener("change", () => go(`#/analytics/${rangeSel.value}`));

  mount(el,
    h("div", { class: "page-head" }, h("h1", { text: "Analytics" }), rangeSel),
    h("div", { class: "grid-even" },
      chartCard("Carrier on-time arrival", `Share of trucks checked in within ${state.settings.graceMin} min of their slot. No-shows count as not on time.`,
        ot.map((r) => ({ label: r.carrier, value: r.rate, text: pct(r.rate), tip: `${r.onTime} on time, ${r.late} late, ${r.noShow} no-show of ${r.total}${r.avgDwellMin != null ? ` · avg ${r.avgDwellMin} min at door` : ""}` })),
        { max: 1, cols: ["Carrier", "On time", "Late", "No-show", "Rate", "Avg dwell"], rows: ot.map((r) => [r.carrier, r.onTime, r.late, r.noShow, pct(r.rate), r.avgDwellMin != null ? `${r.avgDwellMin} min` : "—"]) }),
      columnCard("Door utilisation, last 14 days", "Booked minutes as a share of open minutes across active doors.", util),
      chartCard("D&D cost by shipping line", "Demurrage and detention on containers discharged in the period.",
        dd.map((r) => ({ label: r.carrier, value: r.cost, text: money(r.cost, cur), tip: `${r.charged} of ${r.boxes} container(s) incurred charges` })),
        { cols: ["Line", "Containers", "With charges", "Cost"], rows: dd.map((r) => [r.carrier, r.boxes, r.charged, money(r.cost, cur)]) }),
      chartCard("Supplier receiving accuracy", "Share of receipt lines with no over, short or damage.",
        sup.map((r) => ({ label: r.supplier, value: r.accuracy, text: pct(r.accuracy), tip: `${r.exceptionLines} exception line(s) of ${r.lines} · ${r.short} short, ${r.damaged} damaged` })),
        { max: 1, cols: ["Supplier", "Receipts", "Lines", "Exceptions", "Short", "Damaged", "Accuracy"], rows: sup.map((r) => [r.supplier, r.receipts, r.lines, r.exceptionLines, r.short, r.damaged, pct(r.accuracy)]) })));
}

/** Horizontal bar chart with a table toggle. */
function chartCard(title, sub, data, table) {
  const max = table.max ?? Math.max(0, ...data.map((d) => d.value));
  const body = h("div");
  let showTable = false;
  const draw = () => mount(body, !data.length ? h("p", { class: "empty", text: "No data in this period." }) : showTable
    ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, table.cols.map((c) => h("th", { text: c })))), h("tbody", {}, table.rows.map((r) => h("tr", {}, r.map((v) => h("td", { text: String(v) })))))))
    : h("div", { class: "hbars", role: "list" }, data.map((d) => {
      const fill = h("div", { class: "hbar-fill" });
      fill.style.width = `${max ? Math.max(0.5, (d.value / max) * 100) : 0}%`;
      return h("div", { class: "hbar", role: "listitem", tabindex: "0", "aria-label": `${d.label}: ${d.text}. ${d.tip}` },
        h("div", { class: "hbar-label", text: d.label }),
        h("div", { class: "hbar-track" }, fill),
        h("div", { class: "hbar-value", text: d.text }),
        h("div", { class: "tip", role: "tooltip", text: d.tip }));
    })));
  draw();
  const toggle = h("button", { class: "btn sm", text: "Table", onclick: () => { showTable = !showTable; toggle.textContent = showTable ? "Chart" : "Table"; draw(); } });
  return h("div", { class: "card" }, h("div", { class: "card-head" }, h("div", {}, h("h2", { text: title }), h("div", { class: "muted small", text: sub })), toggle), body);
}

function columnCard(title, sub, data) {
  const body = h("div", { class: "cols", role: "list" }, data.map((d) => {
    const fill = h("div", { class: "col-fill" });
    fill.style.height = `${Math.max(1, d.ratio * 100)}%`;
    const day = new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
    return h("div", { class: "col", role: "listitem", tabindex: "0", "aria-label": `${day}: ${pct(d.ratio)} booked` },
      h("div", { class: "col-track" }, fill),
      h("div", { class: "col-label", text: day }),
      h("div", { class: "tip", role: "tooltip", text: `${day}: ${pct(d.ratio)} of door time booked` }));
  }));
  return h("div", { class: "card" }, h("div", { class: "card-head" }, h("div", {}, h("h2", { text: title }), h("div", { class: "muted small", text: sub }))),
    h("div", { class: "cols-wrap" }, h("div", { class: "cols-axis", "aria-hidden": "true" }, h("span", { text: "100%" }), h("span", { text: "50%" }), h("span", { text: "0%" })), body));
}

register("analytics", render);
