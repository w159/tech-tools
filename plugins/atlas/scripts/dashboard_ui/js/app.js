// Atlas Command Center boot: one shell (rail with live herdr tree, top bar, canvas, inspector), router with
// route aliases, prefs, command palette, keyboard map, honest degraded states, framed fallback.

import { h, icon, clear, replace, debounce } from "./dom.js";
import { api, ApiError, setHiddenRoots } from "./api.js";
import { toast, toastError, Modal, openModal, closeModal, hasOpenModal, closeDrawer, hasOpenDrawer, openPopover, closePopover, hasOpenPopover, openPalette, closePalette, isPaletteOpen, State, DegradedState, Button, Input, Select, HexGlyph, Keycap } from "./components.js";
import { FleetStrip, RailTree, openAgentInspector, closeAgentInspector } from "./fleet.js";
import { agentsStore, STATE_WORD } from "./agents-store.js";
import overview from "./pages/overview.js";
import work from "./pages/work.js";
import { openEditor } from "./integrations.js";
import { openNewThread } from "./hp.js";
import { normalizeNav, orderGroups, MOBILE_TABS } from "./nav-order.js";

// ---- store ----------------------------------------------------------------

function createStore(initial) {
  const data = new Map(Object.entries(initial || {}));
  const subs = new Map();
  return {
    get: (k) => data.get(k),
    set(k, v) {
      data.set(k, v);
      for (const fn of subs.get(k) || []) fn(v);
    },
    subscribe(k, fn) {
      if (!subs.has(k)) subs.set(k, new Set());
      subs.get(k).add(fn);
      return () => subs.get(k).delete(fn);
    },
  };
}

const store = createStore({ project: "all", prefs: {}, projects: [], attention: [], version: "" });
const FRAMED = document.documentElement.getAttribute("data-shell") === "framed";
const LOCAL_KEY = "atlas.dashboard.prefs";
const RAIL_KEY = "atlas.rail";
const RECENT_KEY = "atlas.recent";

// ---- navigation model (MASTER 8) -------------------------------------------------

const GROUPS = [
  { id: "observe", label: "Observe", items: [{ page: "overview" }, { page: "activity" }, { page: "health" }] },
  { id: "operate", label: "Operate", items: [{ page: "agents", label: "Agents" }, { page: "colony", label: "Colony", icon: "herd" }, { page: "channels", label: "Channels", icon: "irc" }], tree: true },
  { id: "improve", label: "Improve", items: [{ page: "improve" }] },
  { id: "configure", label: "Configure", items: [{ page: "projects" }, { page: "settings" }] },
];
const LABELS = { overview: "Overview", agents: "Agents", activity: "Activity", health: "Health", improve: "Improve", projects: "Projects", settings: "Settings", colony: "Colony", channels: "Channels", terminal: "Terminal" };
const ICON_FOR = { overview: "overview", agents: "agents", activity: "activity", health: "heart-pulse", improve: "sparkles", projects: "folder", settings: "settings", colony: "herd", channels: "irc", terminal: "herd" };
const CHORDS = { o: "overview", a: "agents", l: "activity", h: "health", i: "improve", p: "projects", ",": "settings", d: "agents", s: "improve", w: "agents?lens=board", c: "colony", n: "channels", u: "agents?lens=supervision" };
// Old ids keep working: redirect to the canonical page with a lens, keeping the query.
const ALIASES = { herd: "terminal", work: "agents?lens=board", irc: "channels", channel: "channels", console: "terminal", herdr: "terminal" };

const pages = new Map();
for (const p of [overview]) pages.set(p.id, p);
// The legacy pages stay mounted as lens content until their rebuilds land (js/pages/agents.js reads them from here).
export const legacyPages = { work };

async function loadExternalPage(id) {
  try {
    const mod = await import("./pages/" + (id === "terminal" ? "herdr" : id) + ".js"); // Terminal is the herdr frame page
    if (mod && mod.default) pages.set(id, mod.default);
    return null;
  } catch (err) {
    return err;
  }
}

const importErrors = new Map();
async function loadExternalPages() {
  const ids = ["agents", "activity", "health", "colony", "channels", "terminal", "improve", "projects", "settings"];
  const errs = await Promise.all(ids.map((id) => loadExternalPage(id)));
  ids.forEach((id, i) => errs[i] && importErrors.set(id, errs[i]));
}

// A route with no module: helpful state, never "not available in this build".
function missingPage(id, known) {
  const label = LABELS[id] || id;
  const err = importErrors.get(id);
  return {
    id,
    title: label,
    async load() {
      return null;
    },
    render(ctx) {
      const body = known
        ? State({ variant: "error", title: label + " didn't load", error: { error: err ? String(err.message || err) : "module_missing", why: "The page script could not be loaded.", do: "Reload the page. If it keeps failing, reinstall the atlas plugin." }, onRetry: () => location.reload() })
        : State({ variant: "empty", title: "No page called " + id, body: "That address doesn't match anything in the Command Center.", action: Button({ label: "Go to Overview", variant: "primary", onClick: () => ctx.navigate("overview") }), secondary: Button({ label: "Open the palette", onClick: () => openAppPalette() }) });
      return h("div", { class: "page" }, h("h1", null, label), body);
    },
  };
}

