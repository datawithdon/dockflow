// Shipment detail: overview, documents & matching (with AI reading),
// receiving & OS&D, free-time clocks, and billable activity.

import { h, mount, money, num, toast, download } from "../dom.js";
import { state, save, uid, byId, today, loadHs, hsCodes, hsDescription, getApiKey, nextNumber, isSafeImage } from "../state.js";
import * as db from "../db.js";
import { DOC_TYPES, matchDocuments } from "../engine/match.js";
import { expectedLines, mergeReceiptLines, osd, claimLines } from "../engine/receiving.js";
import { dnd, projectedCost } from "../engine/freetime.js";
import { validateContainer } from "../engine/container.js";
import { onHand } from "../engine/billing.js";
import { importLines, toCSV } from "../engine/csv.js";
import { IMAGE_TYPES, MAX_FILE_BYTES } from "../engine/extract.js";
import { readDocument } from "../ai.js";
import { SHIP_STATUS, APPT_STATUS, MODES, badge, bind, bindCheck, confirmDialog, field, letterhead, metaGrid, openDialog, printNodes, readFile, compressImage, tabsNav } from "../ui.js";
import { register, go, rerender } from "../router.js";
import { editShipment } from "./shipments.js";
import { editAppointment } from "./dock.js";
import { daysLeftBadge } from "./today.js";

const TABS = [["overview", "Overview"], ["docs", "Documents & match"], ["receiving", "Receiving"], ["freetime", "Free time"], ["billing", "Billable activity"]];

function render(el, [id, tab = "overview"]) {
  const s = byId("shipments", id);
  if (!s) { mount(el, h("div", { class: "card empty" }, "Shipment not found. ", h("a", { href: "#/shipments", text: "Back to shipments" }))); return; }
  s.docs ||= {};
  const client = byId("clients", s.clientId);
  const body = h("div");
  mount(el,
    h("div", { class: "page-head" },
      h("div", {},
        h("a", { href: "#/shipments", class: "muted small", text: "← Shipments" }),
        h("h1", {}, s.ref, " ", badge(SHIP_STATUS[s.status] || s.status, s.status === "RECEIVED" ? "good" : s.status === "AT_DOCK" ? "accent" : "")),
        h("div", { class: "muted" }, [client?.name, MODES[s.mode], s.containerNo && `${s.containerNo} (${s.containerSize}')`, s.carrier, s.supplier && `from ${s.supplier}`].filter(Boolean).join(" · "))),
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: () => editAppointment({ shipmentId: s.id, date: s.eta && s.eta >= today() ? s.eta : today() }), text: "Book dock" }),
        h("button", { class: "btn", onclick: () => editShipment(s), text: "Edit" }),
        h("button", { class: "btn danger", onclick: () => removeShipment(s), text: "Delete" }))),
    tabsNav(TABS, tab, (k) => `#/shipment/${s.id}/${k}`),
    body);
  ({ overview, docs: docsTab, receiving, freetime, billing }[tab] || overview)(body, s);
}

async function removeShipment(s) {
  if (!(await confirmDialog(`Delete ${s.ref} with its documents, receipt and photos? Appointments stay but lose the link.`, "Delete shipment"))) return;
  state.shipments = state.shipments.filter((x) => x.id !== s.id);
  for (const a of state.appointments) if (a.shipmentId === s.id) a.shipmentId = "";
  for (const p of await db.photosFor(s.id)) await db.deletePhoto(p.id);
  save("shipments");
  save("appointments");
  go("#/shipments");
}

// ------------------------------------------------------------------ overview

