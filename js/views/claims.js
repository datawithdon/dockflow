// OS&D claims register with printable claim letters.

import { h, mount, money, toast } from "../dom.js";
import { state, save, byId } from "../state.js";
import * as db from "../db.js";
import { isSafeImage } from "../state.js";
import { MODES, badge, bind, bindSelect, confirmDialog, field, letterhead, metaGrid, openDialog, options, printNodes } from "../ui.js";
import { register, rerender } from "../router.js";
import { claimValue } from "./shipment.js";

export const CLAIM_STATUS = { OPEN: "Open", SUBMITTED: "Submitted", SETTLED: "Settled", REJECTED: "Rejected" };
const PARTY = { CARRIER: "Carrier", SUPPLIER: "Supplier", INSURER: "Insurer" };

function render(el) {
  const cur = state.settings.currency;
  const list = [...state.claims].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = list.filter((c) => c.status === "OPEN" || c.status === "SUBMITTED");
  const recovered = list.reduce((a, c) => a + (Number(c.amountSettled) || 0), 0);
  mount(el,
    h("div", { class: "page-head" }, h("h1", { text: "Claims" })),
    h("div", { class: "stats mb-16" },
      tile("Open", String(open.length)),
      tile("Claimed (open)", money(open.reduce((a, c) => a + (Number(c.amountClaimed) || 0), 0), cur)),
      tile("Recovered to date", money(recovered, cur))),
    h("div", { class: "card" },
      list.length ? h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Claim", "Shipment", "Against", "Opened", "Status", "Claimed", "Settled", ""].map((x, i) => h("th", { class: i === 5 || i === 6 ? "num" : "", text: x })))),
        h("tbody", {}, list.map((c) => {
          const s = byId("shipments", c.shipmentId);
          return h("tr", {},
            h("td", { class: "mono", text: c.no }),
            h("td", {}, s ? h("a", { href: `#/shipment/${s.id}/receiving`, text: s.ref }) : "—"),
            h("td", { text: `${c.party || "—"} (${PARTY[c.partyType] || ""})` }),
            h("td", { text: c.createdAt }),
            h("td", {}, badge(CLAIM_STATUS[c.status], c.status === "SETTLED" ? "good" : c.status === "REJECTED" ? "bad" : c.status === "SUBMITTED" ? "accent" : "warn")),
            h("td", { class: "num", text: money(Number(c.amountClaimed) || 0, cur) }),
            h("td", { class: "num", text: c.amountSettled != null ? money(Number(c.amountSettled), cur) : "—" }),
            h("td", {}, h("div", { class: "row nowrap" },
              h("button", { class: "btn sm", onclick: () => editClaim(c), text: "Edit" }),
              s ? h("button", { class: "btn sm", onclick: () => printClaim(c, s), text: "Print" }) : null)));
        })))) : h("p", { class: "empty", text: "No claims. Claims are created from a finalized receipt with shortages or damage." })));
}

const tile = (label, value) => h("div", { class: "stat" }, h("div", { class: "label", text: label }), h("div", { class: "value", text: value }));

function editClaim(c) {
  const d = { ...c };
  openDialog(`Claim ${c.no}`, (close) => [
    h("div", { class: "fields" },
      field("Status", bindSelect(d, "status", options(CLAIM_STATUS))),
      field("Claim against", bindSelect(d, "partyType", options(PARTY))),
      field("Party name", bind(d, "party", { maxlength: 80 })),
      field(`Amount claimed (${state.settings.currency})`, bind(d, "amountClaimed", { type: "number", min: 0, step: "any" })),
      field(`Amount settled (${state.settings.currency})`, bind(d, "amountSettled", { type: "number", min: 0, step: "any" })),
      field("Notes (printed on the claim)", h("textarea", { maxlength: 2000, oninput: (e) => { d.notes = e.target.value; } }, d.notes || ""), { wide: true })),
    h("div", { class: "row space mt-16" },
      h("button", { class: "btn danger", onclick: async () => { if (await confirmDialog(`Delete claim ${c.no}?`, "Delete")) { state.claims = state.claims.filter((x) => x.id !== c.id); save("claims"); close(); rerender(); } }, text: "Delete" }),
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: close, text: "Cancel" }),
        h("button", { class: "btn primary", onclick: () => { Object.assign(c, d); save("claims"); close(); toast("Claim saved."); rerender(); }, text: "Save" }))),
  ]);
}

async function printClaim(c, s) {
  const cur = state.settings.currency;
  const v = claimValue(s);
  const photos = (await db.photosFor(s.id)).filter((p) => isSafeImage(p.dataUrl));
  printNodes(`${c.no} ${s.ref}`, [
    letterhead("NOTICE OF CLAIM", [c.no, `Date: ${c.createdAt}`]),
    metaGrid([["To", `${c.party || "—"} (${PARTY[c.partyType] || ""})`], ["Our reference", s.ref], ["Client", byId("clients", s.clientId)?.name],
      ["Mode", MODES[s.mode]], ["Container", s.containerNo || "—"], ["Seal", `${s.receipt?.sealNo || s.seal || "—"}${s.receipt?.sealIntact === false ? " (broken/different at arrival)" : ""}`],
      ["Supplier", s.supplier], ["Received", s.receipt?.receivedAt], ["B/L", s.docs?.BOL?.ref], ["Invoice", s.docs?.INVOICE?.ref]]),
    h("p", { text: "We hereby give notice of claim for the loss and/or damage listed below, found on receipt of the above shipment. Supporting photographs and the receiving report are attached." }),
    h("table", {},
      h("thead", {}, h("tr", {}, ["SKU", "Description", "Short", "Damaged", "Unit value", "Claimed", "Note"].map((x) => h("th", { text: x })))),
      h("tbody", {}, v.lines.map((l) => h("tr", {}, [l.sku, l.description, l.short || "", l.damaged || "", l.price != null ? money(l.price, cur) : "—", l.value != null ? money(l.value, cur) : "—", l.note || ""].map((x) => h("td", { text: String(x) })))),
        h("tr", { class: "total-row" }, h("td", { colspan: "5", text: "Total claimed" }), h("td", { text: money(Number(c.amountClaimed) || 0, cur) }), h("td")))),
    c.notes ? h("div", { class: "pq-notes" }, h("h3", { text: "Notes" }), h("div", { text: c.notes })) : null,
    photos.length ? h("div", { class: "pq-photos" }, photos.map((p) => h("figure", {}, h("img", { src: p.dataUrl, alt: "" }), h("figcaption", { text: p.caption || "" })))) : null,
    h("div", { class: "pq-sign" }, h("div", { text: "Authorised signature" })),
  ]);
}

register("claims", render);