// ---- routing --------------------------------------------------------------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = raw.split("?");
  const [pageId, anchor] = (pathPart || "").split("#");
  const params = {};
  new URLSearchParams(queryPart || "").forEach((v, k) => {
    params[k] = v;
  });
  return { id: pageId || "overview", anchor: anchor || "", params };
}

function hashFor(id, params, anchor) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const text = qs.toString();
  return "#/" + id + (anchor ? "#" + anchor : "") + (text ? "?" + text : "");
}

export function navigate(target, params) {
  let id = String(target);
  let anchor = "";
  let inline = {};
  if (id.includes("?")) {
    const [a, q] = id.split("?");
    id = a;
    new URLSearchParams(q).forEach((v, k) => (inline[k] = v));
  }
  if (id.includes("#")) [id, anchor] = id.split("#");
  location.hash = hashFor(id, { ...inline, ...(params || {}) }, anchor);
}

// Change hash params without re-rendering the page (inspector open/tab/close).
function setParams(patch) {
  const { id, anchor, params } = parseHash();
  const next = { ...params, ...patch };
  for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined || next[k] === "") delete next[k];
  history.replaceState(null, "", hashFor(id, next, anchor));
  if (current) current.ctx.params = next;
}

let current = null; // { page, ctx, key }
let navToken = 0;
const PAGE_KEY_IGNORE = new Set(["agent", "tab"]);

function pageKey(id, params) {
  return id + "?" + Object.keys(params).filter((k) => !PAGE_KEY_IGNORE.has(k)).sort().map((k) => k + "=" + params[k]).join("&");
}

function makeCtx(params) {
  return {
    api,
    store,
    agents: agentsStore,
    navigate,
    toast,
    openDrawer: (node) => import("./components.js").then((m) => m.openDrawer(node)),
    closeDrawer,
    openAgent,
    setParams,
    project: store.get("project"),
    prefs: store.get("prefs"),
    setProject,
    params: params || {},
  };
}

async function route() {
  let { id, anchor, params } = parseHash();
  const lensRoute = id === "agents" && { console: "terminal", colony: "terminal", channel: "channels" }[params.lens];
  if (lensRoute) { // old Agents lenses became their own routes
    const { lens: _l, view: _v, ...rest } = params;
    history.replaceState(null, "", hashFor(lensRoute, rest, anchor));
    ({ id, anchor, params } = parseHash());
  }
  if (ALIASES[id]) {
    const [pid, q] = ALIASES[id].split("?");
    const merged = { ...Object.fromEntries(new URLSearchParams(q)), ...params };
    history.replaceState(null, "", hashFor(pid, merged, anchor));
    ({ id, anchor, params } = parseHash());
  }
  const key = pageKey(id, params);
  if (current && current.key === key && current.rendered) {
    current.ctx.params = params;
    syncInspector(params);
    return;
  }
  const page = pages.get(id) || missingPage(id, Boolean(LABELS[id]));
  const token = ++navToken;
  if (current && current.page.destroy) {
    try {
      current.page.destroy();
    } catch (_err) {
      // page cleanup must never block navigation
    }
  }
  closeDrawer();
  closePopover();
  const rootEl = document.getElementById("page-root");
  const ctx = makeCtx(params);
  current = { page, ctx, key, rendered: false };
  markNav(id, params.lens);
  setTitle(page.title || LABELS[id] || id);
  replace(rootEl, State({ variant: "loading", label: (page.title || id).toLowerCase(), shape: id === "overview" ? "kpi" : "rows", onTimeout: () => {}, onRetry: route }));
  let data = null;
  try {
    data = await page.load(ctx);
  } catch (err) {
    if (token !== navToken) return;
    replace(rootEl, errorView(page, err));
    return;
  }
  if (token !== navToken) return;
  try {
    const node = page.render(ctx, data);
    replace(rootEl, node);
    current.rendered = true;
    if (anchor) {
      const target = document.getElementById(anchor);
      if (target) target.scrollIntoView({ block: "start" });
    }
  } catch (err) {
    replace(rootEl, errorView(page, err));
    return;
  }
  const main = document.getElementById("main");
  if (main && !anchor) main.scrollTop = 0;
  syncInspector(params);
}

function errorView(page, err) {
  if (err instanceof ApiError && err.status === 0) return DegradedState({ layer: "daemon", reason: err.error, onRecheck: () => recheckDaemon() });
  const e = err instanceof ApiError ? err : { error: (err && err.message) || "Something went wrong", why: "", do: "Reload the page." };
  return h("div", { class: "page" }, h("h1", null, page.title || page.id), State({ variant: "error", error: e, onRetry: () => { current = null; route(); } }));
}

async function recheckDaemon() {
  const p = await api.probe();
  if (p.up) {
    current = null;
    await agentsStore.refresh();
    route();
  } else toast("Atlas still isn't responding", { kind: "warn" });
}

// ---- inspector sync (hash params agent= tab=) ------------------------------------------

