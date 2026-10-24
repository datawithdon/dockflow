// Settings: warehouse profile, operations, dock doors, clients and rates,
// free-time tariffs, AI key, and data (demo, backup, restore, wipe).

import { h, mount, toast, download } from "../dom.js";
import { state, save, saveAll, uid, getApiKey, setApiKey, keyRemembered, exportBackup, importBackup, wipeAll, isSafeImage, COLLECTIONS } from "../state.js";
import * as db from "../db.js";
import { DEFAULT_RATES } from "../engine/billing.js";
import { DEFAULT_TIERS } from "../engine/freetime.js";
import { EQUIPMENT } from "../engine/schedule.js";
import { MODELS } from "../engine/extract.js";
import { sampleData } from "../sample.js";
import { EQUIP_LABEL, bind, bindCheck, bindSelect, confirmDialog, field, openDialog, readFile, tabsNav } from "../ui.js";
import { register, rerender, go } from "../router.js";

const TABS = [["general", "General"], ["docks", "Dock doors"], ["clients", "Clients & rates"], ["tariffs", "Free-time tariffs"], ["ai", "AI"], ["data", "Data"]];

function render(el, [tab = "general"]) {
  const body = h("div");
  mount(el, h("div", { class: "page-head" }, h("h1", { text: "Settings" })), tabsNav(TABS, tab, (k) => `#/settings/${k}`), body);
  ({ general, docks, clients, tariffs, ai, data }[tab] || general)(body);
}

const saved = () => save("settings");

function general(el) {
  const s = state.settings;
  const w = s.warehouse;
  const logoIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", class: "hidden" });
  logoIn.addEventListener("change", async () => {
    const f = logoIn.files[0];
    if (!f) return;
    if (f.size > 300 * 1024) { toast("Logo must be under 300 KB."); return; }
    const url = await readFile(f);
    if (!isSafeImage(url)) { toast("Use a PNG, JPEG or WebP image."); return; }
    w.logo = url;
    saved();
    rerender();
  });
  mount(el,
    h("div", { class: "card" },
      h("h2", { class: "mb-12", text: "Warehouse (printed on reports, claims and invoices)" }),
      h("div", { class: "fields" },
        field("Name", bind(w, "name", { maxlength: 80 }, saved)),
        field("Phone", bind(w, "phone", { maxlength: 40 }, saved)),
        field("Email", bind(w, "email", { type: "email", maxlength: 80 }, saved)),
        field("Address", h("textarea", { maxlength: 300, oninput: (e) => { w.address = e.target.value; saved(); } }, w.address || ""), { wide: true }),
        h("div", { class: "field wide" }, h("span", { text: "Logo" }), h("div", { class: "row" },
          w.logo ? h("img", { src: w.logo, alt: "Logo", class: "logo-preview" }) : h("span", { class: "muted small", text: "None" }),
          h("button", { class: "btn sm", onclick: () => logoIn.click(), text: "Upload" }), logoIn,
          w.logo ? h("button", { class: "btn sm danger", onclick: () => { w.logo = ""; saved(); rerender(); }, text: "Remove" }) : null)))),
    h("div", { class: "card mt-16" },
      h("h2", { class: "mb-12", text: "Operations" }),
      h("div", { class: "fields" },
        field("Currency (ISO code)", bind(s, "currency", { maxlength: 3, class: "mono" }, (v) => { s.currency = String(v).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "USD"; saved(); })),
        field("Late after (minutes)", bind(s, "graceMin", { type: "number", min: 0, step: 5 }, saved)),
        field("Quantity tolerance %", bind(s, "qtyTolPct", { type: "number", min: 0, step: 0.5 }, saved)),
        field("Weight tolerance %", bind(s, "weightTolPct", { type: "number", min: 0, step: 0.5 }, saved)))));
}

// ------------------------------------------------------------------ docks

