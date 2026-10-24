import { test } from "node:test";
import assert from "node:assert/strict";
import { dayDiff, addDays, periodBounds } from "../js/engine/dates.js";
import { validateContainer, checkDigit } from "../js/engine/container.js";
import { tierCost, clock, dnd } from "../js/engine/freetime.js";
import { conflicts, liveState, freeSlots, utilization } from "../js/engine/schedule.js";
import { matchDocuments } from "../js/engine/match.js";
import { expectedLines, mergeReceiptLines, osd } from "../js/engine/receiving.js";
import { buildInvoice, palletDays } from "../js/engine/billing.js";
import { importLines, toCSV, parseCSV } from "../js/engine/csv.js";
import { buildRequest, parseResponse, sanitizeDoc } from "../js/engine/extract.js";
import { collectExceptions } from "../js/engine/exceptions.js";

test("dates", () => {
  assert.equal(dayDiff("2026-02-27", "2026-03-02"), 3);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.deepEqual(periodBounds("2028-02"), { start: "2028-02-01", end: "2028-02-29" });
});

test("ISO 6346 container check digit", () => {
  assert.equal(checkDigit("CSQU305438"), 3);
  assert.equal(validateContainer("CSQU3054383").valid, true);
  assert.equal(validateContainer("csqu 305438-3").valid, true);
  assert.match(validateContainer("CSQU3054384").reason, /check digit should be 3/);
  assert.equal(validateContainer("ABC123").valid, false);
});

test("tiered D&D cost", () => {
  const tiers = [{ fromDay: 1, rate: 100 }, { fromDay: 4, rate: 200 }];
  assert.equal(tierCost(0, tiers), 0);
  assert.equal(tierCost(3, tiers), 300);
  assert.equal(tierCost(5, tiers), 700);
});

test("clock counts inclusive days and free time", () => {
  const c = clock("2026-03-01", "2026-03-07", 5, [{ fromDay: 1, rate: 50 }], "2026-03-10");
  assert.equal(c.status, "STOPPED");
  assert.equal(c.days, 7);
  assert.equal(c.chargeable, 2);
  assert.equal(c.cost, 100);
  const r = clock("2026-03-01", null, 5, [{ fromDay: 1, rate: 50 }], "2026-03-04");
  assert.equal(r.status, "RUNNING");
  assert.equal(r.lastFreeDay, "2026-03-05");
  assert.equal(r.daysLeft, 1);
  assert.equal(clock("2026-03-09", null, 5, [], "2026-03-04").status, "NOT_STARTED");
});

test("dnd split and combined", () => {
  const t = { demFreeDays: 3, detFreeDays: 2, demTiers: [{ fromDay: 1, rate: 100 }], detTiers: [{ fromDay: 1, rate: 40 }] };
  const s = { mode: "FCL", dischargeDate: "2026-05-01", gateOutDate: "2026-05-05", emptyReturnDate: null };
  const d = dnd(s, t, "2026-05-08");
  assert.equal(d.dem.chargeable, 2);
  assert.equal(d.dem.cost, 200);
  assert.equal(d.det.days, 4);
  assert.equal(d.det.cost, 80);
  assert.equal(d.total, 280);
  const c = dnd(s, { ...t, combined: true, demFreeDays: 7 }, "2026-05-08");
  assert.equal(c.dem.days, 8);
  assert.equal(c.total, 100);
  assert.equal(dnd({ ...s, mode: "LTL" }, t, "2026-05-08"), null);
});

const docks = [
  { id: "d1", name: "Door 1", open: "06:00", close: "18:00", reefer: false, hazmat: false, equipment: ["CONTAINER", "TRAILER"] },
  { id: "d2", name: "Door 2", open: "06:00", close: "18:00", reefer: true, hazmat: false, equipment: [] },
];

test("appointment conflicts", () => {
  const appts = [{ id: "a", dockId: "d1", start: "2026-06-01T08:00", durationMin: 90, status: "BOOKED", carrier: "X" }];
  const probe = { id: "b", dockId: "d1", start: "2026-06-01T09:00", durationMin: 60, needsReefer: true, equipment: "VAN" };
  const msgs = conflicts(probe, appts, docks).map((i) => i.message).join("|");
  assert.match(msgs, /Overlaps X/);
  assert.match(msgs, /reefer/);
  assert.match(msgs, /not set up for van/);
  assert.equal(conflicts({ ...probe, start: "2026-06-01T09:30", needsReefer: false, equipment: "TRAILER" }, appts, docks).length, 0);
  assert.equal(conflicts({ ...probe, start: "2026-06-01T09:00", needsReefer: false, equipment: "TRAILER" }, [{ ...appts[0], status: "CANCELLED" }], docks).length, 0);
  assert.match(conflicts({ ...probe, start: "2026-06-01T17:30", needsReefer: false, equipment: "TRAILER" }, [], docks)[0].message, /Outside/);
});