let waitingFor = null;
function syncInspector(params) {
  const ref = params.agent;
  if (!ref) {
    waitingFor = null;
    if (hasOpenAgentInspector()) closeAgentInspector();
    return;
  }
  const rec = agentsStore.find(ref);
  if (!rec) {
    waitingFor = ref; // resolved by the store subscription once agents load
    return;
  }
  waitingFor = null;
  openAgentInspector(rec, { tab: params.tab, onTab: (t) => setParams({ tab: t }), onClose: () => { if (parseHash().params.agent) setParams({ agent: null, tab: null }); } });
}
const hasOpenAgentInspector = () => hasOpenDrawer();

// Open an agent in the inspector (and optionally its Terminal tab): the one entry point for rows, cards, strip, palette.
export function openAgent(ref, opts) {
  const rec = typeof ref === "string" ? agentsStore.find(ref) : ref;
  if (!rec) return;
  const tab = (opts && opts.tab) || undefined;
  setParams({ agent: rec.key, tab: tab || null });
  syncInspector(parseHash().params);
  if (tab && hasOpenDrawer()) {
    /* tab applied by openAgentInspector or setTab */
  }
}

// ---- chrome: nav -------------------------------------------------------------------------

function markNav(activeId, lens) {
  document.querySelectorAll("#nav .nav-link, #tabbar a").forEach((a) => {
    const on = a.dataset.page === activeId && (!a.dataset.lens || a.dataset.lens === (lens || "fleet"));
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function navHref(it) {
  return "#/" + it.page + (it.lens ? "?lens=" + it.lens : "");
}

function navCounts(st) {
  const c = st.counts;
  const bits = [];
  for (const k of ["input", "fail", "working"]) if (c[k]) bits.push(h("span", { class: "nav-count", title: c[k] + " " + STATE_WORD[k].toLowerCase() }, HexGlyph(k, { size: "mini" }), String(c[k])));
  return bits.length ? h("span", { class: "nav-badges" }, bits) : null;
}

function buildNav() {
  const nav = clear(document.getElementById("nav"));
  const st = agentsStore.getState();
  for (const group of orderGroups(GROUPS, (store.get("prefs") || {}).nav_order)) {
    nav.appendChild(
      h("div", { class: "nav-group", role: "group", "aria-labelledby": "nav-" + group.id }, h("div", { class: "nav-title", id: "nav-" + group.id }, group.label), group.items.map((it) => {
        const label = it.label || LABELS[it.page];
        const a = h("a", { class: "nav-link", href: navHref(it), "data-page": it.page, title: label }, icon(it.icon || ICON_FOR[it.page]), h("span", null, label), it.page === "agents" ? navCounts(st) : null);
        if (it.page === "agents") a.addEventListener("click", flyoutIfCollapsed);
        return a;
      }))
    );
  }
  const p = parseHash();
  markNav(ALIASES[p.id] ? ALIASES[p.id].split("?")[0] : p.id, p.params.lens);
}

const isMobile = () => window.matchMedia("(max-width: 767px)").matches;
const railCollapsed = () => {
  const a = document.documentElement.getAttribute("data-rail");
  return a === "collapsed" || (innerWidth < 1280 && a !== "expanded");
};

function setRail(collapsed) {
  const v = collapsed ? "collapsed" : "expanded";
  document.documentElement.setAttribute("data-rail", v);
  try {
    localStorage.setItem(RAIL_KEY, v);
  } catch (_err) {
    // private mode
  }
  buildRailToggle();
}
const toggleRail = () => setRail(!railCollapsed());

function buildRailToggle() {
  const host = clear(document.getElementById("rail-toggle-host"));
  host.appendChild(h("button", { class: "btn btn-ghost btn-icon", type: "button", id: "rail-toggle", "aria-label": railCollapsed() ? "Expand navigation" : "Collapse navigation", "aria-expanded": railCollapsed() ? "false" : "true", title: "Collapse or expand (\u005b \u005d)", onClick: toggleRail }, icon("panel-left")));
}

// At 768 the rail is icons only; the Agents icon opens the live tree as a flyout.
function flyoutIfCollapsed(e) {
  if (isMobile() || !railCollapsed()) return;
  e.preventDefault();
  const a = e.currentTarget;
  const tree = RailTree({ onSelect: (rec, o) => { closePopover(); openAgent(rec, { tab: o && o.terminal ? "terminal" : undefined }); }, onRecheck: () => agentsStore.recheck() });
  tree.update(agentsStore.getState(), parseHash().params.agent);
  openPopover(a, h("div", { class: "flyout" }, h("a", { href: "#/agents?lens=fleet", class: "menu-item", onClick: () => closePopover() }, icon("agents"), "Open Agents"), tree), { label: "Agents", placement: "start" });
}

// ---- project switcher ---------------------------------------------------------------------

function buildSwitcher() {
  const prefs = store.get("prefs") || {};
  const hidden = new Set(prefs.hidden_projects || []);
  const pinned = new Set(prefs.pinned_projects || []);
  const selected = store.get("project");
  const projects = (store.get("projects") || []).filter((p) => !hidden.has(p.root) || p.root === selected).sort((a, b) => pinned.has(b.root) - pinned.has(a.root));
  const make = (id) => {
    const select = h("select", { class: "select", id, "aria-label": "Project", style: { width: "100%" }, onChange: (e) => setProject(e.target.value, true) }, h("option", { value: "all" }, "All projects"), projects.map((p) => h("option", { value: p.root }, (pinned.has(p.root) ? "\u2605 " : "") + (p.name || p.root))));
    select.value = selected;
    if (select.value !== selected) select.value = "all";
    return select;
  };
  clear(document.getElementById("project-switcher")).appendChild(h("div", { class: "field" }, h("label", { for: "project-select" }, "Project"), make("project-select")));
  clear(document.getElementById("mobile-project")).appendChild(make("project-select-m"));
}

let appliedKey = "";
let navKey = "";
function applyPrefs() {
  const prefs = store.get("prefs") || {};
  const nk = JSON.stringify(normalizeNav(prefs.nav_order));
  if (nk !== navKey) {
    navKey = nk;
    if (document.getElementById("nav")) { buildNav(); buildNavTabbar(); }
  }
  setHiddenRoots(prefs.hidden_projects);
  const key = JSON.stringify([prefs.hidden_projects, prefs.pinned_projects, store.get("projects").length, store.get("project")]);
  if (key !== appliedKey) {
    appliedKey = key;
    buildSwitcher();
  }
  agentsStore.setPollMs(refreshMs());
}
const refreshMs = () => ((store.get("prefs") || {}).refresh_seconds || 8) * 1000;

function setProject(project, persist) {
  store.set("project", project || "all");
  if (persist) savePrefs({ default_project: store.get("project") });
  appliedKey = "";
  applyPrefs();
  agentsStore.start({ project: store.get("project"), pollMs: refreshMs() });
  current = null;
  route();
  refreshAttention();
}

// ---- top bar: palette, strip, version, live pill, attention, toggles -----------------------------

let strip = null;
function buildTopbar() {
  const host = clear(document.getElementById("palette-host"));
  host.appendChild(h("button", { class: "btn palette-btn", id: "open-palette", type: "button", "aria-keyshortcuts": "Control+K Meta+K /", "aria-label": "Search or jump to", onClick: () => openAppPalette() }, icon("search"), h("span", null, "Search or jump to"), Keycap("/")));
  const mb = document.querySelector(".mobile-brand");
  if (mb) mb.removeAttribute("style");
  strip = FleetStrip({ agents: [], onOpen: (rec) => openAgent(rec) });
  placeStrip();
  window.matchMedia("(max-width: 767px)").addEventListener("change", placeStrip);
}

function placeStrip() {
  const target = document.getElementById(isMobile() && !FRAMED ? "strip-band" : "strip-host");
  if (strip && strip.parentNode !== target) target.appendChild(strip);
  buildNavTabbar();
  buildRailToggle();
}

function buildLive(st) {
  const host = clear(document.getElementById("live"));
  let mode = st.conn;
  let text = "";
  if (st.layers.daemon.state === "down") { mode = "offline"; text = "Offline"; }
  else if (mode === "live") text = "Live";
  else if (mode === "poll") text = "Polling " + refreshMs() / 1000 + "s";
  else if (mode === "reconnecting") text = "Reconnecting";
  else return;
  host.appendChild(
    h("span", { class: "live-pill", "data-mode": mode }, h("span", { class: "live-dot", "aria-hidden": "true" }), h("span", { class: "live-text" }, text), mode === "offline" ? h("button", { class: "btn btn-ghost btn-sm", type: "button", onClick: () => recheckDaemon() }, "Retry") : null)
  );
}

let lastNeeds = 0;
function attentionData() {
  const st = agentsStore.getState();
  const needs = st.agents.filter((a) => a.state === "input");
  const failed = st.agents.filter((a) => a.state === "fail");
  const items = (store.get("attention") || []).filter((i) => i.severity === "fail" || i.severity === "warn");
  return { needs, failed, items, count: needs.length + failed.length + items.length, itemsFail: items.some((i) => i.severity === "fail") };
}

// Agents waiting on a person and doctor findings are different things: separate pills, separate colors and targets.
function buildAttention() {
  const host = clear(document.getElementById("attention"));
  const d = attentionData();
  const pill = (level, count, word, onClick, extra) => h("button", { class: "attn", type: "button", "data-level": level, ...(extra || {}), "aria-label": count + " " + word, "aria-haspopup": "dialog", onClick: (e) => onClick(e.currentTarget) }, level === "findings" ? icon("alert") : HexGlyph(level, { size: "mini" }), h("span", null, h("span", { class: "num" }, String(count)), h("span", { class: "attn-text" }, " " + word)));
  const pills = [];
  if (d.needs.length) pills.push(pill("input", d.needs.length, "need input", (b) => openAttention(b, "agents")));
  if (d.failed.length) pills.push(pill("fail", d.failed.length, "failed", (b) => openAttention(b, "failed")));
  if (d.items.length) pills.push(pill("findings", d.items.length, d.items.length === 1 ? "attention item" : "attention items", (b) => openAttention(b, "findings"), { "data-sev": d.itemsFail ? "fail" : "warn" }));
  if (!pills.length) pills.push(h("button", { class: "attn", type: "button", "data-level": "ok", "aria-label": "All clear", onClick: (e) => openAttention(e.currentTarget, "agents") }, icon("check"), h("span", { class: "attn-text" }, "All clear")));
  host.appendChild(h("div", { class: "attn-group" }, pills));
  if (d.needs.length > lastNeeds) announce(d.needs.length + (d.needs.length === 1 ? " agent needs" : " agents need") + " input");
  lastNeeds = d.needs.length;
  const n = d.needs.length;
  setTitle(null, n);
  if (FRAMED) postUp("atlas:attention", { count: d.count, needInput: n, level: d.failed.length || d.itemsFail ? "fail" : n ? "input" : "ok" });
}

function openAttention(anchor, kind) {
  const d = attentionData();
  const agentRow = (a, tone) => h("button", { class: "attn-pop-row", type: "button", onClick: () => { closePopover(); openAgent(a); } }, HexGlyph(tone, { size: "mini" }), h("span", { class: "grow truncate" }, a.title), h("span", { class: "sub" }, a.workspace || ""));
  const itemRow = (i) => h("button", { class: "attn-pop-row", type: "button", onClick: () => { closePopover(); if (i.action && i.action.target) navigate(i.action.target); else navigate("overview#attention"); } }, HexGlyph(i.severity === "fail" ? "fail" : "unknown", { size: "mini" }), h("span", { class: "grow truncate" }, i.title || i.detail || "Attention item"), h("span", { class: "sub" }, i.action && i.action.label ? i.action.label : ""));
  let rows;
  if (kind === "findings") rows = [h("h4", null, "Needs attention"), ...d.items.map(itemRow), h("button", { class: "attn-pop-row", type: "button", onClick: () => { closePopover(); navigate("overview#attention"); } }, h("span", { class: "grow" }, "Open Needs attention on Overview"))];
  else if (kind === "failed") rows = [h("h4", null, "Failed agents"), ...d.failed.map((a) => agentRow(a, "fail"))];
  else rows = [...(d.needs.length ? [h("h4", null, "Agents waiting for you"), ...d.needs.map((a) => agentRow(a, "input"))] : [])];
  openPopover(anchor, h("div", { class: "attn-pop" }, rows.length ? rows : h("p", { class: "attn-pop-empty" }, "No agent is waiting for you.")), { label: kind === "findings" ? "Needs attention" : kind === "failed" ? "Failed agents" : "Needs input", placement: "end" });
}

function announce(text) {
  let el = document.getElementById("announce");
  if (!el) {
    el = h("div", { id: "announce", class: "sr-only", role: "status", "aria-live": "polite" });
    document.body.appendChild(el);
  }
  el.textContent = text;
}

async function refreshAttention() {
  try {
    const data = await api.get("overview", { project: store.get("project"), window: "7d" });
    store.set("attention", Array.isArray(data.attention) ? data.attention : []);
  } catch (_err) {
    // the overview page shows the error; the pill keeps its last value
  }
}
const refreshAttentionSoon = debounce(refreshAttention, 1500);

function effectiveTheme() {
  const t = (store.get("prefs") || {}).theme || "dark";
  if (t === "system") return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  return t;
}

function buildToggles() {
  const host = clear(document.getElementById("toggles"));
  const theme = effectiveTheme();
  const density = (store.get("prefs") || {}).density || "comfortable";
  host.append(
    h("button", { class: "btn btn-ghost btn-icon btn-theme", type: "button", id: "toggle-theme", "aria-label": "Switch to " + (theme === "dark" ? "light" : "dark") + " theme", title: "Theme (Shift+D)", onClick: toggleTheme }, icon(theme === "dark" ? "sun" : "moon")),
    h("button", { class: "btn btn-ghost btn-icon btn-density", type: "button", id: "toggle-density", "aria-label": "Use " + (density === "compact" ? "comfortable" : "compact") + " density", "aria-pressed": density === "compact" ? "true" : "false", title: "Density (D)", onClick: toggleDensity }, icon("rows"))
  );
}

function applyTheme() {
  const prefs = store.get("prefs") || {};
  const q = new URLSearchParams(location.search);
  const root = document.documentElement;
  root.setAttribute("data-theme", q.get("theme") || prefs.theme || "dark");
  root.setAttribute("data-density", q.get("density") || prefs.density || "comfortable");
  buildToggles();
}
const toggleTheme = () => savePrefs({ theme: effectiveTheme() === "dark" ? "light" : "dark" });
const toggleDensity = () => savePrefs({ density: (store.get("prefs") || {}).density === "compact" ? "comfortable" : "compact" });

function loadLocalPrefs() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}") || {};
  } catch (_err) {
    return {};
  }
}

