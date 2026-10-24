// Demo data, generated relative to today so every screen has something live
// to show. All company names are fictional.

import { addDays, localDate, minToHHMM } from "./engine/dates.js";
import { checkDigit } from "./engine/container.js";
import { DEFAULT_RATES } from "./engine/billing.js";
import { DEFAULT_SETTINGS } from "./state.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const box = (owner, serial) => {
  const base = owner + "U" + String(serial).padStart(6, "0");
  return base + checkDigit(base);
};

export function sampleData(now = new Date()) {
  const T = localDate(now);
  const d = (n) => addDays(T, n);
  const rand = rng(42);
  const id = (p, n) => `${p}-${n}`;

  const docks = [
    { id: "dk1", name: "Door 1", open: "06:00", close: "22:00", reefer: false, hazmat: false, equipment: ["CONTAINER", "TRAILER"], active: true },
    { id: "dk2", name: "Door 2", open: "06:00", close: "22:00", reefer: false, hazmat: false, equipment: ["CONTAINER", "TRAILER"], active: true },
    { id: "dk3", name: "Door 3 (reefer)", open: "06:00", close: "22:00", reefer: true, hazmat: false, equipment: ["CONTAINER", "TRAILER"], active: true },
    { id: "dk4", name: "Door 4 (DG)", open: "07:00", close: "19:00", reefer: false, hazmat: true, equipment: ["CONTAINER", "TRAILER", "BOX_TRUCK"], active: true },
    { id: "dk5", name: "Door 5", open: "07:00", close: "19:00", reefer: false, hazmat: false, equipment: ["BOX_TRUCK", "VAN"], active: true },
  ];

  const clients = [
    { id: "cl1", name: "Northwind Apparel", code: "NWA", contact: "", rates: { ...DEFAULT_RATES(), storagePerPalletDay: 0.8, freeStorageDays: 3 } },
    { id: "cl2", name: "Cedar Home Goods", code: "CHG", contact: "", rates: { ...DEFAULT_RATES(), handlingInPerPallet: 7.25, handlingOutPerPallet: 7.25, minMonthly: 750 } },
    { id: "cl3", name: "Polar Fresh Foods", code: "PFF", contact: "", rates: { ...DEFAULT_RATES(), storagePerPalletDay: 1.6, devanning40: 320 } },
  ];

  const tariffs = [
    { id: "tf1", name: "Blue Anchor Line — standard dry", carrier: "Blue Anchor Line", combined: false, demFreeDays: 4, detFreeDays: 7,
      demTiers: [{ fromDay: 1, rate: 95 }, { fromDay: 5, rate: 165 }, { fromDay: 10, rate: 260 }], detTiers: [{ fromDay: 1, rate: 60 }, { fromDay: 6, rate: 110 }] },
    { id: "tf2", name: "Coral Star Shipping — combined D&D", carrier: "Coral Star Shipping", combined: true, demFreeDays: 10, detFreeDays: 0,
      demTiers: [{ fromDay: 1, rate: 120 }, { fromDay: 6, rate: 200 }], detTiers: [] },
    { id: "tf3", name: "Meridian Lines — reefer", carrier: "Meridian Lines", combined: false, demFreeDays: 3, detFreeDays: 3,
      demTiers: [{ fromDay: 1, rate: 180 }, { fromDay: 4, rate: 300 }], detTiers: [{ fromDay: 1, rate: 140 }] },
  ];

  const apparel = (n) => ({
    PO: { ref: `PO-77${n}1`, lines: [
      { sku: "NW-TEE-BLK-M", description: "Cotton t-shirt, black, M", qty: 1200, unitPrice: 2.4 },
      { sku: "NW-TEE-WHT-L", description: "Cotton t-shirt, white, L", qty: 1200, unitPrice: 2.4 },
      { sku: "NW-HOOD-GRY-M", description: "Fleece hoodie, grey, M", qty: 600, unitPrice: 8.9 },
    ] },
    PACKING_LIST: { ref: `PL-${n}48`, header: {}, lines: [
      { sku: "NW-TEE-BLK-M", description: "Cotton t-shirt, black, M", qty: 1200, cartons: 50, grossKg: 410, hs: "6109.10" },
      { sku: "NW-TEE-WHT-L", description: "Cotton t-shirt, white, L", qty: 1150, cartons: 48, grossKg: 395, hs: "6109.10" },
      { sku: "NW-HOOD-GRY-M", description: "Fleece hoodie, grey, M", qty: 600, cartons: 40, grossKg: 520, hs: "6110.20" },
    ] },
    INVOICE: { ref: `CI-2026-${n}09`, lines: [
      { sku: "NW-TEE-BLK-M", description: "Cotton t-shirt, black, M", qty: 1200, hs: "6109.10", unitPrice: 2.4 },
      { sku: "NW-TEE-WHT-L", description: "Cotton t-shirt, white, L", qty: 1200, hs: "6109.10", unitPrice: 2.4 },
      { sku: "NW-HOOD-GRY-M", description: "Fleece hoodie, grey, M", qty: 600, hs: "6110.30", unitPrice: 8.9 },
    ] },
  });

  const homeDocs = (n, pkgs) => ({
    PACKING_LIST: { ref: `CHG-PL-${n}`, header: {}, lines: [
      { sku: "CH-LAMP-01", description: "Table lamp, ceramic base", qty: 400, cartons: 100, grossKg: 1200, hs: "9405.21" },
      { sku: "CH-RUG-160", description: "Woven rug 160x230", qty: 150, cartons: pkgs - 100, grossKg: 1650, hs: "5702.42" },
    ] },
    BOL: { ref: `BAL${n}7731`, header: { grossKg: 2850, packages: pkgs, containerNo: "", seal: "" }, lines: [] },
  });

  const receipt = (lines, receivedAt, pallets, extra = {}) => ({
    lines, receivedAt, pallets, finalized: true, sealIntact: true, sealNo: extra.sealNo || "", receivedBy: "", ...extra,
  });

  const S = [];
  const ship = (o) => S.push({ releases: [], services: [], docs: {}, receipt: null, notes: "", hazmat: false, reefer: false, ...o });

  const c1 = box("BAL", 412207);
  ship({ id: id("sh", 1), ref: "IN-0001", clientId: "cl1", mode: "FCL", carrier: "Blue Anchor Line", supplier: "Lotus Garment Co.", containerNo: c1, containerSize: "40HC",
    seal: "BA4471902", eta: d(-7), dischargeDate: d(-6), gateOutDate: null, emptyReturnDate: null, tariffId: "tf1", status: "AT_PORT",
    docs: { ...apparel(1), BOL: { ref: "BAL6620031", header: { grossKg: 1325, packages: 138, containerNo: c1, seal: "BA4471902" }, lines: [] } } });

  const c2 = box("BAL", 530118);
  ship({ id: id("sh", 2), ref: "IN-0002", clientId: "cl2", mode: "FCL", carrier: "Blue Anchor Line", supplier: "Harbor Ceramics Ltd.", containerNo: c2, containerSize: "40",
    seal: "BA5530001", eta: d(-4), dischargeDate: d(-3), gateOutDate: null, emptyReturnDate: null, tariffId: "tf1", status: "AT_PORT", docs: homeDocs(2, 160) });

  const c3 = box("CSS", 778341);
  ship({ id: id("sh", 3), ref: "IN-0003", clientId: "cl1", mode: "FCL", carrier: "Coral Star Shipping", supplier: "Lotus Garment Co.", containerNo: c3, containerSize: "40HC",
    seal: "CS0098812", eta: d(-5), dischargeDate: d(-4), gateOutDate: d(0), emptyReturnDate: null, tariffId: "tf2", status: "AT_DOCK",
    docs: { PO: apparel(3).PO, PACKING_LIST: { ...apparel(3).PACKING_LIST, lines: apparel(3).PACKING_LIST.lines.map((l) => ({ ...l, qty: 1200 === l.qty || l.qty === 1150 ? 1200 : l.qty, hs: l.hs })) } } });

  const c4 = box("BAL", 600457);
  ship({ id: id("sh", 4), ref: "IN-0004", clientId: "cl2", mode: "FCL", carrier: "Blue Anchor Line", supplier: "Harbor Ceramics Ltd.", containerNo: c4, containerSize: "40",
    seal: "BA6604410", eta: d(-10), dischargeDate: d(-9), gateOutDate: d(-6), emptyReturnDate: null, tariffId: "tf1", status: "RECEIVED", docs: homeDocs(4, 160),
    receipt: receipt([
      { sku: "CH-LAMP-01", description: "Table lamp, ceramic base", expected: 400, received: 388, damaged: 14, note: "Crushed cartons, rear of container" },
      { sku: "CH-RUG-160", description: "Woven rug 160x230", expected: 150, received: 150, damaged: 0, note: "" },
    ], d(-6), 22, { sealNo: "BA6604410" }) });

  const c5 = box("CSS", 102938);
  ship({ id: id("sh", 5), ref: "IN-0005", clientId: "cl1", mode: "FCL", carrier: "Coral Star Shipping", supplier: "Lotus Garment Co.", containerNo: c5, containerSize: "20",
    seal: "CS7712033", eta: d(-24), dischargeDate: d(-23), gateOutDate: d(-20), emptyReturnDate: d(-18), tariffId: "tf2", status: "CLOSED", docs: apparel(5),
    receipt: receipt(apparel(5).PACKING_LIST.lines.map((l) => ({ sku: l.sku, description: l.description, expected: l.qty, received: l.qty, damaged: 0, note: "" })), d(-20), 14),
    releases: [{ id: "r1", date: d(-12), pallets: 6, ref: "SO-55102" }, { id: "r2", date: d(-4), pallets: 4, ref: "SO-55160" }],
    services: [{ id: "v1", date: d(-19), description: "Relabel cartons", qty: 138, rate: 0.35 }] });

  ship({ id: id("sh", 6), ref: "IN-0006", clientId: "cl2", mode: "LTL", carrier: "Prairie Freightways", supplier: "Maple Textile Mills", containerNo: "", containerSize: "",
    seal: "", eta: d(1), status: "EXPECTED" });

  ship({ id: id("sh", 7), ref: "IN-0007", clientId: "cl2", mode: "FTL", carrier: "Prairie Freightways", supplier: "Maple Textile Mills", containerNo: "", containerSize: "",
    seal: "PF220871", eta: d(-12), status: "RECEIVED",
    docs: { PACKING_LIST: { ref: "MTM-8812", header: {}, lines: [{ sku: "CH-THROW-01", description: "Knit throw blanket", qty: 900, cartons: 75, grossKg: 1100, hs: "6301.40" }] } },
    receipt: receipt([{ sku: "CH-THROW-01", description: "Knit throw blanket", expected: 900, received: 900, damaged: 0, note: "" }], d(-12), 18, { sealNo: "PF220871" }),
    releases: [{ id: "r3", date: d(-5), pallets: 8, ref: "SO-88120" }] });

  const c8 = box("MRL", 334120);
  ship({ id: id("sh", 8), ref: "IN-0008", clientId: "cl3", mode: "FCL", carrier: "Meridian Lines", supplier: "Fjord Seafood AS", containerNo: c8, containerSize: "40HC",
    seal: "ML0090233", eta: d(-2), dischargeDate: d(-1), gateOutDate: null, emptyReturnDate: null, tariffId: "tf3", status: "AT_PORT", reefer: true,
    docs: { INVOICE: { ref: "FS-INV-3301", lines: [{ sku: "PF-SALMON-5KG", description: "Frozen salmon fillets, 5 kg case", qty: 1800, hs: "0304.81", unitPrice: 41 }] } } });

  ship({ id: id("sh", 9), ref: "IN-0009", clientId: "cl3", mode: "AIR", carrier: "Skyline Cargo", supplier: "Fjord Seafood AS", containerNo: "", containerSize: "",
    seal: "", eta: d(1), status: "IN_TRANSIT", reefer: true });

  const c10 = box("BAL", 990014);
  ship({ id: id("sh", 10), ref: "IN-0010", clientId: "cl3", mode: "FCL", carrier: "Meridian Lines", supplier: "Fjord Seafood AS", containerNo: c10, containerSize: "40HC",
    seal: "ML0081120", eta: d(-38), dischargeDate: d(-37), gateOutDate: d(-33), emptyReturnDate: d(-32), tariffId: "tf3", status: "RECEIVED", reefer: true,
    receipt: receipt([{ sku: "PF-COD-10KG", description: "Frozen cod loins, 10 kg case", expected: 1500, received: 1500, damaged: 0, note: "" }], d(-33), 20),
    releases: [{ id: "r4", date: d(-25), pallets: 5, ref: "SO-1201" }, { id: "r5", date: d(-14), pallets: 5, ref: "SO-1250" }, { id: "r6", date: d(-3), pallets: 4, ref: "SO-1302" }] });

  ship({ id: id("sh", 11), ref: "IN-0011", clientId: "cl1", mode: "LTL", carrier: "Lakeshore Express", supplier: "Lotus Garment Co.", containerNo: "", containerSize: "",
    seal: "", eta: d(-2), status: "IN_TRANSIT" });

  // ---------------------------------------------------------- appointments
  const appts = [];
  const nowMin = Math.min(19 * 60, Math.max(9 * 60, now.getHours() * 60 + now.getMinutes()));
  const slot = (offset) => minToHHMM(Math.round((nowMin + offset) / 30) * 30);
  const appt = (o) => appts.push({ id: `ap-${appts.length + 1}`, direction: "IN", equipment: "CONTAINER", needsReefer: false, hazmat: false, notes: "", arrivedAt: null, doneAt: null, ...o });
  const at = (date, hm) => `${date}T${hm}`;
  const plus = (hm, m) => { const [h, mm] = hm.split(":").map(Number); return minToHHMM(Math.min(23 * 60 + 59, h * 60 + mm + m)); };

  appt({ dockId: "dk1", shipmentId: "sh-3", carrier: "Coral Star Shipping", start: at(T, slot(-180)), durationMin: 120, status: "DONE", arrivedAt: at(T, plus(slot(-180), 5)), doneAt: at(T, plus(slot(-180), 110)) });
  appt({ dockId: "dk2", carrier: "Prairie Freightways", equipment: "TRAILER", start: at(T, slot(-120)), durationMin: 90, status: "UNLOADING", arrivedAt: at(T, plus(slot(-120), 35)) });
  appt({ dockId: "dk5", carrier: "Lakeshore Express", equipment: "BOX_TRUCK", shipmentId: "sh-11", start: at(T, slot(-90)), durationMin: 45, status: "BOOKED" });
  appt({ dockId: "dk1", carrier: "Harbor Drayage", start: at(T, slot(-30)), durationMin: 90, status: "BOOKED", notes: "Driver called: stuck at terminal gate" });
  appt({ dockId: "dk3", shipmentId: "sh-8", carrier: "Meridian Lines", needsReefer: true, start: at(T, slot(60)), durationMin: 120, status: "BOOKED" });
  appt({ dockId: "dk2", shipmentId: "sh-1", carrier: "Blue Anchor Line", start: at(T, slot(90)), durationMin: 120, status: "BOOKED" });
  appt({ dockId: "dk4", carrier: "Prairie Freightways", direction: "OUT", equipment: "TRAILER", start: at(T, slot(120)), durationMin: 60, status: "BOOKED" });
  appt({ dockId: "dk5", shipmentId: "sh-6", carrier: "Prairie Freightways", equipment: "BOX_TRUCK", start: at(d(1), "09:00"), durationMin: 60, status: "BOOKED" });
  appt({ dockId: "dk3", shipmentId: "sh-9", carrier: "Skyline Cargo", equipment: "VAN", needsReefer: true, start: at(d(1), "11:00"), durationMin: 45, status: "BOOKED" });
  appt({ dockId: "dk1", shipmentId: "sh-2", carrier: "Blue Anchor Line", start: at(d(1), "08:00"), durationMin: 120, status: "BOOKED" });

  // History for analytics: 30 days of finished inbound appointments.
  const carriers = [["Blue Anchor Line", 0.82], ["Coral Star Shipping", 0.7], ["Prairie Freightways", 0.9], ["Lakeshore Express", 0.6], ["Meridian Lines", 0.85], ["Harbor Drayage", 0.55]];
  for (let k = 30; k >= 1; k--) {
    const date = d(-k);
    const dow = new Date(date + "T00:00:00Z").getUTCDay();
    if (dow === 0) continue;
    const n = dow === 6 ? 2 : 4 + Math.floor(rand() * 4);
    for (let j = 0; j < n; j++) {
      const [carrier, reliability] = carriers[Math.floor(rand() * carriers.length)];
      const dock = docks[Math.floor(rand() * 4)];
      const start = minToHHMM(7 * 60 + j * 120 + Math.floor(rand() * 2) * 30);
      const dur = [60, 90, 120][Math.floor(rand() * 3)];
      if (rand() > 0.95) { appt({ dockId: dock.id, carrier, start: at(date, start), durationMin: dur, status: "NO_SHOW" }); continue; }
      const late = rand() < reliability ? Math.floor(rand() * 15) - 5 : 20 + Math.floor(rand() * 90);
      const arr = plus(start, late);
      appt({ dockId: dock.id, carrier, start: at(date, start), durationMin: dur, status: "DONE", arrivedAt: at(date, arr), doneAt: at(date, plus(arr, dur - 10 + Math.floor(rand() * 40))) });
    }
  }

  const claims = [];
  const invoices = [];
  const settings = { ...DEFAULT_SETTINGS(), warehouse: { name: "Riverside Logistics DC", address: "100 Example Way\nSpringfield", phone: "", email: "", logo: "" },
    nextNo: { shipment: 12, claim: 1, invoice: 1 } };
  return { settings, docks, clients, tariffs, shipments: S, appointments: appts, claims, invoices };
}