function overview(el, s) {
  const appts = state.appointments.filter((a) => a.shipmentId === s.id).sort((a, b) => b.start.localeCompare(a.start));
  const d = dnd(s, byId("tariffs", s.tariffId), today());
  const m = matchDocuments(s.docs, matchOpts(s));
  const o = s.receipt ? osd(s.receipt.lines || []) : null;
  const cv = s.containerNo ? validateContainer(s.containerNo) : null;
  mount(el,
    h("div", { class: "grid-2" },
      h("div", { class: "card" },
        h("h2", { class: "mb-12", text: "Details" }),
        metaRows([
          ["Client", byId("clients", s.clientId)?.name],
          ["Mode", MODES[s.mode]],
          ["Carrier", s.carrier],
          ["Supplier", s.supplier],
          ["ETA", s.eta],
          ["Container", s.containerNo ? h("span", {}, h("span", { class: "mono", text: `${s.containerNo} (${s.containerSize}')` }), " ", cv.valid ? badge("valid", "good") : badge(cv.reason, "warn")) : null],
          ["Seal", s.seal],
          ["Handling", [s.reefer && "Temperature controlled", s.hazmat && "Dangerous goods"].filter(Boolean).join(", ") || null],
          ["Notes", s.notes],
        ])),
      h("div", { class: "stack" },
        h("div", { class: "card" },
          h("h2", { class: "mb-12", text: "Status at a glance" }),
          h("ul", { class: "checklist" },
            check(m.counts.bad === 0 && Object.keys(s.docs).length > 0, Object.keys(s.docs).length ? (m.counts.bad ? `${m.counts.bad} document mismatch(es)` : "Documents agree") : "No documents yet", `#/shipment/${s.id}/docs`),
            check(Boolean(appts.find((a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW")), appts.length ? `${appts.length} dock appointment(s)` : "No dock appointment", null),
            check(Boolean(s.receipt?.finalized), s.receipt?.finalized ? `Received ${s.receipt.receivedAt}, ${s.receipt.pallets} pallets${o.exceptions ? ` · ${o.exceptions} OS&D line(s)` : ""}` : s.receipt ? "Counting in progress" : "Not received", `#/shipment/${s.id}/receiving`),
            d ? check(d.total === 0, d.total ? `D&D so far ${money(d.total, state.settings.currency)}` : "No D&D charges", `#/shipment/${s.id}/freetime`) : null)),
        h("div", { class: "card" },
          h("div", { class: "card-head" }, h("h2", { text: "Dock appointments" })),
          appts.length ? h("table", {}, h("tbody", {}, appts.map((a) => h("tr", {},
            h("td", {}, h("a", { href: `#/dock/${a.start.slice(0, 10)}`, text: a.start.replace("T", " ") })),
            h("td", { text: byId("docks", a.dockId)?.name || "—" }),
            h("td", {}, badge(APPT_STATUS[a.status])))))) : h("p", { class: "muted", text: "None booked." })))));
}

const check = (ok, text, href) => h("li", { class: ok ? "ok" : "todo" }, h("span", { class: "tick", "aria-hidden": "true", text: ok ? "✓" : "•" }), href ? h("a", { href, text }) : text);

const metaRows = (pairs) => h("dl", { class: "meta" }, pairs.filter(([, v]) => v != null && v !== "").map(([k, v]) => [h("dt", { text: k }), h("dd", {}, v)]));

// ------------------------------------------------------------------ documents

const matchOpts = (s) => ({ hsCodes: hsCodes(), qtyTolPct: state.settings.qtyTolPct, weightTolPct: state.settings.weightTolPct, containerNo: s.containerNo, seal: s.seal });

function docsTab(el, s) {
  if (!hsCodes()) loadHs().then((m) => m && rerender());
  const m = matchDocuments(s.docs, matchOpts(s));
  mount(el,
    h("div", { class: "doc-grid" }, Object.keys(DOC_TYPES).map((t) => docCard(s, t))),
    !getApiKey() ? h("p", { class: "notice info mt-12" }, "Tip: add a Claude API key in ", h("a", { href: "#/settings/ai", text: "Settings → AI" }), " to read PDFs and photos of documents automatically. CSV import and manual entry work without it.") : null,
    h("div", { class: "card mt-16" },
      h("div", { class: "card-head" },
        h("h2", { text: "Match result" }),
        h("div", { class: "row" },
          m.counts.bad ? badge(`${m.counts.bad} mismatch`, "bad") : null,
          m.counts.warn ? badge(`${m.counts.warn} warning`, "warn") : null,
          !m.counts.bad && !m.counts.warn && m.rows.length ? badge("All documents agree", "good") : null,
          !hsCodes() ? h("span", { class: "muted small", text: "Loading HS list…" }) : null)),
      m.issues.length ? h("ul", { class: "notice-list mb-12" }, m.issues.map((i) => h("li", { class: `notice ${i.level === "bad" ? "bad" : i.level === "warn" ? "warn" : "info"}`, text: i.message }))) : null,
      m.rows.length ? h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["SKU", "Description", "PO qty", "Packing list", "Invoice", "HS code", ""].map((x, i) => h("th", { class: i >= 2 && i <= 4 ? "num" : "", text: x })))),
        h("tbody", {}, m.rows.map((r) => h("tr", { class: r.flags.length ? "row-flag" : "" },
          h("td", { class: "mono", text: r.sku }),
          h("td", { text: r.description }),
          ...["po", "pl", "inv"].map((k) => h("td", { class: "num", text: r[k] == null ? "—" : num(r[k]) })),
          h("td", { title: r.hs ? hsDescription(r.hs.split(" / ")[0]) : "" }, r.hs ? h("span", { class: "mono", text: r.hs }) : "—", r.hs && hsDescription(r.hs.split(" / ")[0]) ? h("div", { class: "muted small clamp", text: hsDescription(r.hs.split(" / ")[0]) }) : null),
          h("td", {}, r.flags.length ? r.flags.map((f) => badge(f, "bad")) : badge("OK", "good"))))))) : null));
}