async function savePrefs(patch) {
  const next = Object.assign({}, store.get("prefs"), patch);
  store.set("prefs", next);
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ theme: next.theme, density: next.density, default_project: next.default_project }));
  } catch (_err) {
    // private mode: server prefs still apply
  }
  applyTheme();
  try {
    const saved = await api.put("prefs", patch);
    if (saved && saved.prefs) store.set("prefs", Object.assign({}, next, saved.prefs));
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) toastError(err, "Could not save preferences");
  }
}

// ---- document title and framed messaging --------------------------------------------------------------

let pageTitle = "Overview";
function setTitle(title, needs) {
  if (title) pageTitle = title;
  const n = needs === undefined ? agentsStore.getState().agents.filter((a) => a.state === "input").length : needs;
  const base = pageTitle + " | Atlas Command Center";
  document.title = (n ? "(" + n + ") " : "") + base;
  const ctxTitle = document.getElementById("ctx-title");
  if (ctxTitle) ctxTitle.textContent = pageTitle;
  if (FRAMED && title) postUp("atlas:title", { title: document.title });
}

function parentOrigin() {
  try {
    if (location.ancestorOrigins && location.ancestorOrigins.length) return location.ancestorOrigins[0];
    if (document.referrer) return new URL(document.referrer).origin;
  } catch (_err) {
    // fall through
  }
  return "*";
}
function postUp(type, payload) {
  if (window.parent === window) return;
  try {
    window.parent.postMessage({ type, ...payload }, parentOrigin());
  } catch (_err) {
    // a host that dislikes the message must not break the page
  }
}
window.addEventListener("message", (e) => {
  if (e.source !== window.parent || !e.data || typeof e.data !== "object") return;
  if (e.data.type === "atlas:theme") {
    const root = document.documentElement;
    if (["dark", "light", "system"].includes(e.data.theme)) root.setAttribute("data-theme", e.data.theme);
    if (["compact", "comfortable"].includes(e.data.density)) root.setAttribute("data-density", e.data.density);
    buildToggles();
  }
});
// The herdr host (same origin through the gateway) and the console frame report panes: a notification click selects a
// pane, the console reports its selection and attention. Anything else is ignored.
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || typeof d !== "object") return;
  const frame = document.querySelector("iframe.console-frame");
  if (e.origin !== location.origin && !(frame && e.source === frame.contentWindow)) return;
  const pane = typeof d.pane_id === "string" ? d.pane_id : typeof d.paneId === "string" ? d.paneId : "";
  if (d.type === "select-pane" && pane) navigate("terminal", { pane });
  else if (d.type === "herdr:selected-pane" && pane && parseHash().id === "terminal") import("./pages/herdr.js").then((m) => { m.noteFramePane(pane); setParams({ pane }); });
  else if (d.type === "herdr:attention") agentsStore.refresh(["herd"]);
});