test("live state, free slots and utilisation", () => {
  const a = { start: "2026-06-01T08:00", durationMin: 60, status: "BOOKED" };
  const at = (hm) => new Date(2026, 5, 1, ...hm.split(":").map(Number)).getTime();
  assert.equal(liveState(a, at("08:10")).flag, null);
  assert.equal(liveState(a, at("08:20")).flag, "LATE");
  assert.equal(liveState(a, at("09:30")).flag, "MISSED");
  const arrived = liveState({ ...a, status: "DONE", arrivedAt: "2026-06-01T08:40", doneAt: "2026-06-01T10:00" }, at("11:00"));
  assert.equal(arrived.lateMin, 40);
  assert.equal(arrived.onTime, false);
  assert.equal(arrived.dwellMin, 80);
  const appts = [{ id: "a", dockId: "d1", start: "2026-06-01T06:00", durationMin: 360, status: "BOOKED" }];
  const slots = freeSlots(appts, docks, "2026-06-01", 120, { equipment: "CONTAINER" });
  assert.equal(slots.find((s) => s.dockId === "d1").start, "2026-06-01T12:00");
  assert.equal(slots.find((s) => s.dockId === "d2").start, "2026-06-01T06:00");
  assert.ok(freeSlots(appts, docks, "2026-06-01", 60, { needsReefer: true }).every((s) => s.dockId === "d2"));
  assert.equal(utilization(appts, docks, "2026-06-01")[0].ratio, 0.5);
});

test("three-way match", () => {
  const docs = {
    PO: { lines: [{ sku: "a-1", qty: 100 }, { sku: "B2", qty: 50 }] },
    PACKING_LIST: { lines: [{ sku: "A-1", qty: 100, grossKg: 500, cartons: 10, hs: "6109.10" }, { sku: "B2", qty: 48, grossKg: 100, cartons: 2, hs: "999999" }, { sku: "C3", qty: 5 }] },
    INVOICE: { lines: [{ sku: "A-1", qty: 100, hs: "6109.90", unitPrice: 2 }, { sku: "B2", qty: 48, hs: "999999" }] },
    BOL: { header: { grossKg: 700, packages: 12, containerNo: "CSQU3054383", seal: "S1" } },
  };
  const m = matchDocuments(docs, { hsCodes: new Set(["610910", "610990"]), containerNo: "CSQU3054383", seal: "S2" });
  const codes = m.issues.map((i) => i.code);
  assert.ok(codes.includes("QTY_MISMATCH"));
  assert.ok(codes.includes("HS_MISMATCH"));
  assert.ok(codes.includes("HS_UNKNOWN"));
  assert.ok(codes.includes("MISSING_LINE"));
  assert.ok(codes.includes("WEIGHT_MISMATCH"));
  assert.ok(codes.includes("SEAL_MISMATCH"));
  assert.ok(!codes.includes("PACKAGES_MISMATCH"));
  assert.equal(m.rows.find((r) => r.sku === "A-1").po, 100);
  const clean = matchDocuments({ PO: docs.PO, PACKING_LIST: { lines: [{ sku: "A-1", qty: 100 }, { sku: "B2", qty: 50 }] } }, {});
  assert.equal(clean.counts.bad, 0);
});

test("receiving and OS&D", () => {
  const exp = expectedLines({ PO: { lines: [{ sku: "x", qty: 5 }, { sku: "X", qty: 5 }, { sku: "y", qty: 3 }] } });
  assert.equal(exp.source, "PO");
  assert.deepEqual(exp.lines.map((l) => [l.sku, l.expected]), [["X", 10], ["Y", 3]]);
  const lines = mergeReceiptLines([{ sku: "X", expected: 1, received: 8, damaged: 1, note: "" }], exp.lines);
  assert.equal(lines.length, 2);
  const o = osd(lines);
  assert.equal(o.totals.short, 2);
  assert.equal(o.totals.damaged, 1);
  assert.equal(o.uncounted, 1);
  assert.equal(o.rows[0].good, 7);
});

test("billing: pallet-days, free days, releases, minimum", () => {
  const s = { id: "s", clientId: "c", mode: "FCL", containerSize: "40HC", ref: "R1", containerNo: "CSQU3054383",
    receipt: { finalized: true, receivedAt: "2026-03-30", pallets: 10 },
    releases: [{ date: "2026-04-03", pallets: 4, ref: "OUT1" }], services: [{ date: "2026-04-02", description: "Labels", qty: 100, rate: 0.1 }] };
  // Apr 1-2: 10 each, Apr 3-30: 6 each = 20 + 168
  assert.equal(palletDays(s, "2026-04-01", "2026-04-30"), 188);
  // free 5 days from Mar 30 → charged from Apr 4: 27 days * 6
  assert.equal(palletDays(s, "2026-04-01", "2026-04-30", 5), 162);
  const client = { id: "c", rates: { handlingInPerPallet: 5, handlingOutPerPallet: 4, storagePerPalletDay: 1, freeStorageDays: 0, devanning20: 100, devanning40: 200, minMonthly: 0 } };
  const apr = buildInvoice(client, [s], "2026-04");
  assert.deepEqual(apr.lines.map((l) => l.code), ["HOUT", "STO", "VAS"]);
  assert.equal(apr.total, 16 + 188 + 10);
  const mar = buildInvoice(client, [s], "2026-03");
  assert.equal(mar.lines.find((l) => l.code === "DEV").amount, 200);
  assert.equal(mar.total, 50 + 200 + 20);
  const min = buildInvoice({ ...client, rates: { ...client.rates, minMonthly: 500 } }, [s], "2026-03");
  assert.equal(min.total, 500);
  assert.equal(buildInvoice(client, [s], "2026-04", "2026-04-02").lines.find((l) => l.code === "STO").qty, 20);
});

