// Receiving: expected vs counted, and the resulting over / short / damaged
// (OS&D) report.

import { normSku } from "./match.js";

/** Expected lines from the best document available: packing list > PO > invoice. */
export function expectedLines(docs) {
  const src = ["PACKING_LIST", "PO", "INVOICE"].find((t) => docs?.[t]?.lines?.length);
  if (!src) return { source: null, lines: [] };
  const map = new Map();
  for (const l of docs[src].lines) {
    const k = normSku(l.sku);
    if (!k) continue;
    const cur = map.get(k) || { sku: k, description: l.description || "", expected: 0 };
    cur.expected += Number(l.qty) || 0;
    map.set(k, cur);
  }
  return { source: src, lines: [...map.values()] };
}

/** Merge newly expected lines into an existing receipt without losing counts. */
export function mergeReceiptLines(existing, expected) {
  const out = existing.map((l) => ({ ...l }));
  for (const e of expected) {
    const cur = out.find((l) => normSku(l.sku) === e.sku);
    if (cur) {
      cur.expected = e.expected;
      if (!cur.description) cur.description = e.description;
    } else {
      out.push({ sku: e.sku, description: e.description, expected: e.expected, received: null, damaged: 0, note: "" });
    }
  }
  return out;
}

/** Per line over/short/damaged, plus totals. Uncounted lines are flagged. */
export function osd(lines) {
  const rows = lines.map((l) => {
    const exp = Number(l.expected) || 0;
    const counted = l.received !== null && l.received !== "" && l.received !== undefined;
    const rec = counted ? Number(l.received) || 0 : null;
    const dmg = Math.max(0, Number(l.damaged) || 0);
    const over = counted ? Math.max(0, rec - exp) : 0;
    const short = counted ? Math.max(0, exp - rec) : 0;
    const good = counted ? Math.max(0, rec - dmg) : null;
    return { ...l, expected: exp, received: rec, damaged: dmg, over, short, good, counted, exception: counted && (over > 0 || short > 0 || dmg > 0) };
  });
  const sum = (f) => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0);
  return {
    rows,
    totals: { expected: sum("expected"), received: sum("received"), damaged: sum("damaged"), over: sum("over"), short: sum("short") },
    uncounted: rows.filter((r) => !r.counted).length,
    exceptions: rows.filter((r) => r.exception).length,
  };
}

/** Lines that belong on a damage/shortage claim. */
export const claimLines = (lines) => osd(lines).rows.filter((r) => r.short > 0 || r.damaged > 0);