// ---- mobile bottom tab bar ----------------------------------------------------------------------------------

const TABS = MOBILE_TABS;
function buildNavTabbar() {
  const bar = clear(document.getElementById("tabbar"));
  const ordered = normalizeNav((store.get("prefs") || {}).nav_order).map((id) => TABS.find((t) => t[0] === id)).filter(Boolean);
  for (const [id, label, href] of ordered.slice(0, 4)) bar.appendChild(h("a", { href: href || "#/" + id, "data-page": id }, icon(ICON_FOR[id]), h("span", null, label)));
  const more = h("button", { type: "button", "aria-haspopup": "menu", onClick: () => {
    const list = h("div", { class: "menu" }, ordered.slice(4).map(([id, label, href]) => h("a", { class: "menu-item", href: href || "#/" + id, onClick: () => closePopover() }, icon(ICON_FOR[id]), label)), h("div", { class: "field", style: { padding: "var(--s-2) var(--s-3)" } }, h("label", { for: "project-select-sheet" }, "Project"), Select({ options: [{ value: "all", label: "All projects" }, ...(store.get("projects") || []).map((p) => ({ value: p.root, label: p.name || p.root }))], value: store.get("project"), id: "project-select-sheet", onChange: (v) => { closePopover(); setProject(v, true); } })));
    openPopover(more, list, { label: "More", placement: "end" });
  } }, icon("menu"), h("span", null, "More"));
  bar.appendChild(more);
  const p = parseHash();
  markNav(ALIASES[p.id] ? ALIASES[p.id].split("?")[0] : p.id, p.params.lens);
}

