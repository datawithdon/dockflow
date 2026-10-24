// Shipment list and the new/edit shipment form.

import { h, mount, money, toast } from "../dom.js";
import { state, save, uid, byId, nextNumber, today } from "../state.js";
import { dnd } from "../engine/freetime.js";
import { validateContainer } from "../engine/container.js";
import { SHIP_STATUS, MODES, SIZES, badge, bind, bindCheck, bindSelect, field, openDialog, options } from "../ui.js";
import { register, go, rerender } from "../router.js";
import { daysLeftBadge } from "./today.js";

const filters = { q: "", status: "OPEN", clientId: "" };

function render(el) {
  const cur = state.settings.currency;
  const list = state.shipments.filter((s) => {
    if (filters.status === "OPEN" && s.status === "CLOSED") return false;
    if (filters.status && filters.status !== "OPEN" && s.status !== filters.status) return false;
    if (filters.clientId && s.clientId !== filters.clientId) return false;
    return true;
  }).sort((a, b) => String(a.eta || "9999").localeCompare(String(b.eta || "9999")));

  const search = h("input", { type: "search", placeholder: "Search ref, container, carrier, supplier…", value: filters.q, "aria-label": "Search shipments", class: "w-260" });
  search.addEventListener("input", () => { filters.q = search.value; renderTable(); });
  const tableBox = h("div");

  const renderTable = () => {
    const ql = filters.q.trim().toLowerCase();
    const rows = list.filter((s) => !ql || [s.ref, s.containerNo, s.carrier, s.supplier, s.seal, byId("clients", s.clientId)?.name].some((v) => String(v || "").toLowerCase().includes(ql)));
    mount(tableBox, rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "clickable" },
      h("thead", {}, h("tr", {}, ["Ref", "Client", "Mode", "Container / seal", "Carrier", "ETA", "Status", "Free time", "Docs", "Receipt"].map((x) => h("th", { text: x })))),
      h("tbody", {}, rows.map((s) => {
        const d = dnd(s, byId("tariffs", s.tariffId), today());
        const running = d && [d.dem, d.det].find((c) => c?.status === "RUNNING");
        const nDocs = ["PO", "PACKING_LIST", "INVOICE", "BOL"].filter((t) => s.docs?.[t]).length;
        return h("tr", { onclick: () => go(`#/shipment/${s.id}`) },
          h("td", {}, h("a", { href: `#/shipment/${s.id}`, text: s.ref })),
          h("td", { text: byId("clients", s.clientId)?.name || "—" }),
          h("td", { text: s.mode }),
          h("td", {}, h("span", { class: "mono", text: s.containerNo || "—" }), s.seal ? h("div", { class: "muted small", text: `Seal ${s.seal}` }) : null),
          h("td", { text: s.carrier || "—" }),
          h("td", { text: s.eta || "—" }),
          h("td", {}, badge(SHIP_STATUS[s.status] || s.status, s.status === "RECEIVED" ? "good" : s.status === "AT_DOCK" ? "accent" : "")),
          h("td", {}, running ? daysLeftBadge(running) : d && d.total > 0 ? h("span", { class: "small", text: money(d.total, cur) }) : h("span", { class: "muted", text: "—" })),
          h("td", {}, nDocs ? badge(`${nDocs}/4`, nDocs >= 2 ? "good" : "") : h("span", { class: "muted", text: "—" })),
          h("td", {}, s.receipt?.finalized ? badge("Received", "good") : s.receipt ? badge("Counting", "accent") : h("span", { class: "muted", text: "—" })));
      })))) : h("p", { class: "empty", text: "No shipments match." }));
  };

  mount(el,
    h("div", { class: "page-head" }, h("h1", { text: "Shipments" }), h("button", { class: "btn primary", onclick: () => editShipment(), text: "+ New shipment" })),
    h("div", { class: "card" },
      h("div", { class: "row mb-12" },
        search,
        bindSelect(filters, "status", [h("option", { value: "OPEN", text: "All open" }), h("option", { value: "", text: "All, incl. closed" }), ...options(SHIP_STATUS)], rerender),
        bindSelect(filters, "clientId", [h("option", { value: "", text: "All clients" }), ...state.clients.map((c) => h("option", { value: c.id, text: c.name }))], rerender),
        h("span", { class: "muted small", text: `${list.length} shipment(s)` })),
      tableBox));
  renderTable();
}