function docks(el) {
  mount(el, h("div", { class: "card" },
    h("div", { class: "card-head" }, h("h2", { text: "Dock doors" }), h("button", { class: "btn sm primary", onclick: () => editDock(), text: "+ Add door" })),
    state.docks.length ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Door", "Hours", "Equipment", "Reefer", "DG", "Status", ""].map((x) => h("th", { text: x })))),
      h("tbody", {}, state.docks.map((d) => h("tr", {},
        h("td", { text: d.name }), h("td", { text: `${d.open}–${d.close}` }),
        h("td", { text: (d.equipment || []).map((e) => EQUIP_LABEL[e]).join(", ") || "Any" }),
        h("td", { text: d.reefer ? "Yes" : "—" }), h("td", { text: d.hazmat ? "Yes" : "—" }),
        h("td", { text: d.active === false ? "Out of service" : "Active" }),
        h("td", {}, h("button", { class: "btn sm", onclick: () => editDock(d), text: "Edit" }))))))) : h("p", { class: "empty", text: "No doors yet." })));
}

function editDock(existing) {
  const d = existing ? structuredClone(existing) : { id: uid(), name: `Door ${state.docks.length + 1}`, open: "06:00", close: "22:00", reefer: false, hazmat: false, equipment: ["CONTAINER", "TRAILER"], active: true };
  openDialog(existing ? `Edit ${existing.name}` : "Add door", (close) => [
    h("div", { class: "fields" },
      field("Name", bind(d, "name", { maxlength: 40 })),
      field("Opens", bind(d, "open", { type: "time" })),
      field("Closes", bind(d, "close", { type: "time" })),
      h("div", { class: "field wide" }, h("span", { text: "Equipment it can take (none ticked = any)" }), h("div", { class: "row" }, EQUIPMENT.map((e) => {
        const cb = h("input", { type: "checkbox", checked: d.equipment.includes(e) });
        cb.addEventListener("change", () => { d.equipment = cb.checked ? [...d.equipment, e] : d.equipment.filter((x) => x !== e); });
        return h("label", { class: "check" }, cb, EQUIP_LABEL[e]);
      }))),
      h("div", { class: "field wide row" }, bindCheck(d, "reefer", "Reefer plug-in"), bindCheck(d, "hazmat", "Approved for dangerous goods"), bindCheck(d, "active", "In service"))),
    h("div", { class: "row space mt-16" },
      existing ? h("button", { class: "btn danger", onclick: async () => {
        if (state.appointments.some((a) => a.dockId === d.id && a.status === "BOOKED")) { toast("This door has booked appointments. Mark it out of service instead."); return; }
        if (await confirmDialog(`Delete ${d.name}?`, "Delete")) { state.docks = state.docks.filter((x) => x.id !== d.id); save("docks"); close(); rerender(); }
      }, text: "Delete" }) : h("span"),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: close, text: "Cancel" }), h("button", { class: "btn primary", onclick: () => {
        if (!d.name.trim() || !d.open || !d.close || d.open >= d.close) { toast("Enter a name and opening hours (open before close)."); return; }
        if (existing) Object.assign(existing, d); else state.docks.push(d);
        save("docks"); close(); rerender();
      }, text: "Save" }))),
  ]);
}

// ------------------------------------------------------------------ clients

const RATE_FIELDS = [
  ["handlingInPerPallet", "Handling in / pallet"], ["handlingOutPerPallet", "Handling out / pallet"], ["storagePerPalletDay", "Storage / pallet / day"],
  ["freeStorageDays", "Free storage days"], ["devanning20", "Devanning 20'"], ["devanning40", "Devanning 40'/45'"], ["minMonthly", "Monthly minimum"],
];