// ---- command palette ------------------------------------------------------------------------------------------

function recent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch (_err) {
    return [];
  }
}
function remember(id) {
  if (!id) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recent().filter((x) => x !== id)].slice(0, 8)));
  } catch (_err) {
    // private mode
  }
}

function launchAgent() {
  const projects = store.get("projects") || [];
  const name = Input({ label: "Name", placeholder: "fix-login-bug", hint: "Lowercase words joined by dashes." });
  const prompt = Input({ label: "Prompt", multiline: true, placeholder: "What should it do?" });
  const harness = Select({ label: "Harness", options: [{ value: "omp", label: "omp" }, { value: "claude", label: "Claude Code" }], value: "omp" });
  const proj = Select({ label: "Project", options: projects.map((p) => ({ value: p.root, label: p.name || p.root })), value: store.get("project") !== "all" ? store.get("project") : projects[0] && projects[0].root });
  const msg = h("div", { class: "field-msg", role: "alert", hidden: true });
  const go = Button({ label: "Launch", variant: "primary", onClick: async () => {
    msg.hidden = true;
    try {
      await api.post("herd/panes", { name: name.querySelector("input").value.trim(), prompt: prompt.querySelector("textarea").value.trim(), harness: harness.querySelector("select").value, project: proj.querySelector("select").value });
      closeModal();
      toast("Launched " + name.querySelector("input").value.trim(), { kind: "ok" });
      agentsStore.refresh(["herd"]);
    } catch (e) {
      msg.textContent = [e.error, e.why, e.do].filter(Boolean).join(". ");
      msg.hidden = false;
    }
  } });
  openModal(Modal({ title: "Launch agent", children: [name, prompt, harness, proj, msg], actions: [Button({ label: "Cancel", onClick: () => closeModal() }), go] }));
}

