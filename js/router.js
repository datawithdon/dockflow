// Hash router: "#/view/arg1/arg2". Views register a render(el, args) function.

const routes = new Map();
let current = null;
let outlet = null;

export function register(name, render) { routes.set(name, render); }

export function parse() {
  const parts = (location.hash || "#/today").replace(/^#\/?/, "").split("/").map((p) => {
    try { return decodeURIComponent(p); } catch { return ""; }
  });
  return { name: routes.has(parts[0]) ? parts[0] : "today", args: parts.slice(1) };
}

export function rerender() {
  if (!outlet) return;
  const { name, args } = parse();
  current = name;
  const scrollY = window.scrollY;
  routes.get(name)(outlet, args);
  window.scrollTo(0, scrollY);
  document.dispatchEvent(new CustomEvent("routechange", { detail: { name } }));
}

export function go(hash) {
  if (location.hash === hash) rerender();
  else location.hash = hash;
}

export function start(el) {
  outlet = el;
  window.addEventListener("hashchange", () => {
    const prev = current;
    rerender();
    if (parse().name !== prev) window.scrollTo(0, 0);
  });
  rerender();
}

export const currentRoute = () => current;