function docCard(s, type) {
  const doc = s.docs[type];
  const isBol = type === "BOL";
  const fileIn = h("input", { type: "file", accept: "application/pdf,image/*", class: "hidden" });
  fileIn.addEventListener("change", () => fileIn.files[0] && aiRead(s, type, fileIn.files[0]));
  const csvIn = h("input", { type: "file", accept: ".csv,text/csv", class: "hidden" });
  csvIn.addEventListener("change", async () => {
    const f = csvIn.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast("CSV is larger than 5 MB."); return; }
    const r = importLines(await readFile(f, "text"));
    if (!r.lines.length) { toast(r.errors[0] || "No lines found."); return; }
    s.docs[type] = { ...(doc || { ref: "", header: {} }), lines: r.lines };
    save("shipments");
    toast(`Imported ${r.lines.length} line(s)${r.errors.length ? `, ${r.errors.length} skipped` : ""}.`);
    rerender();
  });
  return h("div", { class: "card doc-card" },
    h("div", { class: "card-head" },
      h("h3", { text: DOC_TYPES[type] }),
      h("div", {}, doc?.source === "ai" ? badge("read by AI, check it", "warn") : null,
        doc ? badge(isBol ? "on file" : `${doc.lines?.length || 0} lines`, "good") : badge("missing"))),
    doc ? h("div", { class: "fields" },
      field("Document no.", bind(doc, "ref", { maxlength: 64 }, () => save("shipments"))),
      isBol || type === "PACKING_LIST" ? [
        field("Gross kg", bind(doc.header ||= {}, "grossKg", { type: "number", min: 0, step: "any" }, () => save("shipments"))),
        field("Packages", bind(doc.header, "packages", { type: "number", min: 0, step: 1 }, () => save("shipments"))),
      ] : null,
      isBol ? [
        field("Container no.", bind(doc.header, "containerNo", { maxlength: 15, class: "mono" }, () => save("shipments"))),
        field("Seal no.", bind(doc.header, "seal", { maxlength: 32, class: "mono" }, () => save("shipments"))),
      ] : null) : h("p", { class: "muted small", text: isBol ? "Header only: weight, packages, container and seal." : "Line items: SKU, quantity, cartons, weight, HS code." }),
    h("div", { class: "row mt-8 wrap" },
      h("button", { class: "btn sm primary", onclick: () => fileIn.click(), text: "Read PDF/photo (AI)" }), fileIn,
      !isBol ? [h("button", { class: "btn sm", onclick: () => csvIn.click(), text: "Import CSV" }), csvIn] : null,
      !isBol ? h("button", { class: "btn sm", onclick: () => editLines(s, type), text: doc ? "Edit lines" : "Enter manually" }) : null,
      isBol && !doc ? h("button", { class: "btn sm", onclick: () => { s.docs.BOL = { ref: "", header: { containerNo: s.containerNo || "", seal: s.seal || "" }, lines: [] }; save("shipments"); rerender(); }, text: "Enter manually" }) : null,
      doc ? h("button", { class: "btn sm danger", onclick: async () => { if (await confirmDialog(`Remove the ${DOC_TYPES[type].toLowerCase()}?`, "Remove")) { delete s.docs[type]; save("shipments"); rerender(); } }, text: "Remove" }) : null));
}

async function aiRead(s, slot, file) {
  if (file.size > MAX_FILE_BYTES) { toast("File is larger than 20 MB."); return; }
  const mediaType = file.type === "application/pdf" ? "application/pdf" : IMAGE_TYPES.includes(file.type) ? file.type : null;
  if (!mediaType) { toast("Upload a PDF, JPEG, PNG, WebP or GIF."); return; }
  if (!getApiKey()) { toast("Add your Claude API key in Settings → AI first."); go("#/settings/ai"); return; }
  const status = h("div", { class: "notice info", text: `Reading ${file.name}… this can take up to a minute.` });
  let closeFn;
  openDialog("Reading document", (close) => { closeFn = close; return [status]; });
  try {
    const dataUrl = await readFile(file);
    const base64 = String(dataUrl).split(",")[1] || "";
    const doc = await readDocument({ mediaType, base64 }, DOC_TYPES[slot].toLowerCase());
    closeFn();
    reviewExtraction(s, slot, doc, file.name);
  } catch (e) {
    mount(status.parentElement, h("div", { class: "notice bad", text: e.message || String(e) }), h("div", { class: "row end mt-12" }, h("button", { class: "btn", onclick: () => closeFn(), text: "Close" })));
  }
}

/** Let the user check what the model read before it is saved. */
function reviewExtraction(s, slot, doc, filename) {
  const target = { type: doc.docType !== "OTHER" && DOC_TYPES[doc.docType] ? doc.docType : slot };
  openDialog(`Check what was read from ${filename}`, (close) => [
    doc.docType !== slot && doc.docType !== "OTHER" ? h("p", { class: "notice warn", text: `This looks like a ${DOC_TYPES[doc.docType].toLowerCase()}, not a ${DOC_TYPES[slot].toLowerCase()}.` }) : null,
    h("p", { class: "muted small", text: "AI can misread scans. Compare against the document before saving; you can edit lines afterwards." }),
    metaGrid([["Document no.", doc.ref || "—"], ["Gross kg", doc.header.grossKg ?? "—"], ["Packages", doc.header.packages ?? "—"], ["Container", doc.header.containerNo || "—"], ["Seal", doc.header.seal || "—"]]),
    doc.lines.length ? h("div", { class: "table-wrap mt-12 max-h" }, h("table", {},
      h("thead", {}, h("tr", {}, ["SKU", "Description", "Qty", "Cartons", "Kg", "HS", "Unit price"].map((x) => h("th", { text: x })))),
      h("tbody", {}, doc.lines.map((l) => h("tr", {}, [l.sku, l.description, l.qty, l.cartons, l.grossKg, l.hs, l.unitPrice].map((v) => h("td", { text: v ?? "—" }))))))) : h("p", { class: "muted", text: "No line items found." }),
    h("div", { class: "row space mt-16" },
      h("label", { class: "field w-240" }, h("span", { text: "Save as" }), (() => {
        const sel = h("select", {}, Object.entries(DOC_TYPES).map(([k, v]) => h("option", { value: k, text: v, selected: k === target.type })));
        sel.addEventListener("change", () => { target.type = sel.value; });
        return sel;
      })()),
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: close, text: "Discard" }),
        h("button", { class: "btn primary", onclick: () => {
          s.docs[target.type] = { ref: doc.ref, header: doc.header, lines: doc.lines, source: "ai" };
          if (target.type === "BOL" && !s.containerNo && doc.header.containerNo) s.containerNo = doc.header.containerNo.toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (target.type === "BOL" && !s.seal && doc.header.seal) s.seal = doc.header.seal;
          save("shipments");
          close();
          toast(`Saved ${DOC_TYPES[target.type].toLowerCase()}.`);
          rerender();
        }, text: "Save" }))),
  ], { wide: true });
}

