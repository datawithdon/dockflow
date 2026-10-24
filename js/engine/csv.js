// Minimal RFC 4180 CSV parsing/writing, and a forgiving line-item importer
// that recognises common header names from WMS/ERP exports.

export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", i = 0, quoted = false;
  const s = String(text).replace(/^﻿/, "");
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const cell = (v) => {
  let s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection in exported files.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCSV = (rows) => rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";

const HEADERS = {
  sku: ["sku", "item", "item no", "item number", "part", "part no", "part number", "article", "material", "product code", "code", "style"],
  description: ["description", "desc", "item description", "product", "product name", "goods description", "name"],
  qty: ["qty", "quantity", "units", "pcs", "pieces", "qty shipped", "shipped qty", "ordered qty", "order qty"],
  cartons: ["cartons", "ctns", "packages", "pkgs", "boxes", "cases"],
  grossKg: ["gross kg", "gross weight", "gw", "gross wt", "weight", "weight kg", "kg", "gross weight kg"],
  hs: ["hs", "hs code", "hts", "hts code", "tariff code", "commodity code", "hscode"],
  unitPrice: ["unit price", "price", "unit value", "unit cost", "rate"],
};

const norm = (h) => h.toLowerCase().replace(/[()_.#:]/g, " ").replace(/\s+/g, " ").trim();

/** Rows from a CSV into document lines. Returns { lines, errors, mapped }. */
export function importLines(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { lines: [], errors: ["The file needs a header row and at least one data row."], mapped: {} };
  const header = rows[0].map(norm);
  const mapped = {};
  for (const [field, names] of Object.entries(HEADERS)) {
    const idx = header.findIndex((h) => names.includes(h));
    if (idx >= 0) mapped[field] = idx;
  }
  const errors = [];
  if (mapped.sku == null) errors.push("No SKU / item column found.");
  if (mapped.qty == null) errors.push("No quantity column found.");
  if (errors.length) return { lines: [], errors, mapped };
  const n = (v) => {
    const x = Number(String(v ?? "").replace(/[, ]/g, ""));
    return Number.isFinite(x) && String(v ?? "").trim() !== "" ? x : null;
  };
  const lines = [];
  rows.slice(1).forEach((r, i) => {
    const sku = (r[mapped.sku] || "").trim();
    const qty = n(r[mapped.qty]);
    if (!sku) { errors.push(`Row ${i + 2}: no SKU, skipped.`); return; }
    if (qty == null) { errors.push(`Row ${i + 2}: quantity is not a number, skipped.`); return; }
    lines.push({
      sku: sku.slice(0, 64),
      description: (r[mapped.description] || "").trim().slice(0, 200),
      qty,
      cartons: mapped.cartons != null ? n(r[mapped.cartons]) : null,
      grossKg: mapped.grossKg != null ? n(r[mapped.grossKg]) : null,
      hs: mapped.hs != null ? (r[mapped.hs] || "").trim().slice(0, 16) : "",
      unitPrice: mapped.unitPrice != null ? n(r[mapped.unitPrice]) : null,
    });
  });
  return { lines, errors, mapped };
}
