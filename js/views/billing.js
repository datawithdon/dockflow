// Monthly client billing: draft invoices from receipts, releases, storage and
// services; issue, print, export and track them.

import { h, mount, money, toast, download } from "../dom.js";
import { state, save, uid, byId, today } from "../state.js";
import { buildInvoice, onHand } from "../engine/billing.js";
import { monthOf } from "../engine/dates.js";
import { toCSV } from "../engine/csv.js";
import { badge, confirmDialog, letterhead, metaGrid, printNodes } from "../ui.js";
import { register, go, rerender } from "../router.js";

function render(el, [periodArg]) {
  const cur = state.settings.currency;
  const period = /^\d{4}-\d{2}$/.test(periodArg || "") ? periodArg : monthOf(today());
  const isCurrent = period === monthOf(today());
  const drafts = state.clients.map((c) => ({ client: c, inv: buildInvoice(c, state.shipments, period, isCurrent ? today() : null) }));
  const issued = state.invoices.filter((i) => i.period === period);
  const monthIn = h("input", { type: "month", value: period, class: "w-auto", "aria-label": "Billing month" });
  monthIn.addEventListener("change", () => monthIn.value && go(`#/billing/${monthIn.value}`));

  mount(el,
    h("div", { class: "page-head" }, h("h1", { text: "Billing" }), h("div", { class: "row" }, monthIn,
      h("button", { class: "btn sm", onclick: () => exportCsv(period, drafts), text: "Export CSV" }))),
    isCurrent ? h("p", { class: "notice info mb-12", text: `This month is still open: storage is counted up to today (${today()}). Issue invoices after month end.` }) : null,
    h("div", { class: "card mb-16" },
      h("h2", { class: "mb-12", text: "Inventory on hand" }),
      state.clients.length ? h("div", { class: "stats" }, state.clients.map((c) => {
        const pallets = state.shipments.filter((s) => s.clientId === c.id).reduce((a, s) => a + onHand(s, today()), 0);
        return h("div", { class: "stat" }, h("div", { class: "label", text: c.name }), h("div", { class: "value", text: `${pallets} pallets` }));
      })) : h("p", { class: "muted" }, "No clients yet. ", h("a", { href: "#/settings/clients", text: "Add clients" }))),
    drafts.map(({ client, inv }) => {
      const done = issued.find((i) => i.clientId === client.id);
      return h("div", { class: "card mb-16" },
        h("div", { class: "card-head" },
          h("h2", {}, client.name, " ", done ? badge(`Issued ${done.no}${done.paid ? " · paid" : ""}`, done.paid ? "good" : "accent") : badge("Draft")),
          h("div", { class: "row" },
            done ? [
              h("button", { class: "btn sm", onclick: () => printInvoice(done), text: "Print" }),
              h("button", { class: "btn sm", onclick: () => { done.paid = !done.paid; save("invoices"); rerender(); }, text: done.paid ? "Mark unpaid" : "Mark paid" }),
              h("button", { class: "btn sm danger", onclick: async () => { if (await confirmDialog(`Void invoice ${done.no}? The draft will be recalculated from current data.`, "Void")) { state.invoices = state.invoices.filter((x) => x !== done); save("invoices"); rerender(); } }, text: "Void" }),
            ] : [
              h("button", { class: "btn sm", onclick: () => printInvoice({ ...inv, no: "DRAFT", issuedAt: today(), clientName: client.name, currency: cur }), text: "Preview" }),
              h("button", { class: "btn sm primary", disabled: !inv.lines.length, onclick: () => issue(client, inv), text: "Issue invoice" }),
            ])),
        invoiceTable(done || inv, cur));
    }));
}

function invoiceTable(inv, cur) {
  if (!inv.lines.length) return h("p", { class: "muted", text: "No billable activity this month." });
  return h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, ["Ref", "Description", "Qty", "Rate", "Amount"].map((x, i) => h("th", { class: i >= 2 ? "num" : "", text: x })))),
    h("tbody", {}, inv.lines.map((l) => h("tr", {}, h("td", { class: "mono", text: l.ref }), h("td", { text: l.description }),
      h("td", { class: "num", text: String(l.qty) }), h("td", { class: "num", text: money(l.rate, cur) }), h("td", { class: "num", text: money(l.amount, cur) }))),
      h("tr", { class: "total-row" }, h("td", { colspan: "4", text: "Total" }), h("td", { class: "num", text: money(inv.total, cur) })))));
}

function issue(client, inv) {
  const no = `INV-${inv.period.replace("-", "")}-${(client.code || client.name.slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
  state.invoices.push({ id: uid(), no, ...inv, clientName: client.name, currency: state.settings.currency, issuedAt: today(), paid: false });
  save("invoices");
  toast(`Issued ${no}.`);
  rerender();
}

function printInvoice(inv) {
  const client = byId("clients", inv.clientId);
  printNodes(`${inv.no} ${inv.clientName}`, [
    letterhead("INVOICE", [inv.no, `Date: ${inv.issuedAt}`]),
    metaGrid([["Bill to", inv.clientName], ["Client code", client?.code || "—"], ["Period", `${inv.from} to ${inv.to}`], ["Currency", inv.currency]]),
    invoiceTable(inv, inv.currency),
    h("div", { class: "pq-notes", text: "Storage is charged per pallet per day, including the day of receipt and excluding the day of release." }),
  ]);
}

function exportCsv(period, drafts) {
  const rows = [["period", "client", "invoice", "ref", "code", "description", "qty", "rate", "amount"]];
  for (const { client, inv } of drafts) {
    const done = state.invoices.find((i) => i.period === period && i.clientId === client.id);
    for (const l of (done || inv).lines) rows.push([period, client.name, done?.no || "DRAFT", l.ref, l.code, l.description, l.qty, l.rate, l.amount]);
  }
  download(`dockflow-billing-${period}.csv`, toCSV(rows), "text/csv");
}

register("billing", render);