function editLines(s, type) {
  const doc = s.docs[type] ? structuredClone(s.docs[type]) : { ref: "", header: {}, lines: [] };
  if (!doc.lines.length) doc.lines.push(blankLine());
  const tbody = h("tbody");
  const cols = [["sku", "SKU", "text"], ["description", "Description", "text"], ["qty", "Qty", "number"], ["cartons", "Cartons", "number"], ["grossKg", "Gross kg", "number"], ["hs", "HS code", "text"], ["unitPrice", "Unit price", "number"]];
  const draw = () => mount(tbody, doc.lines.map((l, i) => h("tr", {},
    cols.map(([k, , t]) => h("td", {}, bind(l, k, { type: t, step: "any", min: t === "number" ? 0 : null, maxlength: k === "description" ? 200 : 64, "aria-label": `${k} row ${i + 1}` }))),
    h("td", {}, h("button", { class: "icon-btn", "aria-label": "Remove line", onclick: () => { doc.lines.splice(i, 1); draw(); }, text: "×" })))));
  draw();
  openDialog(`${DOC_TYPES[type]} lines`, (close) => [
    h("div", { class: "table-wrap" }, h("table", { class: "edit-table" }, h("thead", {}, h("tr", {}, cols.map(([, l]) => h("th", { text: l })), h("th"))), tbody)),
    h("div", { class: "row space mt-12" },
      h("div", { class: "row" },
        h("button", { class: "btn sm", onclick: () => { doc.lines.push(blankLine()); draw(); }, text: "+ Add line" }),
        h("button", { class: "btn sm", onclick: () => download(`${s.ref}-${type.toLowerCase()}.csv`, toCSV([cols.map(([k]) => k), ...doc.lines.map((l) => cols.map(([k]) => l[k] ?? ""))]), "text/csv"), text: "Export CSV" })),
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: close, text: "Cancel" }),
        h("button", { class: "btn primary", onclick: () => {
          doc.lines = doc.lines.filter((l) => String(l.sku || "").trim() || String(l.description || "").trim());
          delete doc.source; // a person has now reviewed and saved these lines
          s.docs[type] = doc;
          save("shipments");
          close();
          rerender();
        }, text: "Save" }))),
  ], { wide: true });
}

const blankLine = () => ({ sku: "", description: "", qty: null, cartons: null, grossKg: null, hs: "", unitPrice: null });

// ------------------------------------------------------------------ receiving

