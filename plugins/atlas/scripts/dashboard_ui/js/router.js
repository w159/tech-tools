// Hash router. parseHash/buildHash/redirectOld are pure (unit-tested in router.test.js).

export const ROUTES = [
  "overview",
  "agents",
  "board",
  "channels",
  "activity",
  "health",
  "improve",
  "projects",
  "settings",
];

// Removed pages and their new owners (brief section 2).
const OLD_HASHES = {
  colony: "agents",
  terminal: "agents",
  herd: "agents",
  work: "board",
  irc: "channels",
};

/** "#/agents?agent=x&project=/a/b" -> {route, params, redirected}. Unknown routes fall back to overview. */
export function parseHash(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const q = raw.indexOf("?");
  const path = (q < 0 ? raw : raw.slice(0, q)).replace(/\/+$/, "");
  const params = {};
  if (q >= 0) {
    for (const [k, v] of new URLSearchParams(raw.slice(q + 1))) params[k] = v;
  }
  let route = path.split("/")[0] || "overview";
  let redirected = false;
  if (OLD_HASHES[route]) {
    // The terminal page's content is the drawer's Terminal tab.
    if (route === "terminal" && !params.tab) params.tab = "terminal";
    route = OLD_HASHES[route];
    redirected = true;
  }
  if (!ROUTES.includes(route)) {
    route = "overview";
    redirected = true;
  }
  return { route, params, redirected };
}

/** buildHash("agents", {agent:"x", project:""}) -> "#/agents?agent=x"; empty values are dropped. */
export function buildHash(route, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, v);
  }
  const s = qs.toString();
  return `#/${route}${s ? `?${s}` : ""}`;
}

/** Return the canonical hash when `hash` should be rewritten, else null. */
export function redirectOld(hash) {
  const { route, params, redirected } = parseHash(hash);
  if (!redirected && String(hash || "").startsWith("#/")) return null;
  return buildHash(route, params);
}

// --- Browser side (not exercised by node tests) ---

export function current() {
  return parseHash(location.hash);
}

export function navigate(route, params = {}) {
  location.hash = buildHash(route, params);
}

/** Merge `patch` into the current query (null or "" removes a key) without adding a history entry. */
export function setParams(patch, { push = false } = {}) {
  const { route, params } = current();
  const next = { ...params };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") delete next[k];
    else next[k] = v;
  }
  const target = buildHash(route, next);
  if (push) location.hash = target;
  else history.replaceState(null, "", target);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Call fn({route, params}) now and on every hash change; rewrites old hashes first. */
export function startRouter(fn) {
  const run = () => {
    const fix = redirectOld(location.hash);
    if (fix && fix !== location.hash) {
      history.replaceState(null, "", fix);
    }
    fn(current());
  };
  window.addEventListener("hashchange", run);
  run();
}

/** A render resolving late may own the page only if its route is current and its root is still attached. */
export function acceptRender(currentRoute, route, root) {
  return currentRoute === route && (!root || root.isConnected !== false);
}
