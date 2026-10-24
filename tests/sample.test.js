import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleData } from "../js/sample.js";
import { validateContainer } from "../js/engine/container.js";
import { collectExceptions } from "../js/engine/exceptions.js";
import { conflicts } from "../js/engine/schedule.js";
import { localDate } from "../js/engine/dates.js";

test("demo data is internally consistent", () => {
  const now = new Date(2026, 9, 24, 12, 0);
  const d = sampleData(now);
  for (const s of d.shipments) if (s.containerNo) assert.ok(validateContainer(s.containerNo).valid, s.containerNo);
  for (const s of d.shipments) assert.ok(d.clients.some((c) => c.id === s.clientId), s.ref);
  const live = d.appointments.filter((a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW");
  for (const a of live) {
    const bad = conflicts(a, live, d.docks).filter((i) => i.level === "bad" && !/Overlaps/.test(i.message));
    assert.deepEqual(bad, [], `${a.id} ${a.start}`);
  }
  const ex = collectExceptions(d, { today: localDate(now), now: now.getTime() });
  assert.ok(ex.length >= 5);
});