function receiving(el, s) {
  if (!s.receipt) {
    const exp = expectedLines(s.docs);
    mount(el, h("div", { class: "card empty-state" },
      h("h2", { text: "Receive this shipment" }),
      h("p", { class: "muted", text: exp.source ? `${exp.lines.length} line(s) expected from the ${DOC_TYPES[exp.source].toLowerCase()}.` : "No documents with line items yet. You can still count blind and add lines as you go." }),
      h("button", { class: "btn primary mt-12", onclick: () => {
        s.receipt = { lines: mergeReceiptLines([], exp.lines), receivedAt: today(), pallets: null, sealNo: s.seal || "", sealIntact: true, receivedBy: "", finalized: false, notes: "" };
        if (!s.receipt.lines.length) s.receipt.lines.push({ sku: "", description: "", expected: 0, received: null, damaged: 0, note: "" });
        save("shipments");
        rerender();
      }, text: "Start receiving" })));
    return;
  }
  const r = s.receipt;
  const locked = r.finalized;
  const o = osd(r.lines);
  const summary = h("div");
  const drawSummary = () => {
    const x = osd(r.lines);
    mount(summary, h("div", { class: "stats" },
      statTile("Expected", num(x.totals.expected)),
      statTile("Counted", num(x.totals.received), x.uncounted ? `${x.uncounted} line(s) not counted` : "all lines counted"),
      statTile("Short", num(x.totals.short), "", x.totals.short ? "bad" : ""),
      statTile("Over", num(x.totals.over), "", x.totals.over ? "warn" : ""),
      statTile("Damaged", num(x.totals.damaged), "", x.totals.damaged ? "bad" : "")));
  };
  drawSummary();
  const onEdit = () => { save("shipments"); drawSummary(); };
  const sealMismatch = r.sealNo && s.seal && r.sealNo.trim().toUpperCase() !== s.seal.trim().toUpperCase();

  const photoBox = h("div", { class: "photos" });
  drawPhotos(s, photoBox, locked);

  mount(el,
    h("div", { class: "card" },
      h("div", { class: "card-head" },
        h("h2", {}, "Receipt ", locked ? badge("Finalized", "good") : badge("Counting", "accent")),
        h("div", { class: "row" },
          h("button", { class: "btn sm", onclick: () => printReceipt(s), text: "Print OS&D report" }),
          locked ? h("button", { class: "btn sm", onclick: () => { r.finalized = false; save("shipments"); rerender(); }, text: "Reopen" }) : null,
          !locked ? h("button", { class: "btn sm danger", onclick: async () => { if (await confirmDialog("Discard this receipt and all counts?", "Discard")) { s.receipt = null; save("shipments"); rerender(); } }, text: "Discard" }) : null)),
      h("div", { class: "fields" },
        field("Received on", bind(r, "receivedAt", { type: "date", disabled: locked }, onEdit)),
        field("Pallets put away", bind(r, "pallets", { type: "number", min: 0, step: 1, disabled: locked }, onEdit)),
        field("Received by", bind(r, "receivedBy", { maxlength: 60, disabled: locked }, onEdit)),
        field("Seal no. at arrival", bind(r, "sealNo", { maxlength: 32, class: "mono", disabled: locked }, () => { onEdit(); })),
        h("div", { class: "field" }, h("span", { text: "Seal" }), bindCheck(r, "sealIntact", "Intact", onEdit, locked))),
      sealMismatch ? h("p", { class: "notice bad mt-8", text: `Seal at arrival (${r.sealNo}) differs from the expected seal (${s.seal}). Photograph it and note it on the delivery receipt.` }) : null,
      h("div", { class: "mt-12" }, summary)),
    h("div", { class: "card mt-16" },
      h("div", { class: "card-head" }, h("h2", { text: "Count" }), !locked ? h("button", { class: "btn sm", onclick: () => { r.lines.push({ sku: "", description: "", expected: 0, received: null, damaged: 0, note: "" }); save("shipments"); rerender(); }, text: "+ Unexpected item" }) : null),
      h("div", { class: "table-wrap" }, h("table", { class: "edit-table" },
        h("thead", {}, h("tr", {}, ["SKU", "Description", "Expected", "Received", "Damaged", "Over / short", "Note"].map((x, i) => h("th", { class: i >= 2 && i <= 5 ? "num" : "", text: x })))),
        h("tbody", {}, r.lines.map((l, i) => {
          const row = o.rows[i];
          const diff = h("td", { class: "num" });
          const drawDiff = () => {
            const x = osd([l]).rows[0];
            mount(diff, !x.counted ? h("span", { class: "muted", text: "—" }) : x.short ? h("span", { class: "bad-text", text: `−${x.short}` }) : x.over ? h("span", { class: "warn-text", text: `+${x.over}` }) : h("span", { class: "good-text", text: "✓" }));
          };
          drawDiff();
          const upd = () => { onEdit(); drawDiff(); };
          return h("tr", { class: row.exception ? "row-flag" : "" },
            h("td", {}, l.expected ? h("span", { class: "mono", text: l.sku }) : bind(l, "sku", { maxlength: 64, disabled: locked, class: "mono w-120" }, upd)),
            h("td", {}, l.expected ? l.description : bind(l, "description", { maxlength: 200, disabled: locked }, upd)),
            h("td", { class: "num", text: num(l.expected) }),
            h("td", { class: "num" }, bind(l, "received", { type: "number", min: 0, step: 1, disabled: locked, class: "w-90 num-in", "aria-label": `Received ${l.sku}` }, upd)),
            h("td", { class: "num" }, bind(l, "damaged", { type: "number", min: 0, step: 1, disabled: locked, class: "w-90 num-in", "aria-label": `Damaged ${l.sku}` }, upd)),
            diff,
            h("td", {}, bind(l, "note", { maxlength: 200, disabled: locked }, upd)));
        })))),
      !locked ? h("div", { class: "row end mt-12" },
        h("button", { class: "btn primary", onclick: () => finalize(s), text: "Finalize receipt" })) : null),
    h("div", { class: "card mt-16" },
      h("div", { class: "card-head" }, h("h2", { text: "Photos" }), h("span", { class: "muted small", text: "Seal, container doors, damage. Stored only in this browser." })),
      photoBox),
    locked && (o.totals.short > 0 || o.totals.damaged > 0) ? claimCard(s) : null);
}

const statTile = (label, value, sub = "", tone = "") => h("div", { class: `stat ${tone}` }, h("div", { class: "label", text: label }), h("div", { class: "value", text: value }), sub ? h("div", { class: "sub", text: sub }) : null);