function clients(el) {
  mount(el, h("div", { class: "card" },
    h("div", { class: "card-head" }, h("h2", { text: "Clients & rates" }), h("button", { class: "btn sm primary", onclick: () => editClient(), text: "+ Add client" })),
    state.clients.length ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Client", "Code", ...RATE_FIELDS.map(([, l]) => l), ""].map((x, i) => h("th", { class: i >= 2 && i < 9 ? "num" : "", text: x })))),
      h("tbody", {}, state.clients.map((c) => h("tr", {},
        h("td", { text: c.name }), h("td", { class: "mono", text: c.code || "" }),
        ...RATE_FIELDS.map(([k]) => h("td", { class: "num", text: String(c.rates?.[k] ?? "") })),
        h("td", {}, h("button", { class: "btn sm", onclick: () => editClient(c), text: "Edit" }))))))) : h("p", { class: "empty", text: "No clients yet." })));
}

function editClient(existing) {
  const c = existing ? structuredClone(existing) : { id: uid(), name: "", code: "", contact: "", rates: DEFAULT_RATES() };
  c.rates = { ...DEFAULT_RATES(), ...(c.rates || {}) };
  openDialog(existing ? `Edit ${existing.name}` : "Add client", (close) => [
    h("div", { class: "fields" },
      field("Name", bind(c, "name", { maxlength: 80 })),
      field("Code (for invoice numbers)", bind(c, "code", { maxlength: 8, class: "mono" })),
      field("Billing contact", bind(c, "contact", { maxlength: 120 }), { wide: true })),
    h("h3", { class: "sub-h", text: `Rates (${state.settings.currency})` }),
    h("div", { class: "fields" }, RATE_FIELDS.map(([k, l]) => field(l, bind(c.rates, k, { type: "number", min: 0, step: "any" })))),
    h("div", { class: "row space mt-16" },
      existing ? h("button", { class: "btn danger", onclick: async () => {
        if (state.shipments.some((s) => s.clientId === c.id)) { toast("This client has shipments and can't be deleted."); return; }
        if (await confirmDialog(`Delete ${c.name}?`, "Delete")) { state.clients = state.clients.filter((x) => x.id !== c.id); save("clients"); close(); rerender(); }
      }, text: "Delete" }) : h("span"),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: close, text: "Cancel" }), h("button", { class: "btn primary", onclick: () => {
        if (!c.name.trim()) { toast("Enter a name."); return; }
        for (const [k] of RATE_FIELDS) c.rates[k] = Math.max(0, Number(c.rates[k]) || 0);
        if (existing) Object.assign(existing, c); else state.clients.push(c);
        save("clients"); close(); rerender();
      }, text: "Save" }))),
  ]);
}

// ------------------------------------------------------------------ tariffs

const tiersToText = (tiers) => (tiers || []).map((t) => `${t.fromDay}:${t.rate}`).join(", ");
function textToTiers(text) {
  const out = [];
  for (const part of String(text).split(/[,;\n]+/)) {
    const m = /^\s*(\d+)\s*[:=]\s*(\d+(?:\.\d+)?)\s*$/.exec(part);
    if (m) out.push({ fromDay: Number(m[1]), rate: Number(m[2]) });
    else if (part.trim()) return null;
  }
  return out.sort((a, b) => a.fromDay - b.fromDay);
}

function tariffs(el) {
  mount(el, h("div", { class: "card" },
    h("div", { class: "card-head" }, h("h2", { text: "Demurrage & detention tariffs" }), h("button", { class: "btn sm primary", onclick: () => editTariff(), text: "+ Add tariff" })),
    h("p", { class: "muted small mb-12", text: "Tiers are \"from chargeable day: rate per day\". Example: 1:75, 5:150, 10:250 means days 1–4 cost 75, days 5–9 cost 150 and day 10 onward 250." }),
    state.tariffs.length ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Tariff", "Line", "Type", "Free days", "Demurrage tiers", "Detention tiers", ""].map((x) => h("th", { text: x })))),
      h("tbody", {}, state.tariffs.map((t) => h("tr", {},
        h("td", { text: t.name }), h("td", { text: t.carrier || "Any" }), h("td", { text: t.combined ? "Combined" : "Split" }),
        h("td", { text: t.combined ? String(t.demFreeDays) : `${t.demFreeDays} dem / ${t.detFreeDays} det` }),
        h("td", { class: "mono small", text: tiersToText(t.demTiers) }), h("td", { class: "mono small", text: t.combined ? "—" : tiersToText(t.detTiers) }),
        h("td", {}, h("button", { class: "btn sm", onclick: () => editTariff(t), text: "Edit" }))))))) : h("p", { class: "empty", text: "No tariffs yet." })));
}

