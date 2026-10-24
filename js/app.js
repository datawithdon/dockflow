// Entry point: load state, wire navigation, start the router.

import { $, $$ } from "./dom.js";
import { loadState } from "./state.js";
import { start, rerender } from "./router.js";
import { exceptionsNow } from "./views/today.js";
import "./views/today.js";
import "./views/dock.js";
import "./views/shipments.js";
import "./views/shipment.js";
import "./views/claims.js";
import "./views/billing.js";
import "./views/analytics.js";
import "./views/settings.js";

function markNav(name) {
  const section = name === "shipment" ? "shipments" : name;
  for (const a of $$(".tabs a")) {
    const on = a.dataset.view === section;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  const n = exceptionsNow().filter((e) => e.severity === "high").length;
  const b = $("#nav-alerts");
  b.textContent = String(n);
  b.classList.toggle("hidden", n === 0);
}

document.addEventListener("routechange", (e) => markNav(e.detail.name));

await loadState();
start($("#view"));

// Keep live clocks (late trucks, free time) current without a reload.
setInterval(() => {
  if (document.querySelector("dialog[open]") || document.activeElement?.matches("input, select, textarea")) return;
  rerender();
}, 60000);