function finalize(s) {
  const r = s.receipt;
  const x = osd(r.lines);
  if (!(Number(r.pallets) > 0)) { toast("Enter how many pallets were put away (used for storage billing)."); return; }
  if (!r.receivedAt) { toast("Enter the received date."); return; }
  const go2 = () => {
    for (const l of r.lines) if (l.received === null || l.received === "") l.received = 0;
    r.lines = r.lines.filter((l) => String(l.sku || "").trim() || l.expected);
    r.finalized = true;
    if (["EXPECTED", "IN_TRANSIT", "AT_PORT", "AT_DOCK"].includes(s.status)) s.status = "RECEIVED";
    if (s.mode === "FCL" && !s.gateOutDate) s.gateOutDate = r.receivedAt;
    save("shipments");
    toast(x.exceptions ? "Receipt finalized with OS&D exceptions." : "Receipt finalized.");
    rerender();
  };
  if (x.uncounted) confirmDialog(`${x.uncounted} line(s) have no count and will be recorded as 0 received (short). Finalize anyway?`, "Finalize", false).then((ok) => ok && go2());
  else go2();
}

async function drawPhotos(s, box, locked) {
  const photos = await db.photosFor(s.id);
  const input = h("input", { type: "file", accept: "image/*", multiple: true, class: "hidden", capture: "environment" });
  input.addEventListener("change", async () => {
    let n = 0;
    for (const f of [...input.files].slice(0, 20)) {
      if (!f.type.startsWith("image/")) continue;
      try {
        const dataUrl = await compressImage(f);
        if (!isSafeImage(dataUrl)) continue;
        await db.putPhoto({ id: uid(), shipmentId: s.id, dataUrl, caption: "", takenAt: new Date().toISOString() });
        n++;
      } catch { /* skip unreadable */ }
    }
    toast(`Added ${n} photo(s).`);
    drawPhotos(s, box, locked);
  });
  mount(box,
    h("div", { class: "photo-grid" }, photos.map((p) => h("figure", { class: "photo" },
      isSafeImage(p.dataUrl) ? h("img", { src: p.dataUrl, alt: p.caption || "Receiving photo", loading: "lazy" }) : null,
      h("figcaption", {},
        h("input", { value: p.caption || "", placeholder: "Caption", maxlength: 120, "aria-label": "Photo caption", onchange: async (e) => { p.caption = e.target.value; await db.putPhoto(p); } }),
        h("button", { class: "icon-btn", "aria-label": "Delete photo", onclick: async () => { if (await confirmDialog("Delete this photo?", "Delete")) { await db.deletePhoto(p.id); drawPhotos(s, box, locked); } }, text: "×" }))))),
    h("div", { class: "row mt-8" }, h("button", { class: "btn sm", onclick: () => input.click(), text: "+ Add photos" }), input,
      !photos.length ? h("span", { class: "muted small", text: "No photos yet." }) : null));
}

function claimCard(s) {
  const existing = state.claims.filter((c) => c.shipmentId === s.id);
  return h("div", { class: "card mt-16" },
    h("div", { class: "card-head" }, h("h2", { text: "Claim" })),
    existing.length
      ? h("p", {}, "Claim ", existing.map((c) => h("a", { href: "#/claims", text: c.no })), " is on file.")
      : h("div", { class: "row space" },
        h("p", { class: "muted", text: "This receipt has shortages or damage. Open a claim while the evidence is fresh; carriers set short notice windows." }),
        h("button", { class: "btn primary", onclick: () => createClaim(s), text: "Create claim" })));
}

/** Value of the short/damaged units using invoice (or PO) unit prices. */
export function claimValue(s) {
  const prices = new Map();
  for (const t of ["INVOICE", "PO"]) for (const l of s.docs?.[t]?.lines || []) {
    const k = String(l.sku || "").trim().toUpperCase().replace(/\s+/g, "");
    if (l.unitPrice != null && !prices.has(k)) prices.set(k, Number(l.unitPrice));
  }
  const lines = claimLines(s.receipt?.lines || []).map((l) => {
    const price = prices.get(l.sku.toUpperCase().replace(/\s+/g, "")) ?? null;
    const units = l.short + l.damaged;
    return { ...l, units, price, value: price != null ? Math.round(units * price * 100) / 100 : null };
  });
  return { lines, total: Math.round(lines.reduce((a, l) => a + (l.value || 0), 0) * 100) / 100 };
}

function createClaim(s) {
  const v = claimValue(s);
  const c = { id: uid(), no: nextNumber("claim", "CLM"), shipmentId: s.id, createdAt: today(), status: "OPEN", party: s.carrier || s.supplier || "",
    partyType: "CARRIER", amountClaimed: v.total, amountSettled: null, notes: "" };
  state.claims.push(c);
  save("claims");
  toast(`Claim ${c.no} created.`);
  go("#/claims");
}

