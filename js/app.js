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
  let n = 0;
  try { n = exceptionsNow().filter((e) => e.severity === "high").length; } catch { /* badge is optional */ }
  const b = $("#nav-alerts");
  b.textContent = String(n);
  b.classList.toggle("hidden", n === 0);
}

document.addEventListener("routechange", (e) => markNav(e.detail.name));

// Refuse to run inside another site's frame (clickjacking). GitHub Pages
// can't send X-Frame-Options / frame-ancestors headers, so this is done here.
if (window.top !== window.self) {
  document.body.replaceChildren(Object.assign(document.createElement("p"), {
    className: "empty", textContent: "DockFlow can't be shown inside another page. Open it directly in its own tab.",
  }));
  throw new Error("DockFlow refused to load in a frame.");
}

await loadState();
start($("#view"));

// Keep live clocks (late trucks, free time) current without a reload.
setInterval(() => {
  if (document.querySelector("dialog[open]") || document.activeElement?.matches("input, select, textarea")) return;
  rerender();
}, 60000);