function paletteEntries() {
  const st = agentsStore.getState();
  const entries = [];
  for (const a of st.agents) entries.push({ id: "agent:" + a.key, group: "Agents", label: a.title, hint: (a.workspace || "") + ", " + STATE_WORD[a.state].toLowerCase(), glyph: HexGlyph(a.state, { size: "mini" }), run: () => { remember("agent:" + a.key); openAgent(a); } });
  for (const a of st.agents) {
    if (!a.cwd) continue;
    entries.push({ id: "files:" + a.key, group: "Files", label: "Open files for " + a.title, hint: a.cwd, icon: "folder", run: () => { remember("files:" + a.key); navigate("agents", { agent: a.key, tab: "files" }); } });
    entries.push({ id: "editor:" + a.key, group: "Files", label: "Open in editor: " + a.title, hint: a.cwd, icon: "external-link", run: () => { remember("editor:" + a.key); openEditor({ path: a.cwd }); } });
  }
  const go = (id, label, target, keys, ic) => entries.push({ id: "go:" + id, group: "Go to", label, icon: ic, keys, run: () => { remember("go:" + id); navigate(target); } });
  go("overview", "Overview", "overview", "g o", "overview");
  go("agents", "Agents: Fleet", "agents?lens=fleet", "g a", "agents");
  go("board", "Agents: Board", "agents?lens=board", "g w", "work");
  go("channel", "Channels", "channels", "g n", "irc");
  go("supervision", "Go to Supervision", "agents?lens=supervision", "g u", "agents");
  go("colony", "Colony", "colony", "g c", "herd");
  go("activity", "Activity", "activity", "g l", "activity");
  go("health", "Health", "health", "g h", "heart-pulse");
  go("improve", "Improve", "improve", "g i", "sparkles");
  go("projects", "Projects", "projects", "g p", "folder");
  go("settings", "Settings", "settings", "g ,", "settings");
  go("integrations", "Integrations", "settings#integrations", "", "settings");
  const act = (id, label, run, keys, ic) => entries.push({ id: "act:" + id, group: "Actions", label, keys, icon: ic, run: () => { remember("act:" + id); run(); } });
  act("launch", "Launch agent", launchAgent, "", "plus");
  act("prompt", "Prompt agent", () => openAppPalette("@"), "", "send");
  act("post", "Post to channel", () => navigate("channels"), "", "message");
  act("todo", "Add todo", () => navigate("agents?lens=board"), "", "work");
  act("hp-thread", "New herdr project thread", () => openNewThread({}), "", "plus");
  act("terminal", "Start terminal service", async () => { try { await api.post("herd/ensure", {}); toast("Terminal service started", { kind: "ok" }); agentsStore.recheck(); } catch (e) { toastError(e, "Could not start the terminal service"); } }, "", "terminal");
  act("refresh", "Refresh", refreshPage, "r", "refresh");
  act("theme", "Toggle theme", toggleTheme, "\u21E7 d", "sun");
  act("density", "Toggle density", toggleDensity, "d", "rows");
  act("shortcuts", "Keyboard shortcuts", showShortcuts, "?", "help");
  entries.push({ id: "proj:all", group: "Projects", label: "All projects", icon: "folder", run: () => setProject("all", true) });
  for (const p of store.get("projects") || []) entries.push({ id: "proj:" + p.root, group: "Projects", label: p.name || p.root, icon: "folder", run: () => setProject(p.root, true) });
  return entries;
}

function openAppPalette(initial) {
  openPalette({ entries: paletteEntries, recent, initial });
}

function refreshPage() {
  agentsStore.refresh();
  refreshAttention();
  current = null;
  route();
}

function showShortcuts() {
  const rows = [
    ["/ or Ctrl/Cmd K", "Command palette"],
    ["g then o a l h i p ,", "Overview, Agents, Activity, Health, Improve, Projects, Settings"],
    ["g then w c n u", "Agents: Board, Colony, Channel, Supervision"],
    ["p", "Focus project switcher"],
    ["[ and ]", "Collapse or expand the rail"],
    ["j and k", "Next or previous row in a list"],
    ["Enter / Shift+Enter", "Open inspector / its Terminal tab"],
    ["t", "Terminal tab of the open agent"],
    ["m", "Message the open agent"],
    ["r", "Refresh page"],
    ["d / Shift+D", "Toggle density / theme"],
    ["Esc", "Close the top layer, then clear selection"],
    ["?", "This list"],
  ];
  openModal(Modal({ title: "Keyboard shortcuts", children: [h("dl", { class: "kbd-list" }, rows.map(([k, d]) => [h("dt", null, Keycap(k)), h("dd", null, d)]))], actions: [Button({ label: "Close", variant: "primary", onClick: () => closeModal() })] }));
}