function editTariff(existing) {
  const t = existing ? structuredClone(existing) : { id: uid(), name: "", carrier: "", combined: false, demFreeDays: 4, detFreeDays: 7, demTiers: DEFAULT_TIERS(), detTiers: DEFAULT_TIERS() };
  const text = { dem: tiersToText(t.demTiers), det: tiersToText(t.detTiers) };
  openDialog(existing ? `Edit ${existing.name}` : "Add tariff", (close) => [
    h("div", { class: "fields" },
      field("Name", bind(t, "name", { maxlength: 80, placeholder: "e.g. Line X — port Y dry" }), { wide: true }),
      field("Shipping line (blank = any)", bind(t, "carrier", { maxlength: 80 })),
      h("div", { class: "field" }, h("span", { text: "Type" }), bindCheck(t, "combined", "Combined D&D (one clock)")),
      field("Demurrage / combined free days", bind(t, "demFreeDays", { type: "number", min: 0, step: 1 })),
      field("Detention free days", bind(t, "detFreeDays", { type: "number", min: 0, step: 1 })),
      field("Demurrage / combined tiers", bind(text, "dem", { class: "mono", placeholder: "1:75, 5:150" }), { wide: true }),
      field("Detention tiers", bind(text, "det", { class: "mono", placeholder: "1:50, 6:100" }), { wide: true })),
    h("div", { class: "row space mt-16" },
      existing ? h("button", { class: "btn danger", onclick: async () => {
        if (await confirmDialog(`Delete ${t.name}? Shipments using it will lose their free-time clock.`, "Delete")) { state.tariffs = state.tariffs.filter((x) => x.id !== t.id); save("tariffs"); close(); rerender(); }
      }, text: "Delete" }) : h("span"),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: close, text: "Cancel" }), h("button", { class: "btn primary", onclick: () => {
        const dem = textToTiers(text.dem), det = textToTiers(text.det);
        if (!t.name.trim()) { toast("Enter a name."); return; }
        if (!dem || !det) { toast("Tiers must look like 1:75, 5:150."); return; }
        Object.assign(t, { demTiers: dem, detTiers: det, demFreeDays: Math.max(0, Number(t.demFreeDays) || 0), detFreeDays: Math.max(0, Number(t.detFreeDays) || 0) });
        if (existing) Object.assign(existing, t); else state.tariffs.push(t);
        save("tariffs"); close(); rerender();
      }, text: "Save" }))),
  ]);
}

// ------------------------------------------------------------------ AI