test("CSV import maps common headers and escapes formulas on export", () => {
  const r = importLines('Item No,Description,Qty,CTNS,Gross Weight (kg),HTS Code\nA1,"Shirt, blue",12,2,5.5,6109.10\nB2,Cap,x\n,Nothing,3\n');
  assert.deepEqual(r.lines, [{ sku: "A1", description: "Shirt, blue", qty: 12, cartons: 2, grossKg: 5.5, hs: "6109.10", unitPrice: null }]);
  assert.equal(r.errors.length, 2);
  const ok = importLines("sku,qty,hs code\nA1,\"1,200\",610910\nB2,x,\n");
  assert.deepEqual(ok.lines[0], { sku: "A1", description: "", qty: 1200, cartons: null, grossKg: null, hs: "610910", unitPrice: null });
  assert.equal(ok.errors.length, 1);
  assert.match(importLines("foo,bar\n1,2\n").errors[0], /SKU/);
  assert.equal(toCSV([["=HYPERLINK()", "a,b"]]), "'=HYPERLINK(),\"a,b\"\n");
  assert.deepEqual(parseCSV('a,"b""c"\n'), [["a", 'b"c']]);
});

test("AI request shape and response validation", () => {
  const { body, betas } = buildRequest({ mediaType: "application/pdf", base64: "AAA" }, "packing list");
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.fallbacks, "default");
  assert.deepEqual(betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(body.messages[0].content[0].type, "document");
  assert.equal(body.output_config.format.type, "json_schema");
  const haiku = buildRequest({ mediaType: "image/png", base64: "AAA" }, "invoice", "claude-haiku-5-5");
  assert.equal(haiku.body.fallbacks, undefined);
  assert.equal(haiku.body.messages[0].content[0].type, "image");
  assert.throws(() => buildRequest({ mediaType: "text/html", base64: "" }, "x"));
  const doc = parseResponse({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ docType: "EVIL", ref: 5, header: { grossKg: "9" }, lines: [{ sku: "A", qty: 3, hs: "6109" }, { qty: 1 }, "x"] }) }] });
  assert.equal(doc.docType, "OTHER");
  assert.equal(doc.ref, "");
  assert.equal(doc.header.grossKg, null);
  assert.equal(doc.lines.length, 1);
  assert.throws(() => parseResponse({ stop_reason: "refusal", content: [] }), /declined/);
  assert.throws(() => parseResponse({ content: [{ type: "text", text: "nope" }] }), /JSON/);
  assert.equal(sanitizeDoc({ lines: [{ sku: "x".repeat(500) }] }).lines[0].sku.length, 64);
});

test("exceptions feed", () => {
  const today = "2026-05-10";
  const data = {
    tariffs: [{ id: "t", demFreeDays: 3, detFreeDays: 4, demTiers: [{ fromDay: 1, rate: 100 }], detTiers: [{ fromDay: 1, rate: 50 }] }],
    shipments: [
      { id: "s1", ref: "IN-1", mode: "FCL", status: "AT_PORT", tariffId: "t", dischargeDate: "2026-05-05", containerNo: "CSQU3054383" },
      { id: "s2", ref: "IN-2", mode: "FCL", status: "AT_PORT", tariffId: "t", dischargeDate: "2026-05-09", containerNo: "MSCU0000000" },
      { id: "s3", ref: "IN-3", mode: "LTL", status: "RECEIVED", receipt: { finalized: true, receivedAt: "2026-05-09", lines: [{ sku: "A", expected: 5, received: 4, damaged: 0 }] } },
    ],
    appointments: [], claims: [], docks: [],
  };
  const ex = collectExceptions(data, { today, now: Date.now() });
  assert.equal(ex[0].severity, "high");
  assert.ok(ex.some((e) => e.title.includes("demurrage running")));
  assert.ok(ex.some((e) => e.title.includes("ends tomorrow")));
  assert.ok(ex.some((e) => e.kind === "OSD"));
  data.claims.push({ shipmentId: "s3", status: "OPEN", createdAt: today, no: "C1" });
  assert.ok(!collectExceptions(data, { today, now: Date.now() }).some((e) => e.kind === "OSD"));
});

test("monthly minimum is not billed to a client with no activity", () => {
  const inv = buildInvoice({ id: "c", rates: { minMonthly: 500 } }, [], "2026-03");
  assert.equal(inv.lines.length, 0);
  assert.equal(inv.total, 0);
});