async function printReceipt(s) {
  const r = s.receipt;
  const o = osd(r.lines);
  const photos = await db.photosFor(s.id);
  printNodes(`OS&D ${s.ref}`, [
    letterhead("RECEIVING / OS&D REPORT", [s.ref, `Received ${r.receivedAt || "—"}`]),
    metaGrid([["Client", byId("clients", s.clientId)?.name], ["Carrier", s.carrier], ["Supplier", s.supplier], ["Mode", MODES[s.mode]],
      ["Container", s.containerNo ? `${s.containerNo} (${s.containerSize}')` : "—"], ["Seal expected", s.seal || "—"],
      ["Seal at arrival", `${r.sealNo || "—"} · ${r.sealIntact ? "intact" : "BROKEN / DIFFERENT"}`], ["Pallets", String(r.pallets ?? "—")], ["Received by", r.receivedBy || "—"]]),
    h("table", {},
      h("thead", {}, h("tr", {}, ["SKU", "Description", "Expected", "Received", "Over", "Short", "Damaged", "Note"].map((x) => h("th", { text: x })))),
      h("tbody", {}, o.rows.map((l) => h("tr", {}, [l.sku, l.description, l.expected, l.received ?? "—", l.over || "", l.short || "", l.damaged || "", l.note || ""].map((v) => h("td", { text: String(v) })))),
        h("tr", { class: "total-row" }, h("td", { colspan: "2", text: "Totals" }), ...["expected", "received", "over", "short", "damaged"].map((k) => h("td", { text: String(o.totals[k]) })), h("td")))),
    photos.length ? h("div", { class: "pq-photos" }, photos.filter((p) => isSafeImage(p.dataUrl)).map((p) => h("figure", {}, h("img", { src: p.dataUrl, alt: "" }), h("figcaption", { text: p.caption || "" })))) : null,
    h("div", { class: "pq-sign" }, h("div", { text: "Warehouse signature" }), h("div", { text: "Driver signature" })),
  ]);
}

// ------------------------------------------------------------------ free time

function freetime(el, s) {
  const t = today();
  const tariff = byId("tariffs", s.tariffId);
  const cur = state.settings.currency;
  if (s.mode !== "FCL") { mount(el, h("div", { class: "card empty", text: "Demurrage and detention apply to full containers (FCL) only." })); return; }
  const d = dnd(s, tariff, t);
  const dates = h("div", { class: "fields" },
    field("Free-time tariff", (() => {
      const sel = h("select", {}, h("option", { value: "", text: "— none —" }), state.tariffs.map((x) => h("option", { value: x.id, text: x.name, selected: x.id === s.tariffId })));
      sel.addEventListener("change", () => { s.tariffId = sel.value; save("shipments"); rerender(); });
      return sel;
    })()),
    field("Discharged at port", bind(s, "dischargeDate", { type: "date" }, () => { save("shipments"); rerender(); })),
    field("Gated out", bind(s, "gateOutDate", { type: "date" }, () => { save("shipments"); rerender(); })),
    field("Empty returned", bind(s, "emptyReturnDate", { type: "date" }, () => { save("shipments"); rerender(); })));

  if (!tariff) { mount(el, h("div", { class: "card" }, dates, h("p", { class: "muted mt-12" }, "Pick a tariff to see the clocks. ", h("a", { href: "#/settings/tariffs", text: "Manage tariffs" })))); return; }

  const clockCard = (title, c, freeDays) => h("div", { class: "card" },
    h("div", { class: "card-head" }, h("h2", { text: title }), c.status === "RUNNING" ? daysLeftBadge(c) : badge(c.status === "STOPPED" ? "Stopped" : "Not started", c.status === "STOPPED" ? "good" : "")),
    h("div", { class: "stats" },
      statTile("Days used", c.status === "NOT_STARTED" ? "—" : String(c.days)),
      statTile("Free days", String(freeDays)),
      statTile("Last free day", c.lastFreeDay || "—"),
      statTile("Chargeable", String(c.chargeable), "", c.chargeable ? "bad" : ""),
      statTile("Cost", money(c.cost, cur), "", c.cost ? "bad" : "")));

  const running = d.combined ? (d.dem.status === "RUNNING" ? ["dem", s.dischargeDate, tariff.demFreeDays, tariff.demTiers] : null)
    : d.dem.status === "RUNNING" ? ["dem", s.dischargeDate, tariff.demFreeDays, tariff.demTiers]
      : d.det?.status === "RUNNING" ? ["det", s.gateOutDate, tariff.detFreeDays, tariff.detTiers] : null;

  mount(el,
    h("div", { class: "card" }, dates),
    h("div", { class: "grid-2 mt-16" },
      clockCard(d.combined ? "Combined D&D (discharge → empty return)" : "Demurrage (at terminal)", d.dem, tariff.demFreeDays),
      d.combined ? null : clockCard("Detention (container out)", d.det, tariff.detFreeDays)),
    running ? h("div", { class: "card mt-16" },
      h("h2", { class: "mb-8", text: `What waiting costs (${running[0] === "dem" ? (d.combined ? "combined clock" : "demurrage") : "detention"})` }),
      h("p", { class: "muted small", text: running[0] === "dem" ? "Total if the container gates out (or the empty is returned, for combined tariffs) on each day." : "Total if the empty is returned on each day." }),
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", { text: "If stopped" }), h("th", { class: "num", text: "Clock cost" }), h("th", { class: "num", text: "Extra vs today" }))),
        h("tbody", {}, Array.from({ length: 8 }, (_, k) => {
          const cost = projectedCost(running[1], running[2], running[3], t, k);
          const base = projectedCost(running[1], running[2], running[3], t, 0);
          return h("tr", {}, h("td", { text: k === 0 ? "Today" : k === 1 ? "Tomorrow" : `In ${k} days` }), h("td", { class: "num", text: money(cost, cur) }), h("td", { class: "num " + (cost > base ? "bad-text" : ""), text: cost > base ? "+" + money(cost - base, cur) : "—" }));
        }))))) : null,
    h("p", { class: "muted small mt-12" }, "Total D&D: ", h("b", { text: money(d.total, cur) }), ". Days are counted inclusively from the start date; check your line's tariff for weekend and holiday rules."));
}