function ai(el) {
  const form = { key: getApiKey(), remember: keyRemembered() };
  const keyIn = h("input", { type: "password", value: form.key, autocomplete: "off", spellcheck: "false", placeholder: "sk-ant-…", class: "mono", "aria-label": "Claude API key" });
  keyIn.addEventListener("input", () => { form.key = keyIn.value.trim(); });
  mount(el, h("div", { class: "card" },
    h("h2", { class: "mb-8", text: "Read documents with Claude" }),
    h("p", { class: "muted", text: "DockFlow can read PDFs and photos of packing lists, invoices, purchase orders and bills of lading into line items. It calls the Claude API directly from your browser with your own API key. No DockFlow server is involved." }),
    h("ul", { class: "muted small" },
      h("li", { text: "By default the key is kept only for this browser tab and is forgotten when you close it." }),
      h("li", { text: "\"Remember\" stores it in this browser's local storage. Only use that on a computer you trust, since browser extensions and anyone with access to this profile can read it." }),
      h("li", { text: "The key is never included in backups or exports." }),
      h("li", {}, "Use a key with a spend limit set in the ", h("a", { href: "https://console.anthropic.com/", target: "_blank", rel: "noopener noreferrer", text: "Claude Console" }), ".")),
    h("div", { class: "fields mt-12" },
      field("API key", keyIn, { wide: true }),
      field("Model", bindSelect(state.settings, "model", Object.entries(MODELS).map(([v, l]) => h("option", { value: v, text: l })), saved)),
      h("div", { class: "field" }, h("span", { text: "Storage" }), bindCheck(form, "remember", "Remember on this device"))),
    h("div", { class: "row mt-12" },
      h("button", { class: "btn primary", onclick: () => { setApiKey(form.key, form.remember); toast(form.key ? "Key saved." : "Key removed."); rerender(); }, text: "Save key" }),
      getApiKey() ? h("button", { class: "btn danger", onclick: () => { setApiKey(""); toast("Key removed."); rerender(); }, text: "Forget key" }) : null)));
}

// ------------------------------------------------------------------ data

function data(el) {
  const fileIn = h("input", { type: "file", accept: "application/json,.json", class: "hidden" });
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files[0];
    if (!f) return;
    if (f.size > 200 * 1024 * 1024) { toast("Backup is too large."); return; }
    try {
      const parsed = JSON.parse(await readFile(f, "text"));
      if (!(await confirmDialog("Restoring replaces all current data in this browser. Continue?", "Restore"))) return;
      await importBackup(parsed, Array.isArray(parsed.photos) ? parsed.photos : []);
      toast("Backup restored.");
      go("#/today");
    } catch (e) {
      toast(e.message || "Could not read that file.");
    }
  });
  const counts = COLLECTIONS.map((c) => `${state[c].length} ${c}`).join(" · ");
  mount(el,
    h("div", { class: "card" },
      h("h2", { class: "mb-8", text: "Your data" }),
      h("p", { class: "muted", text: `Everything is stored in this browser only (IndexedDB${db.isPersistent() ? "" : " is unavailable, so data is kept in memory for this session only"}). Back up regularly.` }),
      h("p", { class: "small mono", text: counts }),
      h("div", { class: "row mt-12" },
        h("button", { class: "btn primary", onclick: async () => {
          const out = exportBackup();
          const withPhotos = await confirmDialog("Include receiving photos in the backup? (Makes the file larger.)", "Include photos", false);
          if (withPhotos) out.photos = await db.allPhotos();
          download(`dockflow-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out), "application/json");
        }, text: "Download backup" }),
        h("button", { class: "btn", onclick: () => fileIn.click(), text: "Restore backup" }), fileIn)),
    h("div", { class: "card mt-16" },
      h("h2", { class: "mb-8", text: "Demo data" }),
      h("p", { class: "muted", text: "Loads fictional doors, clients, tariffs, shipments and 30 days of dock history, dated relative to today. Replaces current data." }),
      h("button", { class: "btn mt-8", onclick: async () => {
        if ((state.shipments.length || state.docks.length) && !(await confirmDialog("Replace all current data with demo data?", "Load demo"))) return;
        await wipeAll();
        Object.assign(state, sampleData());
        saveAll();
        toast("Demo data loaded.");
        go("#/today");
      }, text: "Load demo data" })),
    h("div", { class: "card mt-16 danger-zone" },
      h("h2", { class: "mb-8", text: "Erase everything" }),
      h("p", { class: "muted", text: "Deletes all data, photos and the saved API key from this browser." }),
      h("button", { class: "btn danger mt-8", onclick: async () => {
        if (!(await confirmDialog("Erase all DockFlow data from this browser? This cannot be undone.", "Erase everything"))) return;
        await wipeAll();
        saveAll();
        toast("All data erased.");
        go("#/today");
      }, text: "Erase all data" })));
}

register("settings", render);
