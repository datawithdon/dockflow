import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeCollections, sanitizeSettings, sanitizePhoto, isSafeImage } from "../js/engine/sanitize.js";
import { DEFAULT_SETTINGS } from "../js/state.js";
import { sampleData } from "../js/sample.js";
import { collectExceptions } from "../js/engine/exceptions.js";
import { buildInvoice } from "../js/engine/billing.js";

const hostile = JSON.parse(`{
  "docks":[{"id":"d1","name":"<svg onload=alert(1)>","open":"25:00","equipment":"notarray","__proto__":{"x":1}}],
  "clients":[{"id":"c1","name":"C","rates":"bad"},{"id":"c1","name":"dup"},{"id":"../../etc","name":"bad id"}],
  "tariffs":[{"id":"t1","demFreeDays":"x","demTiers":[{"fromDay":"2","rate":"5"},{"fromDay":-1,"rate":3},"x"],"detTiers":null}],
  "shipments":[{"id":"s1","ref":{"a":1},"clientId":"c1","mode":"ROCKET","status":"WEIRD","tariffId":"t1","dischargeDate":"2026-13-45",
    "docs":{"PO":{"lines":"notarray"},"PACKING_LIST":{"lines":[{"sku":{"x":1},"qty":"9e999"},{"sku":"A","qty":"5"}]},"INVOICE":"str","EVIL":{}},
    "receipt":{"finalized":true,"receivedAt":"bad","pallets":"5","lines":{"a":1}},"releases":"x","services":[null,1,{"date":"2026-10-01","qty":1,"rate":2}]}],
  "appointments":[{"id":"a1","start":"2026-10-24T09:00","durationMin":"60; DROP","status":"WEIRD"},{"id":"a2","start":12345}],
  "claims":[{"id":"cl","no":"<x>","amountClaimed":"lots"}],
  "invoices":[{"id":"i1","period":"2026-10","lines":"x","total":"y"},{"id":"i2","period":"nope"}]
}`);

test("hostile backup is rebuilt into safe, well-typed records", () => {
  const c = sanitizeCollections(hostile);
  assert.equal(c.docks.length, 1);
  assert.equal(c.docks[0].open, "06:00");
  assert.deepEqual(c.docks[0].equipment, []);
  assert.equal(Object.getPrototypeOf(c.docks[0]), Object.prototype);
  assert.equal(({}).x, undefined);
  assert.deepEqual(c.clients.map((x) => x.id), ["c1"]);
  assert.equal(c.clients[0].rates.storagePerPalletDay, 0);
  assert.deepEqual(c.tariffs[0].demTiers, [{ fromDay: 2, rate: 5 }]);
  const s = c.shipments[0];
  assert.equal(s.ref, "IN-?");
  assert.equal(s.mode, "FCL");
  assert.equal(s.status, "EXPECTED");
  assert.equal(s.dischargeDate, null);
  assert.deepEqual(Object.keys(s.docs), ["PO", "PACKING_LIST"]);
  assert.deepEqual(s.docs.PO.lines, []);
  assert.deepEqual(s.docs.PACKING_LIST.lines.map((l) => [l.sku, l.qty]), [["A", 5]]);
  assert.equal(s.receipt.finalized, false);
  assert.deepEqual(s.releases, []);
  assert.equal(s.services.length, 1);
  assert.deepEqual(c.appointments.map((a) => [a.id, a.durationMin, a.status]), [["a1", 60, "BOOKED"]]);
  assert.equal(c.claims[0].amountClaimed, 0);
  assert.deepEqual(c.invoices.map((i) => i.id), ["i1"]);
  assert.deepEqual(c.invoices[0].lines, []);
  // The engines run on the result without throwing.
  collectExceptions(c, { today: "2026-10-24", now: Date.now() });
  buildInvoice(c.clients[0], c.shipments, "2026-10");
});

test("settings: logo, currency and numbers are validated", () => {
  const d = DEFAULT_SETTINGS();
  const s = sanitizeSettings({ currency: "<script>", graceMin: "abc", warehouse: { name: 5, logo: "javascript:alert(1)" }, nextNo: { shipment: "x" }, __proto__: { p: 1 } }, d);
  assert.equal(s.currency, "USD");
  assert.equal(s.graceMin, 15);
  assert.equal(s.warehouse.logo, "");
  assert.equal(s.warehouse.name, "5");
  assert.equal(s.nextNo.shipment, 1);
  assert.equal(sanitizeSettings(null, d).currency, "USD");
});

test("photos: only base64 raster data URLs survive", () => {
  assert.equal(isSafeImage("data:image/svg+xml;base64,PHN2Zz4="), false);
  assert.equal(isSafeImage("javascript:alert(1)"), false);
  assert.equal(isSafeImage("data:image/png;base64,iVBORw0KGgo="), true);
  assert.equal(sanitizePhoto({ id: "p", shipmentId: "s", dataUrl: "data:image/svg+xml;base64,AA==" }), null);
  assert.equal(sanitizePhoto({ id: "p", shipmentId: "s", dataUrl: "data:image/png;base64,AA==", extra: 1 }).extra, undefined);
});

test("demo data survives sanitising unchanged in shape", () => {
  const d = sampleData(new Date(2026, 9, 24, 12));
  const c = sanitizeCollections(d);
  for (const k of Object.keys(c)) assert.equal(c[k].length, d[k].length, k);
  assert.deepEqual(c.shipments[0].docs.PO.lines, d.shipments[0].docs.PO.lines.map((l) => ({ sku: l.sku, description: l.description, qty: l.qty, cartons: null, grossKg: null, hs: "", unitPrice: l.unitPrice })));
});