// ------------------------------------------------------------------ billing

function billing(el, s) {
  s.releases ||= [];
  s.services ||= [];
  const cur = state.settings.currency;
  const r = s.receipt;
  const now = r?.finalized ? onHand(s, today()) : 0;
  const rel = { date: today(), pallets: null, ref: "" };
  const svc = { date: today(), description: "", qty: 1, rate: null };
  mount(el,
    !r?.finalized ? h("p", { class: "notice info mb-12", text: "Storage and handling are billed once the receipt is finalized." }) : null,
    h("div", { class: "stats mb-16" },
      statTile("Received", r?.finalized ? `${r.pallets} pallets` : "—", r?.receivedAt || ""),
      statTile("Released", `${s.releases.reduce((a, x) => a + (Number(x.pallets) || 0), 0)} pallets`),
      statTile("On hand now", `${now} pallets`)),
    h("div", { class: "grid-2" },
      h("div", { class: "card" },
        h("h2", { class: "mb-12", text: "Releases (outbound)" }),
        s.releases.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Date", "Pallets", "Order / ref", ""].map((x) => h("th", { text: x })))),
          h("tbody", {}, s.releases.map((x) => h("tr", {}, h("td", { text: x.date }), h("td", { text: String(x.pallets) }), h("td", { text: x.ref || "" }),
            h("td", {}, h("button", { class: "icon-btn", "aria-label": "Remove release", onclick: () => { s.releases = s.releases.filter((y) => y !== x); save("shipments"); rerender(); }, text: "×" })))))) : h("p", { class: "muted", text: "None yet." }),
        h("div", { class: "fields mt-12" },
          field("Date", bind(rel, "date", { type: "date" })),
          field("Pallets", bind(rel, "pallets", { type: "number", min: 1, step: 1 })),
          field("Order / ref", bind(rel, "ref", { maxlength: 40 }))),
        h("button", { class: "btn sm mt-8", onclick: () => {
          if (!r?.finalized) { toast("Finalize the receipt first."); return; }
          if (!(rel.pallets > 0)) { toast("Enter pallets."); return; }
          if (rel.date < r.receivedAt) { toast("Release date is before the receipt date."); return; }
          if (rel.pallets > onHand(s, rel.date)) { toast(`Only ${onHand(s, rel.date)} pallet(s) on hand on ${rel.date}.`); return; }
          s.releases.push({ id: uid(), ...rel });
          s.releases.sort((a, b) => a.date.localeCompare(b.date));
          save("shipments");
          rerender();
        }, text: "+ Add release" })),
      h("div", { class: "card" },
        h("h2", { class: "mb-12", text: "Extra services" }),
        s.services.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Date", "Service", "Qty", "Rate", "Amount", ""].map((x, i) => h("th", { class: i >= 2 && i <= 4 ? "num" : "", text: x })))),
          h("tbody", {}, s.services.map((x) => h("tr", {}, h("td", { text: x.date }), h("td", { text: x.description }), h("td", { class: "num", text: String(x.qty) }),
            h("td", { class: "num", text: money(Number(x.rate), cur) }), h("td", { class: "num", text: money(x.qty * x.rate, cur) }),
            h("td", {}, h("button", { class: "icon-btn", "aria-label": "Remove service", onclick: () => { s.services = s.services.filter((y) => y !== x); save("shipments"); rerender(); }, text: "×" })))))) : h("p", { class: "muted", text: "None yet." }),
        h("div", { class: "fields mt-12" },
          field("Date", bind(svc, "date", { type: "date" })),
          field("Service", bind(svc, "description", { maxlength: 80, placeholder: "e.g. Relabel cartons", list: "svc-list" })),
          field("Qty", bind(svc, "qty", { type: "number", min: 0, step: "any" })),
          field(`Rate (${cur})`, bind(svc, "rate", { type: "number", min: 0, step: "any" }))),
        h("datalist", { id: "svc-list" }, ["Relabel cartons", "Shrink wrap pallet", "Palletize loose cartons", "Photo inspection", "Sort & segregate", "Overtime unloading"].map((v) => h("option", { value: v }))),
        h("button", { class: "btn sm mt-8", onclick: () => {
          if (!svc.description.trim() || !(svc.qty > 0) || svc.rate == null) { toast("Enter service, quantity and rate."); return; }
          s.services.push({ id: uid(), ...svc, description: svc.description.trim() });
          save("shipments");
          rerender();
        }, text: "+ Add service" }))));
}

register("shipment", render);
