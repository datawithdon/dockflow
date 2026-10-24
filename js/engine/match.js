// Document matching: purchase order vs packing list vs commercial invoice,
// plus header checks against the bill of lading.
//
// A document is { ref, lines: [{ sku, description, qty, cartons, grossKg, hs,
// unitPrice }], header: { grossKg, packages, containerNo, seal } }.

import { validateContainer, normalizeContainer } from "./container.js";

export const DOC_TYPES = {
  PO: "Purchase order",
  PACKING_LIST: "Packing list",
  INVOICE: "Commercial invoice",
  BOL: "Bill of lading",
};

export const normSku = (s) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");
export const normHs = (s) => String(s ?? "").replace(/[^0-9]/g, "");

const num = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Lines summed per SKU (a SKU may appear on several lines). */
function bySku(doc) {
  const map = new Map();
  for (const l of doc?.lines || []) {
    const k = normSku(l.sku);
    if (!k) continue;
    const cur = map.get(k) || { sku: k, description: l.description || "", qty: 0, grossKg: 0, cartons: 0, hs: new Set(), value: 0 };
    cur.qty += num(l.qty) || 0;
    cur.grossKg += num(l.grossKg) || 0;
    cur.cartons += num(l.cartons) || 0;
    if (normHs(l.hs)) cur.hs.add(normHs(l.hs));
    if (num(l.unitPrice) != null) cur.value += (num(l.unitPrice) || 0) * (num(l.qty) || 0);
    if (!cur.description && l.description) cur.description = l.description;
    map.set(k, cur);
  }
  return map;
}

const totals = (doc, field) => (doc?.lines || []).reduce((a, l) => a + (num(l[field]) || 0), 0);

const withinPct = (a, b, pct) => {
  if (a == null || b == null) return true;
  const base = Math.max(Math.abs(a), Math.abs(b));
  return base === 0 || (Math.abs(a - b) / base) * 100 <= pct + 1e-9;
};

/**
 * @param docs { PO, PACKING_LIST, INVOICE, BOL } (any may be missing)
 * @param opts { qtyTolPct, weightTolPct, hsCodes: Set<string> | null, containerNo, seal }
 * @returns { rows, issues, counts }
 */
export function matchDocuments(docs, opts = {}) {
  const qtyTol = opts.qtyTolPct ?? 0;
  const wtTol = opts.weightTolPct ?? 2;
  const issues = [];
  const add = (level, code, message, sku = null) => issues.push({ level, code, message, sku });

  const present = ["PO", "PACKING_LIST", "INVOICE"].filter((t) => docs[t]?.lines?.length);
  const maps = Object.fromEntries(present.map((t) => [t, bySku(docs[t])]));
  const skus = [...new Set(present.flatMap((t) => [...maps[t].keys()]))].sort();

  const rows = skus.map((sku) => {
    const get = (t) => maps[t]?.get(sku) || null;
    const po = get("PO"), pl = get("PACKING_LIST"), inv = get("INVOICE");
    const row = { sku, description: (pl || inv || po).description, po: po?.qty ?? null, pl: pl?.qty ?? null, inv: inv?.qty ?? null, hs: null, flags: [] };
    for (const t of present) {
      if (!maps[t].get(sku)) {
        row.flags.push(`missing on ${DOC_TYPES[t].toLowerCase()}`);
        add("bad", "MISSING_LINE", `${sku} is not on the ${DOC_TYPES[t].toLowerCase()}.`, sku);
      }
    }
    const qtys = [["PO", row.po], ["PACKING_LIST", row.pl], ["INVOICE", row.inv]].filter(([, q]) => q != null);
    for (let i = 1; i < qtys.length; i++) {
      if (!withinPct(qtys[0][1], qtys[i][1], qtyTol)) {
        row.flags.push("quantity mismatch");
        add("bad", "QTY_MISMATCH", `${sku}: ${DOC_TYPES[qtys[0][0]]} says ${qtys[0][1]}, ${DOC_TYPES[qtys[i][0]].toLowerCase()} says ${qtys[i][1]}.`, sku);
        break;
      }
    }
    if (po && pl && pl.qty > po.qty) add("warn", "OVER_SHIPPED", `${sku}: ${pl.qty - po.qty} more shipped than ordered.`, sku);

    const hsAll = new Set([...(pl?.hs || []), ...(inv?.hs || [])]);
    row.hs = [...hsAll].join(" / ") || null;
    if (pl?.hs.size && inv?.hs.size && ![...pl.hs].some((h) => inv.hs.has(h))) {
      row.flags.push("HS differs");
      add("bad", "HS_MISMATCH", `${sku}: HS ${[...pl.hs].join("/")} on packing list vs ${[...inv.hs].join("/")} on invoice.`, sku);
    }
    for (const h of hsAll) {
      if (h.length < 6) {
        row.flags.push("HS too short");
        add("warn", "HS_FORMAT", `${sku}: HS code ${h} has fewer than 6 digits.`, sku);
      } else if (opts.hsCodes && !opts.hsCodes.has(h.slice(0, 6))) {
        row.flags.push("HS unknown");
        add("bad", "HS_UNKNOWN", `${sku}: HS ${h.slice(0, 6)} is not a valid HS 2022 subheading.`, sku);
      }
    }
    if (inv && !inv.hs.size && !pl?.hs.size) add("warn", "HS_MISSING", `${sku}: no HS code on the invoice or packing list.`, sku);
    return row;
  });

  // Header checks against the bill of lading.
  const bol = docs.BOL?.header;
  const plKg = totals(docs.PACKING_LIST, "grossKg") || num(docs.PACKING_LIST?.header?.grossKg);
  const plPkgs = totals(docs.PACKING_LIST, "cartons") || num(docs.PACKING_LIST?.header?.packages);
  if (bol) {
    const bolKg = num(bol.grossKg), bolPk = num(bol.packages);
    if (bolKg != null && plKg && !withinPct(bolKg, plKg, wtTol)) add("bad", "WEIGHT_MISMATCH", `Gross weight: B/L ${bolKg} kg vs packing list ${round(plKg)} kg (over ${wtTol}% apart).`);
    if (bolPk != null && plPkgs && bolPk !== plPkgs) add("bad", "PACKAGES_MISMATCH", `Packages: B/L ${bolPk} vs packing list ${plPkgs}.`);
    if (bol.containerNo && opts.containerNo && normalizeContainer(bol.containerNo) !== normalizeContainer(opts.containerNo)) {
      add("bad", "CONTAINER_MISMATCH", `Container on B/L (${normalizeContainer(bol.containerNo)}) differs from the shipment (${normalizeContainer(opts.containerNo)}).`);
    }
    if (bol.seal && opts.seal && String(bol.seal).trim().toUpperCase() !== String(opts.seal).trim().toUpperCase()) {
      add("bad", "SEAL_MISMATCH", `Seal on B/L (${bol.seal}) differs from the seal recorded on the shipment (${opts.seal}).`);
    }
  }
  const cn = bol?.containerNo || opts.containerNo;
  if (cn) {
    const v = validateContainer(cn);
    if (!v.valid) add("warn", "CONTAINER_INVALID", `Container number ${v.normalized}: ${v.reason}.`);
  }
  if (!present.length) add("info", "NO_DOCS", "Add at least one document with line items to run the match.");
  else if (present.length === 1 && !bol) add("info", "ONE_DOC", "Only one document has lines — add another to compare against.");

  const counts = { bad: 0, warn: 0, info: 0 };
  for (const i of issues) counts[i.level]++;
  return { rows, issues, counts, totals: { plKg, plPkgs } };
}

const round = (n) => Math.round(n * 10) / 10;