// ---- keyboard -----------------------------------------------------------------------------------------------------

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "IFRAME" || el.isContentEditable;
}

let chordTimer = null;
let chordArmed = false;

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "k") { // Mod+Shift+K belongs to the herdr console's own palette
    e.preventDefault();
    isPaletteOpen() ? closePalette() : openAppPalette();
    return;
  }
  if (e.key === "Escape") {
    if (hasOpenPopover()) closePopover();
    else if (isPaletteOpen()) closePalette();
    else if (hasOpenModal()) closeModal();
    else if (hasOpenDrawer()) closeDrawer();
    else return;
    e.preventDefault();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  if (chordArmed) {
    chordArmed = false;
    clearTimeout(chordTimer);
    const dest = CHORDS[e.key.toLowerCase()];
    if (dest) {
      e.preventDefault();
      navigate(dest);
    }
    return;
  }
  const k = e.key;
  if (k === "g") {
    chordArmed = true;
    clearTimeout(chordTimer);
    chordTimer = setTimeout(() => { chordArmed = false; }, 1500);
  } else if (k === "/") {
    e.preventDefault();
    const field = document.querySelector("#page-root input[type=search], #page-root .search");
    if (field && !isPaletteOpen()) field.focus();
    else openAppPalette();
  } else if (k === "?") { e.preventDefault(); showShortcuts(); }
  else if (k === "p") { e.preventDefault(); const sel = document.querySelector(isMobile() ? "#project-select-m" : "#project-select"); if (sel) sel.focus(); }
  else if (k === "[") toggleRail();
  else if (k === "]") toggleRail();
  else if (k === "D") toggleTheme();
  else if (k === "d") toggleDensity();
  else if (k === "r") refreshPage();
  else if (k === "t" && parseHash().params.agent) setTab("terminal");
  else if (k === "m" && parseHash().params.agent) { setTab("channel"); setTimeout(() => { const ta = document.querySelector(".cc-composer textarea"); if (ta) ta.focus(); }, 0); }
}

function setTab(tab) {
  setParams({ tab });
  syncInspector(parseHash().params);
}

// ---- boot --------------------------------------------------------------------------------------------------------------

async function boot() {
  const local = loadLocalPrefs();
  store.set("prefs", Object.assign({ theme: "dark", density: "comfortable" }, local));
  store.set("project", local.default_project || "all");
  applyTheme();
  buildNav();
  buildTopbar();
  const tree = RailTree({ onSelect: (rec, o) => openAgent(rec, { tab: o && o.terminal ? "terminal" : undefined }), onRecheck: () => agentsStore.recheck() });
  document.getElementById("rail-tree-host").appendChild(tree);
  agentsStore.watchColony();

  let lastStamp = -1;
  agentsStore.subscribe((st) => {
    if (st.generation === lastStamp) return;
    lastStamp = st.generation;
    strip.update(st.agents);
    tree.update(st, parseHash().params.agent);
    buildLive(st);
    buildAttention();
    buildNav();
    if (waitingFor) syncInspector(parseHash().params);
    const root = document.getElementById("page-root");
    if (st.down === "daemon" && !root.querySelector('[data-layer="daemon"]')) replace(root, DegradedState({ layer: "daemon", reason: st.layers.daemon.reason, onRecheck: () => recheckDaemon() }));
  });
  store.subscribe("attention", buildAttention);
  document.addEventListener("keydown", onKey);
  document.addEventListener("atlas:launch", launchAgent);

  const probe = api.probe();
  const [prefs, projects] = await Promise.all([api.get("prefs").catch(() => null), api.get("projects").catch(() => null), loadExternalPages()]).then((r) => [r[0], r[1]]);
  if (prefs) {
    store.set("prefs", Object.assign({}, store.get("prefs"), prefs));
    if (prefs.default_project) store.set("project", prefs.default_project);
    applyTheme();
  }
  store.set("projects", projects && Array.isArray(projects.projects) ? projects.projects : []);
  const known = new Set(["all", ...store.get("projects").map((p) => p.root)]);
  if (!known.has(store.get("project"))) store.set("project", "all");
  applyPrefs();
  store.subscribe("prefs", applyPrefs);
  probe.then((p) => {
    if (p.up && p.data && p.data.version) {
      store.set("version", p.data.version);
      document.getElementById("version-chip").textContent = "Atlas " + p.data.version;
    }
  });

  window.addEventListener("hashchange", route);
  window.addEventListener("unhandledrejection", (e) => {
    if (e.reason instanceof ApiError) {
      e.preventDefault();
      toastError(e.reason);
    }
  });
  agentsStore.onEvent((name, data) => {
    if (name === "health") refreshAttentionSoon();
    if (current && current.page.onEvent) {
      try {
        current.page.onEvent(name, current.ctx, data);
      } catch (_err) {
        // a page's live update must not break the stream
      }
    }
  });
  agentsStore.start({ project: store.get("project"), pollMs: refreshMs() });
  if (!location.hash) location.hash = "#/overview";
  else route();
  refreshAttention();
}

boot();