export function editShipment(existing) {
  const isNew = !existing;
  const s = existing ? { ...existing } : {
    id: uid(), ref: "", clientId: state.clients[0]?.id || "", mode: "FCL", carrier: "", supplier: "", containerNo: "", containerSize: "40HC", seal: "",
    eta: today(), tariffId: "", dischargeDate: null, gateOutDate: null, emptyReturnDate: null, status: "EXPECTED", reefer: false, hazmat: false,
    docs: {}, receipt: null, releases: [], services: [], notes: "",
  };
  const cnHint = h("div", { class: "small" });
  const checkCn = () => {
    if (!s.containerNo) { mount(cnHint); return; }
    const v = validateContainer(s.containerNo);
    mount(cnHint, v.valid ? h("span", { class: "good-text", text: "✓ Valid ISO 6346 number" }) : h("span", { class: "warn-text", text: `Check: ${v.reason}` }));
  };
  const fclBox = h("div", { class: "fields" });
  const renderFcl = () => {
    if (s.mode !== "FCL") { mount(fclBox); return; }
    const matching = state.tariffs.filter((t) => !s.carrier || !t.carrier || t.carrier.toLowerCase() === s.carrier.toLowerCase());
    mount(fclBox,
      field("Container no.", h("div", {}, bind(s, "containerNo", { maxlength: 15, class: "mono", placeholder: "ABCU1234567" }, checkCn), cnHint)),
      field("Size", bindSelect(s, "containerSize", SIZES.map((z) => h("option", { value: z, text: z + "'" })))),
      field("Free-time tariff", bindSelect(s, "tariffId", [h("option", { value: "", text: "— none —" }), ...(matching.length ? matching : state.tariffs).map((t) => h("option", { value: t.id, text: t.name }))])),
      field("Discharged at port", bind(s, "dischargeDate", { type: "date" })),
      field("Gated out", bind(s, "gateOutDate", { type: "date" })),
      field("Empty returned", bind(s, "emptyReturnDate", { type: "date" })));
    checkCn();
  };

  openDialog(isNew ? "New shipment" : `Edit ${s.ref}`, (close) => {
    renderFcl();
    return [
      h("div", { class: "fields" },
        field("Reference", bind(s, "ref", { maxlength: 40, placeholder: isNew ? "Auto (IN-0001…)" : "" })),
        field("Client", bindSelect(s, "clientId", [h("option", { value: "", text: "— choose —" }), ...state.clients.map((c) => h("option", { value: c.id, text: c.name }))])),
        field("Mode", bindSelect(s, "mode", options(MODES), renderFcl)),
        field("Status", bindSelect(s, "status", options(SHIP_STATUS))),
        field("Carrier / shipping line", bind(s, "carrier", { maxlength: 80, list: "carrier-list-s" }, renderFcl)),
        field("Supplier / shipper", bind(s, "supplier", { maxlength: 80 })),
        field("ETA", bind(s, "eta", { type: "date" })),
        field("Seal no.", bind(s, "seal", { maxlength: 32, class: "mono" })),
        h("div", { class: "field wide row" }, bindCheck(s, "reefer", "Temperature controlled"), bindCheck(s, "hazmat", "Dangerous goods"))),
      h("datalist", { id: "carrier-list-s" }, [...new Set(state.shipments.map((x) => x.carrier).concat(state.tariffs.map((t) => t.carrier)).filter(Boolean))].sort().map((c) => h("option", { value: c }))),
      h("h3", { class: "sub-h", text: "Container & free time" }),
      fclBox,
      field("Notes", h("textarea", { maxlength: 2000, oninput: (e) => { s.notes = e.target.value; } }, s.notes || ""), { wide: true }),
      h("div", { class: "row end mt-16" },
        h("button", { class: "btn", onclick: close, text: "Cancel" }),
        h("button", { class: "btn primary", onclick: () => {
          if (!s.clientId) { toast("Choose a client."); return; }
          if (!s.ref.trim()) s.ref = nextNumber("shipment", "IN");
          s.ref = s.ref.trim();
          s.containerNo = (s.containerNo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (isNew) state.shipments.push(s); else Object.assign(existing, s);
          save("shipments");
          close();
          if (isNew) go(`#/shipment/${s.id}`); else rerender();
        }, text: isNew ? "Create" : "Save" })),
    ];
  }, { wide: true });
}

register("shipments", render);
