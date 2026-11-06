import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { body, installDom, restoreDom } from "./operate-dom-stub.js";

installDom();
await import("./pages/settings.js");
restoreDom();

let seq = 0;
const fresh = async () => (await import("./pages/settings.js?n=" + ++seq)).default;

// ---- what the shared stub lacks: selectors with commas/descendants/attributes, connected tracking, contains/closest ----
// data-* attributes live in node.dataset only (the stub's h() writes dataset, never attrs)
function attrOf(n, name) {
  if (name in n.attrs) return n.attrs[name];
  if (name.startsWith("data-")) return n.dataset[name.slice(5).replace(/-(\w)/g, (_m, c) => c.toUpperCase())];
  return undefined;
}
function matchCompound(n, c) {
  if (!n.attrs) return false;
  let rest = c;
  const tm = /^[A-Za-z][\w-]*/.exec(rest);
  if (tm) { if (n.tag !== tm[0]) return false; rest = rest.slice(tm[0].length); }
  while (rest) {
    let m;
    if ((m = /^\.([\w-]+)/.exec(rest))) { if (!n.className.split(/\s+/).includes(m[1])) return false; }
    else if ((m = /^#([\w-]+)/.exec(rest))) { if (n.attrs.id !== m[1]) return false; }
    else if ((m = /^\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/.exec(rest))) {
      const av = attrOf(n, m[1]);
      if (av === undefined) return false;
      if (m[2] === "=" && av !== m[3]) return false;
      if (m[2] === "^=" && !String(av).startsWith(m[3])) return false;
    } else return false;
    rest = rest.slice(m[0].length);
  }
  return true;
}
function matchChain(n, parts) {
  if (!matchCompound(n, parts[parts.length - 1])) return false;
  let at = n.parent;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    while (at && !matchCompound(at, parts[i])) at = at.parent;
    if (!at) return false;
    at = at.parent;
  }
  return true;
}
const chains = (sel) => String(sel).split(",").map((p) => p.trim().split(/\s+/));
const PKEYS = ["classList", "querySelectorAll", "matches", "closest", "contains", "appendChild", "replaceChildren", "replaceWith", "remove", "removeChild", "append", "focus"];
let protoSaved;
let focusLog;
function patchProto() {
  const proto = Object.getPrototypeOf(document.createElement("div"));
  protoSaved = Object.fromEntries(PKEYS.map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)]));
  const mark = (n, on) => { n.isConnected = on; (n.children || []).forEach((c) => mark(c, on)); };
  const oAppend = protoSaved.appendChild.value;
  const oReplaceChildren = protoSaved.replaceChildren.value;
  const oReplaceWith = protoSaved.replaceWith.value;
  const oRemove = protoSaved.remove.value;
  Object.defineProperties(proto, {
    // the stub's classList has no contains(); intercept the constructor's assignment to add one
    classList: { get() { return this._cl; }, set(v) { this._cl = { ...v, contains: (c) => this.className.split(/\s+/).includes(c) }; }, configurable: true },
    querySelectorAll: { value(sel) { const cs = chains(sel); const out = []; const walk = (n) => n.children.forEach((c) => { if (c.attrs && cs.some((p) => matchChain(c, p))) out.push(c); walk(c); }); walk(this); return out; }, configurable: true, writable: true },
    matches: { value(sel) { return chains(sel).some((p) => matchChain(this, p)); }, configurable: true, writable: true },
    closest: { value(sel) { for (let n = this; n; n = n.parent) if (n.attrs && n.matches(sel)) return n; return null; }, configurable: true, writable: true },
    contains: { value(o) { for (let n = o; n; n = n.parent) if (n === this) return true; return false; }, configurable: true, writable: true },
    appendChild: { value(c) { oAppend.call(this, c); if (this.isConnected) mark(c, true); return c; }, configurable: true, writable: true },
    replaceChildren: { value(...c) { const old = this.children.slice(); oReplaceChildren.apply(this, c); old.forEach((o) => { if (o.parent !== this) mark(o, false); }); if (this.isConnected) this.children.forEach((x) => mark(x, true)); }, configurable: true, writable: true },
    replaceWith: { value(n) { const p = this.parent; oReplaceWith.call(this, n); mark(this, false); if (p && p.isConnected) mark(n, true); }, configurable: true, writable: true },
    remove: { value() { oRemove.call(this); mark(this, false); }, configurable: true, writable: true },
    removeChild: { value(c) { this.children = this.children.filter((x) => x !== c); c.parent = null; mark(c, false); return c; }, configurable: true, writable: true },
    append: { value(...c) { c.forEach((x) => this.appendChild(typeof x === "string" ? document.createTextNode(x) : x)); }, configurable: true, writable: true },
    focus: { value(opts) { focusLog.push([this.attrs.id || this.tag, opts]); document.activeElement = this; }, configurable: true, writable: true },
  });
}
function unpatchProto() {
  const proto = Object.getPrototypeOf(document.createElement("div"));
  for (const k of PKEYS) { if (protoSaved[k]) Object.defineProperty(proto, k, protoSaved[k]); else delete proto[k]; }
}

let saved;
let timers;
let winListeners;
let docListeners;
let confirmAnswer;
let confirmLog;
function patchGlobals() {
  timers = { list: [], cleared: [] };
  focusLog = [];
  saved = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, CSS: globalThis.CSS, location: globalThis.location, history: globalThis.history };
  globalThis.setTimeout = (fn, ms) => { timers.list.push({ fn, ms, id: timers.list.length + 1 }); return timers.list.length; };
  globalThis.clearTimeout = (id) => { timers.cleared.push(id); };
  globalThis.CSS = { escape: (s) => String(s) };
  globalThis.location = { hash: "#/settings", search: "", href: "http://x/", protocol: "http:", host: "x" };
  globalThis.history = { calls: [], replaceState(...a) { this.calls.push(a); } };
  winListeners = {};
  docListeners = {};
  window.addEventListener = (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); };
  window.removeEventListener = (t, f) => { winListeners[t] = (winListeners[t] || []).filter((x) => x !== f); };
  document.addEventListener = (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); };
  document.removeEventListener = (t, f) => { docListeners[t] = (docListeners[t] || []).filter((x) => x !== f); };
  document.activeElement = null;
  confirmLog = [];
  confirmAnswer = true;
  window.confirm = (m) => { confirmLog.push(m); return confirmAnswer; };
}
function unpatchGlobals() {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  delete window.confirm;
}

// ---- fixtures ----
const knob = (key, title, kind, over = {}) => ({ key, title, description: title + " d", effect: title + " e", applies: "now", kind, value: "", scope: "hooks", layers: { live_env: { supported: true, value: "" }, store: { supported: true, value: "" } }, ...over });
const BEHAVIOR = () => ({
  groups: [
    { title: "Guardrails", intro: "Dispatch gates.", knobs: [knob("ATLAS_TRIPWIRE", "Tripwire", "toggle", { on: "on", off: "off", value: "on" }), knob("ATLAS_LIMIT", "Limit", "number", { range: { min: 1, max: 20, step: 1 }, value: "7" })] },
    { title: "Prompt optimizer", intro: "Rewrites.", knobs: [knob("ATLAS_OPTIMIZE", "Optimizer", "select", { options: ["off", "on"], value: "off", hook_value: "on" })] },
    { title: "Mystery", intro: "Unlisted.", knobs: [knob("ATLAS_MYSTERY", "Mystery knob", "toggle", { value: "on" })] },
  ],
  advanced: [knob("ATLAS_ADV", "Advanced knob", "toggle", { value: "off" })],
  paths: [{ key: "ATLAS_HOME", title: "State dir", value: "/home/a" }, { key: "ATLAS_DB", title: "DB", value: "/home/a/db" }],
});
const ECO = () => ({
  plugins: [
    { key: "foo@market", name: "Foo", version: "1.2", description: "A foo plugin", enabled: true, installed: true, skills: 2, agents: 1, mcp_servers: ["a"] },
    { key: "bar@market", name: "", version: "", description: "", enabled: false, installed: false },
    { key: "atlas@market", name: "Atlas", enabled: true, installed: true },
  ],
  mcp: { servers: [
    { name: "srv1", origin: "user", origin_detail: "settings.json", transport: "stdio", enabled: true },
    { name: "srv2", origin: "plugin", plugin_enabled: false, transport: "http", enabled: false },
    { name: "srv3", origin: "plugin", plugin_enabled: true, transport: "sse", enabled: true },
  ] },
  atlas: { plugin_enabled: true, plugin_root: "/opt/atlas", output_style: "terse", output_styles: ["terse", "wordy"], skills: ["sk1", "sk2"], agents: ["ag1"], bindings: [{ event: "PreToolUse", matcher: "Bash", script: "a.py", timeout: 5, present: true }, { event: "Stop", matcher: "*", script: "b.py", present: false }], hooks_disabled_globally: false },
  user: { skills: ["u1"], agents: [], hook_events: ["Stop"], active_output_style: "plain" },
});
const CONNECTORS = () => ({
  settings_path: "/home/a/.claude/settings.json",
  connectors: [
    { name: "vanta", server_name: "vanta-mcp", enabled: true, health: "ok", bundle_exists: true, configured_hint: true, usage: { calls: 3, calls_total: 10, window_days: 7, errors: 1, error_rate: 0.333, last_used: Date.now() / 1000 - 7200 }, missing_required: [], fields: [
      { env_key: "VANTA_ID", title: "Client id", is_set: true, value: "abc", sensitive: false, source: "env", description: "Who you are" },
      { user_config_key: "vanta_secret", env_key: "VANTA_SECRET", title: "Secret", is_set: true, value: "", sensitive: true, source: "keychain" },
      { env_key: "VANTA_FLAG", title: "Flag", type: "bool", is_set: true, value: "true", source: "missing" },
    ] },
    { name: "ninja", server_name: "ninja-mcp", enabled: false, health: "degraded", bundle_exists: true, configured_hint: false, usage: {}, missing_required: ["NINJA_KEY"], fields: [{ env_key: "NINJA_KEY", title: "Key", is_set: false, value: "", sensitive: true }] },
    { name: "gone", server_name: "gone-mcp", enabled: false, health: "weird", bundle_exists: false, configured_hint: false, fields: [] },
  ],
});
const PREFS = () => ({ theme: "dark", density: "comfortable", default_project: "all", refresh_seconds: 8, noise: { collapse_duplicates: true, min_severity: "info" }, nav_order: ["overview", "activity", "health", "agents", "colony", "terminal", "channels", "improve", "projects", "settings"] });
const AGENTS = () => ({ agents: [
  { name: "worker", model: "opus", effort: "high", overridden: false, source: "plugin", omp: { model_chain: ["a", "b"] }, dispatches: { last7d: 2, total: 9, last_used: 1_700_000_000 } },
  { name: "scout", model: "", overridden: true, source: "override", omp: { effort: "low", model_chain: [] }, dispatches: {} },
  { name: "solo", source: "override", overridden: false, omp: null },
] });
const PROJECT_LIST = () => ({ projects: [{ id: 1, root_path: "/r1", label: "One" }, { id: 2, root_path: "/r2", folder: "two" }, { id: 3, root_path: "/r3", name: "Three" }, { id: 4, root_path: "/r4" }] });

let calls;
let routes;
let ctx;
let page;
function mkCtx(over = {}) {
  calls = { gets: [], posts: [], puts: [], toasts: [], stored: [] };
  routes = {
    "/api/behavior": BEHAVIOR(),
    "/api/ecosystem": ECO(),
    "/api/connectors": CONNECTORS(),
    "/api/v2/prefs": { state: PREFS() },
    "/api/v2/projects": { projects: [{ root: "/r1", name: "One" }, { root: "/r2" }] },
    "/api/projects?editable=1": PROJECT_LIST(),
    "/api/agents": AGENTS(),
    "/api/agents?project_id=1": AGENTS(),
    "/api/agents?project_id=2": { agents: [{ name: "other", source: "plugin" }] },
    "/api/agents/worker?project_id=1": { content: "worker body" },
    "/api/agents/scout?project_id=1": { content: "scout body" },
    "/api/agents/other?project_id=2": { content: "other body" },
    ...(over.routes || {}),
  };
  const get = async (p, q) => {
    calls.gets.push(q ? [p, q] : p);
    const r = routes[p];
    if (r instanceof Error) throw r;
    if (typeof r === "function") return r(q);
    if (r === undefined) return {};
    return r;
  };
  const respond = (list, key) => async (p, b) => { list.push([p, b]); const r = routes[key + p]; if (r instanceof Error) throw r; if (typeof r === "function") return r(b); return r === undefined ? { ok: true } : r; };
  return {
    project: "/r1",
    params: {},
    prefs: {},
    toast: (m, o) => calls.toasts.push([m, o && o.kind]),
    store: { set: (k, v) => calls.stored.push([k, v]) },
    api: { get, post: respond(calls.posts, "POST "), put: async (p, b) => { calls.puts.push([p, b]); const r = routes["PUT " + p]; if (r instanceof Error) throw r; return r === undefined ? { state: { ...PREFS(), ...b } } : typeof r === "function" ? r(b) : r; } },
    ...over.ctx,
  };
}
const selVal = (sel) => { const o = sel.querySelectorAll("option").find((x) => x.selected); return o ? o.value : undefined; };
const flush = async (n = 4) => { for (let i = 0; i < n; i += 1) await new Promise((r) => queueMicrotask(r)); await new Promise((r) => saved.setTimeout(r, 0)); for (let i = 0; i < n; i += 1) await new Promise((r) => queueMicrotask(r)); };
async function mountPage(over = {}) {
  ctx = mkCtx(over);
  body.replaceChildren();
  await page.load(ctx);
  const node = page.render(ctx);
  body.appendChild(node);
  await flush();
  return node;
}
const $ = (sel) => body.querySelector(sel);
const $$ = (sel) => body.querySelectorAll(sel);
const byId = (id) => body.querySelector("#" + id);
const texts = (sel) => $$(sel).map((n) => n.textContent);
const fire = (n, type, e) => { const ev = { preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...e }; (n.listeners[type] || []).forEach((f) => f(ev)); return ev; };
const btn = (label, within) => (within || body).querySelectorAll("button").find((b) => b.textContent === label);

beforeEach(async () => {
  installDom();
  patchProto();
  patchGlobals();
  page = await fresh();
});
afterEach(() => {
  try { page.destroy(); } catch (_e) { /* already destroyed */ }
  unpatchGlobals();
  unpatchProto();
  restoreDom();
});

describe("page shell", () => {
  test("load returns at once; the page has a title, subtitle, filter and five tabs with counts", async () => {
    ctx = mkCtx();
    expect(await page.load(ctx)).toEqual({ ok: true });
    expect(page.id).toBe("settings");
    const node = page.render(ctx);
    body.appendChild(node);
    await flush();
    expect(node.className).toBe("pg-page pg-settings-page");
    expect($("h1.pg-title").textContent).toBe("Settings");
    expect($("p.pg-sub").textContent).toContain("A save only turns green after the server reads each written layer back equal.");
    const filter = byId("st-filter");
    expect([filter.getAttribute("type"), filter.getAttribute("placeholder"), filter.getAttribute("aria-label")]).toEqual(["search", "Filter settings by name, key or effect", "Filter settings"]);
    expect($("div.st-tabs").getAttribute("role")).toBe("tablist");
    expect(texts("button.st-tab").map((t) => t.replace(/\s+/g, " ").trim())).toEqual(["Dashboard 6", "Behavior 4", "Models 1", "Integrations 9", "Agents 3"]);
  });

  test("the tab counts: rows for knob tabs, inventory plus connectors for Integrations, roster for Agents", async () => {
    await mountPage();
    const counts = Object.fromEntries($$("button.st-tab").map((b) => [b.attrs.id, b.querySelector("span.st-count").textContent]));
    expect(counts).toEqual({ "st-tab-dashboard": "6", "st-tab-behavior": "4", "st-tab-models": "1", "st-tab-integrations": "9", "st-tab-agents": "3" });
  });

  test("the first fetches cover every section, then the agents for the matching project", async () => {
    await mountPage();
    expect(calls.gets.slice(0, 6).sort()).toEqual(["/api/behavior", "/api/connectors", "/api/ecosystem", "/api/projects?editable=1", "/api/v2/prefs", "/api/v2/projects"].sort());
    expect(calls.gets.slice(6)).toEqual(["/api/agents?project_id=1", "/api/agents/worker?project_id=1"]);
  });

  test("the rendered tab is Dashboard; its panel is the only one shown", async () => {
    await mountPage();
    const panels = $$("div.st-panel");
    expect(panels.map((p) => [p.attrs.id, Boolean(p.hidden)])).toEqual([["st-panel-dashboard", false], ["st-panel-behavior", true], ["st-panel-models", true], ["st-panel-integrations", true], ["st-panel-agents", true]]);
    expect($$("button.st-tab").map((b) => [b.getAttribute("aria-selected"), b.getAttribute("tabindex")])).toEqual([["true", "0"], ["false", "-1"], ["false", "-1"], ["false", "-1"], ["false", "-1"]]);
    expect($$("div.st-panel").map((p) => p.getAttribute("aria-labelledby"))).toEqual(["st-tab-dashboard", "st-tab-behavior", "st-tab-models", "st-tab-integrations", "st-tab-agents"]);
    expect($$("button.st-tab").map((b) => b.getAttribute("aria-controls"))).toEqual(["st-panel-dashboard", "st-panel-behavior", "st-panel-models", "st-panel-integrations", "st-panel-agents"]);
    expect($$("h2.st-tab-heading").every((h2) => h2.hidden)).toBe(true);
  });

  test("clicking a tab shows it, updates aria and writes ?tab= into the hash", async () => {
    await mountPage();
    $("#st-tab-behavior").click();
    expect($$("div.st-panel").map((p) => Boolean(p.hidden))).toEqual([true, false, true, true, true]);
    expect($("#st-tab-behavior").getAttribute("aria-selected")).toBe("true");
    expect($("#st-tab-behavior").getAttribute("tabindex")).toBe("0");
    expect($("#st-tab-dashboard").getAttribute("aria-selected")).toBe("false");
    expect(history.calls.at(-1)).toEqual([null, "", "#/settings?tab=behavior"]);
    globalThis.location.hash = "#/settings?tab=models";
    $("#st-tab-agents").click();
    expect(history.calls.at(-1)[2]).toBe("#/settings?tab=agents");
  });

  test("a history failure does not stop tab selection", async () => {
    await mountPage();
    globalThis.history = { replaceState() { throw new Error("no history"); } };
    $("#st-tab-models").click();
    expect($("#st-panel-models").hidden).toBe(false);
  });

  test("arrow, Home and End keys move between tabs with focus and wrap around", async () => {
    await mountPage();
    const bar = $("div.st-tabs");
    const press = (key) => fire(bar, "keydown", { key });
    const sel = () => $$("button.st-tab").findIndex((b) => b.getAttribute("aria-selected") === "true");
    expect(press("ArrowRight").prevented).toBe(true);
    expect(sel()).toBe(1);
    expect(focusLog.at(-1)[0]).toBe("st-tab-behavior");
    press("End");
    expect(sel()).toBe(4);
    press("ArrowRight");
    expect(sel()).toBe(0);
    press("ArrowLeft");
    expect(sel()).toBe(4);
    press("Home");
    expect(sel()).toBe(0);
    const ev = press("x");
    expect(ev.prevented).toBeUndefined();
    expect(sel()).toBe(0);
  });
});

describe("initial tab", () => {
  const withLocation = async (loc) => {
    ctx = mkCtx();
    globalThis.location = { ...globalThis.location, ...loc };
    await page.load(ctx);
    const node = page.render(ctx);
    body.replaceChildren(node);
    await flush();
    return $$("button.st-tab").find((b) => b.getAttribute("aria-selected") === "true").attrs.id;
  };

  test("?tab= in the hash or the search picks a tab; an unknown tab falls back to Dashboard", async () => {
    expect(await withLocation({ hash: "#/settings?tab=models", search: "" })).toBe("st-tab-models");
    expect(await withLocation({ hash: "#/settings", search: "?tab=agents" })).toBe("st-tab-agents");
    expect(await withLocation({ hash: "#/settings?tab=models", search: "?tab=agents" })).toBe("st-tab-models");
    expect(await withLocation({ hash: "#/settings?tab=nope", search: "" })).toBe("st-tab-dashboard");
    expect(await withLocation({ hash: "#/settings", search: "" })).toBe("st-tab-dashboard");
  });

  test("a legacy ?cat= maps onto the nearest tab, however it is spelled", async () => {
    expect(await withLocation({ hash: "#/settings?cat=guardrails" })).toBe("st-tab-behavior");
    expect(await withLocation({ hash: "#/settings?cat=Prompt%20Optimizer" })).toBe("st-tab-models");
    expect(await withLocation({ hash: "#/settings", search: "?cat=Decision_Model" })).toBe("st-tab-models");
    expect(await withLocation({ hash: "#/settings?cat=connectors" })).toBe("st-tab-integrations");
    expect(await withLocation({ hash: "#/settings?cat=agents" })).toBe("st-tab-agents");
    expect(await withLocation({ hash: "#/settings?cat=preferences" })).toBe("st-tab-dashboard");
    expect(await withLocation({ hash: "#/settings?cat=unheard-of" })).toBe("st-tab-dashboard");
    expect(await withLocation({ hash: "#/settings?tab=agents&cat=guardrails" })).toBe("st-tab-agents");
  });

  test("with no location at all it opens on Dashboard", async () => {
    ctx = mkCtx();
    delete globalThis.location;
    await page.load(ctx);
    const node = page.render(ctx);
    body.replaceChildren(node);
    expect($$("button.st-tab").find((b) => b.getAttribute("aria-selected") === "true").attrs.id).toBe("st-tab-dashboard");
  });
});

describe("knob rows", () => {
  test("behavior groups come in the server's fixed order with intros, unlisted groups after, advanced last", async () => {
    await mountPage();
    const groups = $$("#st-panel-behavior section.st-group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Guardrails", "Mystery", "Advanced"]);
    expect(groups.map((g) => g.querySelector("h3.st-group-title").textContent)).toEqual(["Guardrails", "Mystery", "Advanced"]);
    expect(groups.map((g) => (g.querySelector("p.st-group-intro") || { textContent: null }).textContent)).toEqual(["Dispatch gates.", "Unlisted.", null]);
    expect(groups[0].querySelectorAll("li.st-card").map((li) => li.getAttribute("id"))).toEqual(["st-ATLAS_TRIPWIRE-row", "st-ATLAS_LIMIT-row"]);
  });

  test("model groups are on the Models tab, using the hook value when there is one", async () => {
    await mountPage();
    const models = $$("#st-panel-models section.st-group");
    expect(models.map((g) => g.getAttribute("aria-label"))).toEqual(["Prompt optimizer"]);
    const sel = $("#st-panel-models select");
    expect(selVal(sel)).toBe("on");
  });

  test("the paths footer lists each variable and where to set them; none means no footer", async () => {
    await mountPage();
    expect($("p.st-paths").textContent).toBe("State dir (ATLAS_HOME): /home/a | DB (ATLAS_DB): /home/a/db. Set these in your shell before starting atlas.");
    await mountPage({ routes: { "/api/behavior": { ...BEHAVIOR(), paths: [] } } });
    expect($("p.st-paths")).toBeNull();
    await mountPage({ routes: { "/api/behavior": { groups: [] } } });
    expect($("p.st-paths")).toBeNull();
    expect($$("#st-panel-behavior section").length).toBe(0);
  });

  test("a knob save posts the update and shows the verified layers; a reply without read-back is not saved", async () => {
    await mountPage();
    routes["POST /api/behavior"] = { ok: true, layers: [{ layer: "store", ok: true }, { layer: "claude_settings", ok: true }] };
    byId("st-ATLAS_TRIPWIRE").click();
    await flush();
    expect(calls.posts).toEqual([["/api/behavior", { updates: { ATLAS_TRIPWIRE: "off" } }]]);
    expect(byId("st-ATLAS_TRIPWIRE-status").textContent).toBe("✓ verified · atlas store, claude settings.json");
    routes["POST /api/behavior"] = { ok: true };
    byId("st-ATLAS_TRIPWIRE").click();
    await flush();
    expect(byId("st-ATLAS_TRIPWIRE-status").textContent).toBe("✗ not saved: the server returned no read-back");
    routes["POST /api/behavior"] = null;
    byId("st-ATLAS_TRIPWIRE").click();
    await flush();
    expect(byId("st-ATLAS_TRIPWIRE-status").textContent).toBe("✗ not saved: the server returned no read-back");
  });

  test("a failing save is reported on the row", async () => {
    await mountPage();
    routes["POST /api/behavior"] = Object.assign(new Error("x"), { error: "boom" });
    byId("st-ATLAS_TRIPWIRE").click();
    await flush();
    expect(byId("st-ATLAS_TRIPWIRE-status").textContent).toBe("✗ not saved: boom");
  });

  test("a command knob confirm uses the page's confirm dialog", async () => {
    routes = null;
    ctx = mkCtx({ routes: { "/api/behavior": { groups: [{ title: "Prompt optimizer", intro: "", knobs: [knob("ATLAS_CMD", "Command", "command", { value: "" })] }] } } });
    await page.load(ctx);
    body.replaceChildren(page.render(ctx));
    await flush();
    const input = byId("st-ATLAS_CMD");
    input.value = "rm -rf /tmp/x";
    fire(input, "change");
    await flush();
    expect(body.textContent).toContain("Save ATLAS_CMD?");
    expect(body.textContent).toContain("This is run as a shell command on every matching prompt:");
    btn("Cancel", body).click();
    await flush();
    expect(calls.posts).toEqual([]);
    expect(byId("st-ATLAS_CMD-status").textContent).toBe("✗ not saved: cancelled");
  });

  test("a url knob's Test button asks the ollama status route with the typed url", async () => {
    ctx = mkCtx({ routes: { "/api/behavior": { groups: [{ title: "Decision model", intro: "", knobs: [knob("ATLAS_URL", "Url", "url", { value: "http://a" })] }] }, "/api/v2/ollama/status": (q) => ({ reachable: true, version: q.url === "http://b" ? "0.9" : undefined }) } });
    await page.load(ctx);
    body.replaceChildren(page.render(ctx));
    await flush();
    byId("st-ATLAS_URL").value = "http://b";
    byId("st-ATLAS_URL-test").click();
    await flush();
    expect(calls.gets.at(-1)).toEqual(["/api/v2/ollama/status", { url: "http://b" }]);
    expect($("span.st-hint").textContent).toBe("✓ reachable · ollama 0.9");
    ctx.api.get = async () => ({ reachable: false });
    byId("st-ATLAS_URL-test").click();
    await flush();
    expect($("span.st-hint").textContent).toBe("✗ not reachable");
    ctx.api.get = async () => ({ reachable: true });
    byId("st-ATLAS_URL-test").click();
    await flush();
    expect($("span.st-hint").textContent).toBe("✓ reachable");
  });
});

describe("dashboard preferences", () => {
  test("six preference rows show the saved values, with the project list from the API", async () => {
    await mountPage();
    const rows = $$("#st-panel-dashboard li.st-card");
    expect(rows.map((r) => r.getAttribute("id"))).toEqual(["st-theme-row", "st-density-row", "st-default_project-row", "st-refresh_seconds-row", "st-noise_min_severity-row", "st-nav_order-row"]);
    expect(rows.map((r) => r.querySelector("label.st-title").textContent)).toEqual(["Theme", "Density", "Default project", "Fallback refresh (seconds)", "Activity: hide events below", "Sidebar order"]);
    const proj = byId("st-default_project");
    expect(proj.querySelectorAll("option").map((o) => [o.value, o.textContent])).toEqual([["all", "All projects"], ["/r1", "One"], ["/r2", "/r2"]]);
    expect(byId("st-theme").querySelectorAll("option").map((o) => o.textContent)).toEqual(["Dark", "Light", "Match system"]);
    expect(byId("st-refresh_seconds").value).toBe("8");
  });

  test("a default project that is not in the list is still offered", async () => {
    routes = null;
    ctx = mkCtx({ routes: { "/api/v2/prefs": { state: { ...PREFS(), default_project: "/elsewhere" } } } });
    await page.load(ctx);
    body.replaceChildren(page.render(ctx));
    await flush();
    expect(byId("st-default_project").querySelectorAll("option").map((o) => o.value)).toEqual(["all", "/r1", "/r2", "/elsewhere"]);
  });

  test("prefs fall back to the defaults and to the context's prefs when the route gives nothing usable", async () => {
    routes = null;
    ctx = mkCtx({ routes: { "/api/v2/prefs": new Error("down") }, ctx: { prefs: { theme: "light", noise: { min_severity: "warn" } } } });
    await page.load(ctx);
    body.replaceChildren(page.render(ctx));
    await flush();
    expect(selVal(byId("st-theme"))).toBe("light");
    expect(selVal(byId("st-density"))).toBe("comfortable");
    expect(byId("st-refresh_seconds").value).toBe("8");
    expect(selVal(byId("st-noise_min_severity"))).toBe("warn");
    expect(selVal(byId("st-default_project"))).toBe("all");
  });

  test("prefs sent bare (no state wrapper) are used too", async () => {
    routes = null;
    ctx = mkCtx({ routes: { "/api/v2/prefs": { theme: "system" } } });
    await page.load(ctx);
    body.replaceChildren(page.render(ctx));
    await flush();
    expect(selVal(byId("st-theme"))).toBe("system");
  });

  test("changing the theme PUTs just that pref, adopts the server state and tells the store", async () => {
    await mountPage();
    const sel = byId("st-theme");
    sel.value = "light";
    fire(sel, "change");
    await flush();
    expect(calls.puts).toEqual([["/api/v2/prefs", { theme: "light" }]]);
    expect(byId("st-theme-status").textContent).toBe("✓ verified · dashboard prefs");
    expect(calls.stored.length).toBe(1);
    expect(calls.stored[0][0]).toBe("prefs");
    expect(calls.stored[0][1].theme).toBe("light");
    expect(ctx.prefs.theme).toBe("light");
  });

  test("a server that did not keep the value shows not saved with the layer", async () => {
    await mountPage();
    routes["PUT /api/v2/prefs"] = { state: PREFS() };
    const sel = byId("st-theme");
    sel.value = "light";
    fire(sel, "change");
    await flush();
    expect(byId("st-theme-status").textContent).toBe("✗ not saved: dashboard prefs has dark");
    expect(sel.value).toBe("dark");
  });

  test("the refresh number is saved as a number and noise keeps its siblings", async () => {
    await mountPage();
    const input = byId("st-refresh_seconds");
    input.value = "15";
    fire(input, "change");
    await flush();
    expect(calls.puts.at(-1)).toEqual(["/api/v2/prefs", { refresh_seconds: 15 }]);
    expect(byId("st-refresh_seconds-status").textContent).toBe("✓ verified · dashboard prefs");
    const sev = byId("st-noise_min_severity");
    sev.value = "fail";
    fire(sev, "change");
    await flush();
    expect(calls.puts.at(-1)).toEqual(["/api/v2/prefs", { noise: { collapse_duplicates: true, min_severity: "fail" } }]);
    expect(byId("st-noise_min_severity-status").textContent).toBe("✓ verified · dashboard prefs");
  });

  test("a failed PUT is reported on the row", async () => {
    await mountPage();
    routes["PUT /api/v2/prefs"] = Object.assign(new Error("x"), { error: "denied" });
    const sel = byId("st-density");
    sel.value = "compact";
    fire(sel, "change");
    await flush();
    expect(byId("st-density-status").textContent).toBe("✗ not saved: denied");
  });

  test("a put that answers nothing leaves the stored prefs alone", async () => {
    await mountPage();
    routes["PUT /api/v2/prefs"] = null;
    const sel = byId("st-theme");
    sel.value = "light";
    fire(sel, "change");
    await flush();
    expect(calls.stored).toEqual([]);
  });

  test("without a store the prefs are still adopted", async () => {
    ctx = mkCtx();
    ctx.store = undefined;
    await page.load(ctx);
    body.replaceChildren(page.render(ctx));
    await flush();
    const sel = byId("st-theme");
    sel.value = "light";
    fire(sel, "change");
    await flush();
    expect(ctx.prefs.theme).toBe("light");
  });
});

describe("sidebar order", () => {
  const order = () => $$("ol.pg-nav-edit li.pg-nav-item").map((li) => li.querySelector("span").textContent);
  const arrow = (label) => $$("ol.pg-nav-edit button").find((b) => b.getAttribute("aria-label") === label);

  test("the editor lists pages by label with the first up and last down disabled", async () => {
    await mountPage();
    expect(order()).toEqual(["Overview", "Activity", "Health", "Agents", "Colony", "Terminal", "Channels", "Improve", "Projects", "Settings"]);
    expect($("ol.pg-nav-edit").getAttribute("aria-label")).toBe("Navigation order");
    expect(arrow("Move Overview up").disabled).toBe(true);
    expect(arrow("Move Overview down").disabled).toBeFalsy();
    expect(arrow("Move Settings down").disabled).toBe(true);
    expect(arrow("Move Settings up").disabled).toBeFalsy();
    expect(arrow("Move Health up").textContent).toBe("↑");
    expect(arrow("Move Health down").textContent).toBe("↓");
  });

  test("moving a page saves the new order and redraws the list", async () => {
    await mountPage();
    arrow("Move Health up").click();
    await flush();
    expect(calls.puts).toEqual([["/api/v2/prefs", { nav_order: ["overview", "health", "activity", "agents", "colony", "terminal", "channels", "improve", "projects", "settings"] }]]);
    expect(order().slice(0, 4)).toEqual(["Overview", "Health", "Activity", "Agents"]);
    arrow("Move Overview down").click();
    await flush();
    expect(calls.puts.at(-1)[1].nav_order.slice(0, 3)).toEqual(["health", "overview", "activity"]);
  });

  test("a failed save shows the error next to the list and keeps the order", async () => {
    await mountPage();
    routes["PUT /api/v2/prefs"] = Object.assign(new Error("x"), { error: "denied", why: "Read only" });
    arrow("Move Health up").click();
    await flush();
    expect(byId("pg-pref-nav-status").textContent).toBe("Not saved: denied — Read only");
    expect(byId("pg-pref-nav-status").className).toBe("pg-saved is-fail");
    expect(order().slice(0, 4)).toEqual(["Overview", "Activity", "Health", "Agents"]);
  });

  test("a successful save flashes Saved, which clears itself after four seconds", async () => {
    await mountPage();
    arrow("Move Health up").click();
    await flush();
    expect(byId("pg-pref-nav-status").textContent).toBe("Saved");
    const timer = timers.list.find((t) => t.ms === 4000);
    expect(timer).toBeDefined();
    timer.fn();
    expect(byId("pg-pref-nav-status").textContent).toBe("");
    expect(byId("pg-pref-nav-status").className).toBe("pg-saved");
  });

  test("unknown ids in the saved order are labelled by their id or dropped", async () => {
    routes = null;
    ctx = mkCtx({ routes: { "/api/v2/prefs": { state: { ...PREFS(), nav_order: ["settings", "herd", "bogus"] } } } });
    await page.load(ctx);
    body.replaceChildren(page.render(ctx));
    await flush();
    expect(order().slice(0, 3)).toEqual(["Settings", "Terminal", "Overview"]);
    expect(order().length).toBe(10);
  });
});

// ---------------------------------------------------------------------------------------------
const sw = (id) => $$("button").find((b) => b.attrs.id === id);
const ecoRow = (key) => $$("li").find((li) => li.dataset && li.dataset.eco === key);
const rowText = (li) => li.textContent;
const defer = () => { let res; let rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, res, rej }; };
const ecoOver = (patch) => ({ routes: { "/api/ecosystem": { ...ECO(), ...patch } } });
const ecoTab = (id) => byId("pg-eco-tab-" + id);
const ecoRows = () => $$("#pg-sec-ecosystem ul.pg-rows li");
const savedOf = (li) => li.querySelector(".pg-saved");

describe("ecosystem", () => {
  test("tabs list every inventory with its size, flag the missing hook scripts and mark the active tab", async () => {
    await mountPage();
    expect(texts("#pg-sec-ecosystem div.pg-tabs button").map((t) => t.replace(/\s+/g, " ").trim())).toEqual([
      "Plugins (3)", "MCP servers (3)", "Atlas skills (2)", "Atlas agents (1)", "Output styles (2)", "Hook wirings (2) · 1 missing", "User skills (1)", "User agents (0)", "User hook events (1)",
    ]);
    const tablist = $("#pg-sec-ecosystem div.pg-tabs");
    expect([tablist.getAttribute("role"), tablist.getAttribute("aria-label")]).toEqual(["tablist", "Ecosystem inventory"]);
    expect(ecoTab("plugins").className).toBe("pg-tab is-active");
    expect(ecoTab("plugins").getAttribute("aria-selected")).toBe("true");
    expect(ecoTab("mcp").className).toBe("pg-tab");
    expect(ecoTab("mcp").getAttribute("aria-selected")).toBe("false");
    expect(ecoTab("mcp").getAttribute("role")).toBe("tab");
    const panel = $("#pg-sec-ecosystem div[role=\"tabpanel\"]");
    expect(panel.getAttribute("aria-labelledby")).toBe("pg-eco-tab-plugins");
  });

  test("no flag on tabs whose scripts are all present", async () => {
    await mountPage(ecoOver({ atlas: { ...ECO().atlas, bindings: [{ event: "Stop", matcher: "*", script: "b.py", present: true }] } }));
    expect(ecoTab("bindings").textContent.replace(/\s+/g, " ").trim()).toBe("Hook wirings (1)");
  });

  test("the intro line names the active output style and where the atlas plugin lives", async () => {
    await mountPage();
    const hints = texts("#pg-sec-ecosystem p.pg-hint");
    expect(hints).toContain("Active output style: terse. Atlas plugin enabled at /opt/atlas.");
    expect(hints[0]).toBe("What Claude Code has installed that atlas can see. Plugin and MCP switches edit Claude Code's settings.json. Claude Code reads them when it starts. Every other tab is a read-only list of what atlas ships or what you have in ~/.claude.");
    expect($("#pg-sec-ecosystem p.pg-banner")).toBeNull();
  });

  test("the active output style falls back to the user's, then to default; a missing plugin says so", async () => {
    await mountPage(ecoOver({ atlas: { plugin_enabled: false }, user: { active_output_style: "plain" } }));
    expect(texts("#pg-sec-ecosystem p.pg-hint")).toContain("Active output style: plain. Atlas plugin not enabled at unknown path.");
    await mountPage(ecoOver({ atlas: {}, user: undefined }));
    expect(texts("#pg-sec-ecosystem p.pg-hint")).toContain("Active output style: default. Atlas plugin not enabled at unknown path.");
    await mountPage(ecoOver({ atlas: undefined, user: undefined }));
    expect(texts("#pg-sec-ecosystem p.pg-hint")).toContain("Active output style: default. Atlas plugin not enabled at unknown path.");
  });

  test("globally disabled hooks show an alert banner", async () => {
    await mountPage(ecoOver({ atlas: { ...ECO().atlas, hooks_disabled_globally: true } }));
    const b = $("#pg-sec-ecosystem p.pg-banner");
    expect(b.textContent).toBe("Hooks are disabled globally (disableAllHooks) — Atlas hooks will not run.");
    expect([b.getAttribute("role"), b.className]).toEqual(["alert", "pg-banner is-warn"]);
  });

  test("plugin rows: name, version, description, counts and a switch; the host plugin has a badge instead", async () => {
    await mountPage();
    const rows = ecoRows();
    expect(rows.length).toBe(3);
    const foo = ecoRow("eco:plugin:foo@market");
    expect(foo.querySelector("span.pg-row-title").textContent).toBe("Foo 1.2");
    expect(foo.querySelectorAll("p.pg-hint").map((p) => p.textContent)).toEqual(["A foo plugin", "foo@market · 2 skills · 1 agents · 1 MCP"]);
    const s = sw("pg-plugin-foo@market");
    expect([s.getAttribute("role"), s.getAttribute("aria-checked"), s.getAttribute("aria-label"), s.className, s.textContent]).toEqual(["switch", "true", "Enable plugin Foo", "pg-switch is-on", "On"]);
    expect(s.disabled).toBeFalsy();
    const bar = ecoRow("eco:plugin:bar@market");
    expect(bar.querySelector("span.pg-row-title").textContent.trim()).toBe("bar@market");
    expect(bar.querySelectorAll("p.pg-hint").map((p) => p.textContent)).toEqual(["", "bar@market · 0 skills · 0 agents · 0 MCP"]);
    const off = sw("pg-plugin-bar@market");
    expect([off.getAttribute("aria-checked"), off.getAttribute("aria-label"), off.className, off.textContent, off.disabled]).toEqual(["false", "Enable plugin bar@market", "pg-switch", "Off", true]);
    const host = ecoRow("eco:plugin:atlas@market");
    expect(sw("pg-plugin-atlas@market")).toBeUndefined();
    expect(host.querySelector("span.badge").textContent).toBe("host plugin");
  });

  test("mcp rows: name, origin detail and transport; plugin servers of a disabled plugin cannot be switched", async () => {
    await mountPage();
    await (async () => { fire(ecoTab("mcp"), "click"); ecoTab("mcp").click(); })();
    const rows = ecoRows();
    expect(rows.map((r) => r.querySelector("span.pg-row-title").textContent)).toEqual(["srv1", "srv2", "srv3"]);
    expect(rows.map((r) => r.querySelector("p.pg-mono").textContent)).toEqual(["user · settings.json · stdio", "plugin · http", "plugin · sse"]);
    expect(sw("pg-mcp-srv1").getAttribute("aria-label")).toBe("Enable MCP server srv1");
    expect([sw("pg-mcp-srv1").disabled, sw("pg-mcp-srv2").disabled, sw("pg-mcp-srv3").disabled].map(Boolean)).toEqual([false, true, false]);
    expect([sw("pg-mcp-srv1").getAttribute("aria-checked"), sw("pg-mcp-srv2").getAttribute("aria-checked")]).toEqual(["true", "false"]);
  });

  test("switching a plugin posts the toggle, re-reads the inventory and reports on that row", async () => {
    let enabled = true;
    await mountPage();
    routes["POST /api/plugins/toggle"] = (b) => { enabled = b.enabled; return { ok: true }; };
    routes["/api/ecosystem"] = () => ({ ...ECO(), plugins: [{ ...ECO().plugins[0], enabled }, ...ECO().plugins.slice(1)] });
    const getsBefore = calls.gets.length;
    sw("pg-plugin-foo@market").click();
    await flush();
    expect(calls.posts).toEqual([["/api/plugins/toggle", { key: "foo@market", enabled: false }]]);
    expect(calls.gets.slice(getsBefore)).toEqual(["/api/ecosystem"]);
    const row = ecoRow("eco:plugin:foo@market");
    expect(savedOf(row).textContent).toBe("Disabled. Restart Claude Code to apply.");
    expect(savedOf(row).className).toBe("pg-saved is-ok");
    expect(sw("pg-plugin-foo@market").getAttribute("aria-checked")).toBe("false");
  });

  test("while a toggle is in flight the switch is disabled and a second click does nothing", async () => {
    await mountPage();
    const d = defer();
    routes["POST /api/plugins/toggle"] = () => d.p;
    sw("pg-plugin-foo@market").click();
    await flush();
    expect(sw("pg-plugin-foo@market").disabled).toBe(true);
    sw("pg-plugin-foo@market").click();
    await flush();
    expect(calls.posts.length).toBe(1);
    d.res({ ok: true });
    await flush();
    expect(sw("pg-plugin-foo@market").disabled).toBeFalsy();
  });

  test("switching an mcp server on says Enabled; the post carries the server name", async () => {
    await mountPage(ecoOver({ mcp: { servers: [{ name: "off1", origin: "user", transport: "stdio", enabled: false }] } }));
    ecoTab("mcp").click();
    sw("pg-mcp-off1").click();
    await flush();
    expect(calls.posts).toEqual([["/api/mcp/toggle", { name: "off1", enabled: true }]]);
    expect(savedOf(ecoRow("eco:mcp:off1")).textContent).toBe("Enabled. Restart Claude Code to apply.");
  });

  test("a refused toggle (200 with ok false, or a thrown error) says Not changed and keeps the switch", async () => {
    await mountPage();
    routes["POST /api/plugins/toggle"] = { ok: false, error: "locked", why: "settings.json is read-only", hint: "chmod it" };
    const gets = calls.gets.length;
    sw("pg-plugin-foo@market").click();
    await flush();
    const row = ecoRow("eco:plugin:foo@market");
    expect(savedOf(row).textContent).toBe("Not changed: locked — settings.json is read-only — chmod it");
    expect(savedOf(row).className).toBe("pg-saved is-fail");
    expect(calls.gets.length).toBe(gets);
    expect(sw("pg-plugin-foo@market").disabled).toBeFalsy();
    routes["POST /api/plugins/toggle"] = Object.assign(new Error("net"), { status: 404 });
    sw("pg-plugin-foo@market").click();
    await flush();
    expect(savedOf(ecoRow("eco:plugin:foo@market")).textContent).toBe("Not changed: Endpoint not available");
  });

  test("tabs switch the list, clear the search and offer a matching placeholder", async () => {
    await mountPage();
    ecoTab("skills").click();
    expect(ecoTab("skills").className).toBe("pg-tab is-active");
    expect(ecoTab("plugins").className).toBe("pg-tab");
    expect(ecoRows().map((r) => [r.querySelector("span.pg-row-title").textContent, r.querySelector("p.pg-mono").textContent])).toEqual([["sk1", "atlas plugin"], ["sk2", "atlas plugin"]]);
    const search = byId("pg-eco-search");
    expect([search.getAttribute("placeholder"), search.getAttribute("aria-label"), search.getAttribute("type")]).toEqual(["Search atlas skills", "Search Atlas skills", "search"]);
    ecoTab("uhooks").click();
    expect(ecoRows().map((r) => [r.querySelector("span.pg-row-title").textContent, r.querySelector("p.pg-mono").textContent])).toEqual([["Stop", "~/.claude/settings.json hooks"]]);
    ecoTab("uagents").click();
    expect($$("#pg-sec-ecosystem ul.pg-rows").length).toBe(0);
    expect(texts("#pg-sec-ecosystem p.pg-hint")).toContain("No user agents found.");
    fire(byId("pg-eco-search"), "input", { target: { value: "x" } });
    ecoTab("uskills").click();
    expect(byId("pg-eco-search").value).toBe("");
    expect(ecoRows().map((r) => r.querySelector("span.pg-row-title").textContent)).toEqual(["u1"]);
    ecoTab("agents").click();
    expect(ecoRows().map((r) => r.querySelector("span.pg-row-title").textContent)).toEqual(["ag1"]);
  });

  test("output styles badge the active one; hook wirings show matcher, script, timeout and whether the script exists", async () => {
    await mountPage();
    ecoTab("styles").click();
    const rows = ecoRows();
    expect(rows.map((r) => r.querySelector("span.pg-row-title").textContent)).toEqual(["terse", "wordy"]);
    expect(rows[0].querySelector("span.badge").textContent).toBe("active");
    expect(rows[1].querySelector("span.badge")).toBeNull();
    ecoTab("bindings").click();
    const b = ecoRows();
    expect(b.map((r) => r.querySelector("span.pg-row-title").textContent)).toEqual(["PreToolUse [Bash]", "Stop"]);
    expect(b.map((r) => r.querySelector("p.pg-mono").textContent)).toEqual(["a.py · timeout 5s", "b.py"]);
    expect(b.map((r) => r.querySelector("span.badge").textContent)).toEqual(["wired", "script missing"]);
    expect(b.map((r) => r.querySelector("span.badge").attrs["data-status"])).toEqual(["ok", "fail"]);
  });

  test("with no atlas output style the user's active style is the badged one", async () => {
    await mountPage(ecoOver({ atlas: { output_styles: ["terse", "plain"] }, user: { active_output_style: "plain" } }));
    ecoTab("styles").click();
    expect(ecoRows().map((r) => !!r.querySelector("span.badge"))).toEqual([false, true]);
  });

  test("the search filters the current tab, ignoring case and surrounding spaces, over key, name and description", async () => {
    await mountPage();
    const typed = (v) => fire(byId("pg-eco-search"), "input", { target: { value: v } });
    typed("  FOO ");
    expect(ecoRows().length).toBe(1);
    expect(byId("pg-eco-search").value).toBe("  FOO ");
    typed("a foo plug");
    expect(ecoRows().map((r) => r.getAttribute("data-eco") || r.dataset.eco)).toEqual(["eco:plugin:foo@market"]);
    typed("market");
    expect(ecoRows().length).toBe(3);
    typed("bar@");
    expect(ecoRows().length).toBe(1);
    typed("zzz");
    expect(ecoRows().length).toBe(0);
    expect(texts("#pg-sec-ecosystem p.pg-hint")).toContain("Nothing in plugins matches “zzz”.");
    typed("");
    expect(ecoRows().length).toBe(3);
    ecoTab("mcp").click();
    typed("settings.json");
    expect(ecoRows().map((r) => r.querySelector("span.pg-row-title").textContent)).toEqual(["srv1"]);
    typed("PLUGIN");
    expect(ecoRows().map((r) => r.querySelector("span.pg-row-title").textContent)).toEqual(["srv2", "srv3"]);
    ecoTab("bindings").click();
    typed("b.py");
    expect(ecoRows().length).toBe(1);
    typed("bash");
    expect(ecoRows().length).toBe(1);
  });

  test("long lists show a page of 100 at a time with a Show more button", async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ key: "p" + i + "@m", name: "P" + i, enabled: true, installed: true }));
    await mountPage(ecoOver({ plugins: many }));
    expect(ecoRows().length).toBe(100);
    const note = () => $$("#pg-sec-ecosystem p.pg-hint").find((p) => p.textContent.startsWith("Showing"));
    expect(note().textContent).toBe("Showing 100 of 250. Show more");
    btn("Show more", note()).click();
    expect(ecoRows().length).toBe(200);
    expect(note().textContent).toBe("Showing 200 of 250. Show more");
    btn("Show more", note()).click();
    expect(ecoRows().length).toBe(250);
    expect(note()).toBeUndefined();
    fire(byId("pg-eco-search"), "input", { target: { value: "P1" } });
    expect(ecoRows().length).toBe(100);
    expect(note().textContent).toBe("Showing 100 of 111. Show more");
  });

  test("a search resets the page size back to 100", async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ key: "p" + i + "@m", name: "P" + i, enabled: true, installed: true }));
    await mountPage(ecoOver({ plugins: many }));
    btn("Show more").click();
    expect(ecoRows().length).toBe(200);
    fire(byId("pg-eco-search"), "input", { target: { value: "p" } });
    expect(ecoRows().length).toBe(100);
    expect($$("#pg-sec-ecosystem p.pg-hint").find((p) => p.textContent.startsWith("Showing")).textContent).toBe("Showing 100 of 250. Show more");
  });

  test("a failing ecosystem route becomes an error card with Retry that reloads everything", async () => {
    await mountPage({ routes: { "/api/ecosystem": Object.assign(new Error("x"), { error: "boom", why: "disk gone", do: "restart", hint: "soon" }) } });
    const card = byId("pg-sec-ecosystem");
    expect(card.textContent).toContain("Ecosystem unavailable: boom");
    expect(card.textContent).toContain("disk gone — restart — soon");
    expect(ecoRows().length).toBe(0);
    routes["/api/ecosystem"] = ECO();
    const gets = calls.gets.length;
    btn("Retry", card).click();
    await flush();
    expect(calls.gets.length - gets).toBe(8);
    expect(ecoRows().length).toBe(3);
  });

  test("error wording: 404 is Endpoint not available, no detail says the route did not answer", async () => {
    await mountPage({ routes: { "/api/ecosystem": Object.assign(new Error("x"), { status: 404, error: "ignored" }) } });
    expect(byId("pg-sec-ecosystem").textContent).toContain("Ecosystem unavailable: Endpoint not available");
    expect(byId("pg-sec-ecosystem").textContent).toContain("The route did not answer.");
    await mountPage({ routes: { "/api/ecosystem": new Error("plain message") } });
    expect(byId("pg-sec-ecosystem").textContent).toContain("Ecosystem unavailable: plain message");
    await mountPage({ routes: { "/api/ecosystem": Object.assign(new Error(""), {}) } });
    expect(byId("pg-sec-ecosystem").textContent).toContain("Ecosystem unavailable: Request failed");
  });

  test("a section that never answers times out after 15 seconds with a named error", async () => {
    ctx = mkCtx({ routes: { "/api/ecosystem": () => new Promise(() => {}) } });
    await page.load(ctx);
    body.replaceChildren(page.render(ctx));
    await flush();
    expect(byId("pg-sec-ecosystem").textContent).toContain("Loading…");
    expect(byId("pg-sec-ecosystem").querySelector("p.pg-hint").getAttribute("role")).toBe("status");
    const fifteen = timers.list.filter((t) => t.ms === 15000);
    expect(fifteen.length).toBeGreaterThanOrEqual(6);
    for (const t of fifteen) t.fn();
    await flush();
    expect(byId("pg-sec-ecosystem").textContent).toContain("Ecosystem unavailable: timed_out");
    expect(byId("pg-sec-ecosystem").textContent).toContain("ecosystem did not answer within 15s.");
    expect(timers.cleared.length).toBeGreaterThan(0);
  });

  test("Retry after the page was destroyed does nothing", async () => {
    await mountPage({ routes: { "/api/ecosystem": new Error("x") } });
    const retry = btn("Retry", byId("pg-sec-ecosystem"));
    page.destroy();
    const gets = calls.gets.length;
    retry.click();
    await flush();
    expect(calls.gets.length).toBe(gets);
  });
});

// ---------------------------------------------------------------------------------------------
const connRow = (name) => $$("li").find((li) => li.dataset && li.dataset.connector === name);
const connOver = (list, extra = {}) => ({ routes: { "/api/connectors": { settings_path: "/s.json", connectors: list, ...extra } } });
const mkConn = (over = {}) => ({ name: "c1", server_name: "c1-mcp", enabled: true, health: "ok", bundle_exists: true, configured_hint: true, usage: {}, missing_required: [], fields: [], ...over });
const credInput = (id) => $$("input").find((i) => i.attrs.id === id);
const typeInto = (input, v) => { input.value = v; fire(input, "input", { target: input }); };
let realNow;
const freezeNow = (ms) => { realNow = Date.now; Date.now = () => ms; };
afterEach(() => { if (realNow) { Date.now = realNow; realNow = null; } });

describe("connectors", () => {
  test("the card title counts configured and degraded connectors and shows the settings path", async () => {
    await mountPage();
    expect($("#pg-sec-connectors h2").textContent).toBe("Connectors (1/3 configured, 1 degraded)");
    expect($("#pg-sec-connectors div.card-actions span.pg-hint").textContent).toBe("/home/a/.claude/settings.json");
    await mountPage(connOver([mkConn(), mkConn({ name: "c2" })]));
    expect($("#pg-sec-connectors h2").textContent).toBe("Connectors (2/2 configured)");
    await mountPage(connOver([mkConn({ configured_hint: false, health: "degraded" }), mkConn({ name: "c2", health: "degraded", configured_hint: false })]));
    expect($("#pg-sec-connectors h2").textContent).toBe("Connectors (0/2 configured, 2 degraded)");
  });

  test("no settings path leaves the corner empty and no connectors says so", async () => {
    await mountPage({ routes: { "/api/connectors": { connectors: [] } } });
    expect($("#pg-sec-connectors div.card-actions span.pg-hint").textContent).toBe("");
    expect(texts("#pg-sec-connectors p.pg-hint")).toContain("No connectors declared.");
    expect($$("#pg-sec-connectors li").length).toBe(0);
    expect($("#pg-sec-connectors h2").textContent).toBe("Connectors (0/0 configured)");
  });

  test("the intro explains what Test proves and that secrets are never shown", async () => {
    await mountPage();
    const t = texts("#pg-sec-connectors p.pg-hint").find((x) => x.startsWith("Vendor connectors"));
    expect(t).toContain("Saved credentials are never shown or read back");
    expect(t).toContain("Only fields you changed are sent.");
    expect(t).toContain("it proves the bundle runs, not that vendor credentials are accepted");
  });

  test("health maps to a word and status; a missing bundle overrides it; unknown health shows its own text", async () => {
    await mountPage(connOver([
      mkConn({ name: "a", health: "ok" }), mkConn({ name: "b", health: "idle" }), mkConn({ name: "c", health: "degraded" }), mkConn({ name: "d", health: "unconfigured" }),
      mkConn({ name: "e", health: "disabled" }), mkConn({ name: "f", health: "weird" }), mkConn({ name: "g", health: undefined }), mkConn({ name: "h", health: "ok", bundle_exists: false }),
    ]));
    const badge = (n) => { const b = connRow(n).querySelector("span.pg-row-title span.badge"); return [b.attrs["data-status"], b.textContent]; };
    expect(["a", "b", "c", "d", "e", "f", "g", "h"].map(badge)).toEqual([
      ["ok", "healthy"], ["info", "configured, unused"], ["fail", "degraded"], ["warn", "needs credentials"], ["idle", "disabled"], ["idle", "weird"], ["idle", "unknown"], ["fail", "bundle missing"],
    ]);
    expect(connRow("c").querySelector("span.dot").attrs["data-status"]).toBe("fail");
    expect(connRow("h").querySelector("span.dot").attrs["data-status"]).toBe("fail");
    expect(connRow("a").querySelector("span.dot").attrs["data-status"]).toBe("ok");
  });

  test("the usage line reports calls, failures, totals and when it was last used", async () => {
    freezeNow(1_700_000_000_000);
    const now = 1_700_000_000;
    const u = (over) => ({ calls: 3, calls_total: 10, window_days: 7, errors: 1, error_rate: 0.333, last_used: now - 7200, ...over });
    await mountPage(connOver([
      mkConn({ name: "a", usage: u() }), mkConn({ name: "b", usage: u({ calls: 1, errors: 0, error_rate: 0, last_used: undefined }) }),
      mkConn({ name: "c", usage: u({ calls: 0, errors: 0, last_used: now - 30 }) }), mkConn({ name: "d", usage: {} }), mkConn({ name: "e", usage: undefined }),
      mkConn({ name: "f", usage: u({ error_rate: undefined, calls: 2 }) }),
    ]));
    const line = (n) => connRow(n).querySelector("div.pg-row-main p.pg-hint").textContent;
    expect(line("a")).toBe("3 calls in 7d (1 failed, 33% errors) · 10 total · last used 2h ago");
    expect(line("b")).toBe("1 call in 7d (0 failed, 0% errors) · 10 total · last used unknown");
    expect(line("c")).toBe("0 calls in 7d (0 failed, no calls in window) · 10 total · last used 1m ago");
    expect(line("d")).toBe("Never called in recorded sessions.");
    expect(line("e")).toBe("Never called in recorded sessions.");
    expect(line("f")).toBe("2 calls in 7d (1 failed, 0% errors) · 10 total · last used 2h ago");
    expect(connRow("a").querySelector("div.pg-row-main p.pg-hint").className).toBe("pg-hint pg-mono");
    expect(connRow("d").querySelector("div.pg-row-main p.pg-hint").className).toBe("pg-hint");
  });

  test("last used is shown in minutes below an hour, hours below a day, days after", async () => {
    freezeNow(1_700_000_000_000);
    const now = 1_700_000_000;
    const at = (secs) => ({ calls: 1, calls_total: 1, window_days: 1, errors: 0, error_rate: 0, last_used: now - secs });
    const cases = [[0, "1m ago"], [29, "1m ago"], [90, "2m ago"], [600, "10m ago"], [3599, "60m ago"], [3600, "1h ago"], [5400, "2h ago"], [86399, "24h ago"], [86400, "1d ago"], [3 * 86400, "3d ago"], [-500, "1m ago"]];
    await mountPage(connOver(cases.map(([secs], i) => mkConn({ name: "k" + i, usage: at(secs) }))));
    const got = cases.map((_c, i) => connRow("k" + i).querySelector("div.pg-row-main p.pg-hint").textContent.split("last used ")[1]);
    expect(got).toEqual(cases.map((c) => c[1]));
  });

  test("required fields that are missing are listed", async () => {
    await mountPage();
    expect(connRow("ninja").querySelectorAll("div.pg-row-main p.pg-hint").map((p) => p.textContent)).toContain("Missing: NINJA_KEY.");
    expect(connRow("vanta").querySelectorAll("div.pg-row-main p.pg-hint").map((p) => p.textContent).some((t) => t.startsWith("Missing"))).toBe(false);
    await mountPage(connOver([mkConn({ missing_required: ["A", "B"] }), mkConn({ name: "z", missing_required: undefined })]));
    expect(connRow("c1").querySelectorAll("div.pg-row-main p.pg-hint").map((p) => p.textContent)).toContain("Missing: A, B.");
  });

  test("credential fields: text for plain keys, password for secrets, placeholders and source labels", async () => {
    await mountPage();
    const id = credInput("pg-cred-vanta-VANTA_ID");
    expect([id.attrs.type, id.value, id.attrs.placeholder, id.attrs.autocomplete, id.attrs.spellcheck, id.attrs["aria-label"]]).toEqual(["text", "abc", "", "off", "false", "vanta Client id"]);
    const secret = credInput("pg-cred-vanta-vanta_secret");
    expect([secret.attrs.type, secret.value, secret.attrs.placeholder, secret.attrs.autocomplete, secret.attrs["aria-label"]]).toEqual(["password", "", "set — type to replace", "new-password", "vanta Secret"]);
    const unset = credInput("pg-cred-ninja-NINJA_KEY");
    expect([unset.attrs.type, unset.attrs.placeholder]).toEqual(["password", "enter secret"]);
    const labels = connRow("vanta").querySelectorAll("label.pg-cred-label");
    expect(labels.map((l) => l.getAttribute("for"))).toEqual(["pg-cred-vanta-VANTA_ID", "pg-cred-vanta-vanta_secret", "pg-cred-vanta-VANTA_FLAG"]);
    expect(labels.map((l) => l.querySelector("span.pg-mono").textContent)).toEqual(["VANTA_ID", "VANTA_SECRET", "VANTA_FLAG"].map((_k, i) => ["VANTA_ID", "vanta_secret", "VANTA_FLAG"][i]));
    expect(labels.map((l) => l.querySelector("span.badge").textContent)).toEqual(["set", "set", "set"]);
    expect(labels.map((l) => l.querySelectorAll("span.pg-hint").map((x) => x.textContent))).toEqual([["· env"], ["· keychain"], []]);
    expect(connRow("ninja").querySelector("label.pg-cred-label span.badge").textContent).toBe("missing");
    expect(connRow("ninja").querySelector("label.pg-cred-label span.badge").attrs["data-status"]).toBe("warn");
    expect(connRow("vanta").querySelector("div.pg-cred-fields p.pg-hint").textContent).toBe("Who you are");
    expect(connRow("vanta").querySelector("div.pg-cred-fields").getAttribute("aria-label")).toBe("vanta credentials");
  });

  test("a plain unset field says not set; fields without a key are skipped; none declared says so", async () => {
    await mountPage(connOver([mkConn({ fields: [{ env_key: "K1", title: "One", is_set: false, value: "" }, { title: "No key" }, { env_key: "K2", is_set: true, value: "v" }] }), mkConn({ name: "bare", fields: [] }), mkConn({ name: "nof", fields: undefined })]));
    expect(credInput("pg-cred-c1-K1").attrs.placeholder).toBe("not set");
    expect(credInput("pg-cred-c1-K2").attrs["aria-label"]).toBe("c1 K2");
    expect(connRow("c1").querySelectorAll("label.pg-cred-label").length).toBe(2);
    expect(connRow("bare").querySelector("p.pg-cred-none").textContent).toBe("No credential fields declared for this connector.");
    expect(connRow("bare").querySelector("div.pg-cred-fields")).toBeNull();
    expect(connRow("nof").querySelector("p.pg-cred-none")).not.toBeNull();
    expect(connRow("c1").querySelector("p.pg-cred-none")).toBeNull();
  });

  test("odd characters in names are replaced in the input ids", async () => {
    await mountPage(connOver([mkConn({ name: "a b.c", fields: [{ env_key: "K 1", value: "" }] })]));
    expect(credInput("pg-cred-a_b_c-K_1")).toBeDefined();
  });

  test("a boolean field is a switch that follows its value", async () => {
    await mountPage();
    const flag = sw("pg-cred-vanta-VANTA_FLAG");
    expect([flag.getAttribute("role"), flag.getAttribute("aria-checked"), flag.getAttribute("aria-label")]).toEqual(["switch", "true", "vanta Flag"]);
    await mountPage(connOver([mkConn({ fields: [{ env_key: "B", title: "B", type: "bool", is_set: true, value: "false" }, { env_key: "C", type: "bool", is_set: false, value: "" }] })]));
    expect(sw("pg-cred-c1-B").getAttribute("aria-checked")).toBe("false");
    expect(sw("pg-cred-c1-C").getAttribute("aria-checked")).toBe("true");
    expect(sw("pg-cred-c1-C").getAttribute("aria-label")).toBe("c1 C");
  });

  test("toggling a boolean makes a draft, toggling it back clears it", async () => {
    await mountPage();
    sw("pg-cred-vanta-VANTA_FLAG").click();
    expect(sw("pg-cred-vanta-VANTA_FLAG").getAttribute("aria-checked")).toBe("false");
    expect(byId("pg-cred-dirty").hidden).toBe(false);
    expect(connRow("vanta").querySelector("span.pg-cred-edited").hidden).toBe(false);
    sw("pg-cred-vanta-VANTA_FLAG").click();
    expect(sw("pg-cred-vanta-VANTA_FLAG").getAttribute("aria-checked")).toBe("true");
    expect(byId("pg-cred-dirty").hidden).toBe(true);
    expect(winListeners.beforeunload || []).toEqual([]);
  });

  test("typing makes a draft: the banner, edited badge and buttons light up and the leave guard is wired", async () => {
    await mountPage();
    expect(byId("pg-cred-dirty").hidden).toBe(true);
    expect(byId("pg-cred-dirty").textContent).toBe("Unsaved credential edits. Save or Revert each connector before leaving; the browser will also ask before reload or close.");
    expect(connRow("vanta").querySelector("span.pg-cred-edited").hidden).toBe(true);
    const save = connRow("vanta").querySelector("button[data-cred-action=\"save\"]");
    const revert = connRow("vanta").querySelector("button[data-cred-action=\"revert\"]");
    expect([save.disabled, revert.disabled]).toEqual([true, true]);
    expect(save.getAttribute("aria-label")).toBe("Save credentials for vanta");
    expect(revert.getAttribute("aria-label")).toBe("Discard unsaved edits for vanta");
    typeInto(credInput("pg-cred-vanta-VANTA_ID"), "xyz");
    expect(byId("pg-cred-dirty").hidden).toBe(false);
    expect(connRow("vanta").querySelector("span.pg-cred-edited").hidden).toBe(false);
    expect([save.disabled, revert.disabled]).toEqual([false, false]);
    expect(connRow("ninja").querySelector("span.pg-cred-edited").hidden).toBe(true);
    expect(connRow("ninja").querySelector("button[data-cred-action=\"save\"]").disabled).toBe(true);
    expect((winListeners.beforeunload || []).length).toBe(1);
    expect((docListeners.click || []).length).toBe(1);
    typeInto(credInput("pg-cred-vanta-VANTA_ID"), "xyz2");
    expect((winListeners.beforeunload || []).length).toBe(1);
    typeInto(credInput("pg-cred-vanta-VANTA_ID"), "abc");
    expect(byId("pg-cred-dirty").hidden).toBe(true);
    expect([save.disabled, revert.disabled]).toEqual([true, true]);
    expect(winListeners.beforeunload).toEqual([]);
    expect(docListeners.click).toEqual([]);
  });

  test("the dirty-draft guard asks before reload and before leaving through a sidebar link", async () => {
    await mountPage();
    const unload = () => { const ev = { type: "beforeunload", preventDefault() { this.prevented = true; } }; (winListeners.beforeunload || []).forEach((f) => f(ev)); return ev; };
    expect(unload().prevented).toBeUndefined();
    typeInto(credInput("pg-cred-vanta-VANTA_ID"), "xyz");
    const ev = unload();
    expect([ev.prevented, ev.returnValue]).toEqual([true, ""]);
    const link = (href, page) => { const a = document.createElement("a"); a.setAttribute("href", href); if (page) a.dataset.page = page; body.appendChild(a); return a; };
    const click = (target) => { const ev2 = { type: "click", target, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; docListeners.click.forEach((f) => f(ev2)); return ev2; };
    confirmAnswer = false;
    const stay = click(link("#/health"));
    expect([stay.prevented, stay.stopped]).toEqual([true, true]);
    expect(confirmLog).toEqual(["Unsaved credential edits on Settings will be lost. Leave this page anyway?"]);
    confirmAnswer = true;
    const leave = click(link("#/agents"));
    expect([leave.prevented, leave.stopped]).toEqual([undefined, undefined]);
    expect(confirmLog.length).toBe(2);
    confirmAnswer = false;
    const same = click(link("#/settings", "settings"));
    expect(same.prevented).toBeUndefined();
    const ext = click(link("https://example.com/"));
    expect(ext.prevented).toBeUndefined();
    const plain = click(document.createElement("div"));
    expect(plain.prevented).toBeUndefined();
    const noTarget = click(undefined);
    expect(noTarget.prevented).toBeUndefined();
    expect(confirmLog.length).toBe(2);
  });

  test("the guard is removed when the page is destroyed or loaded again, and ignores events afterwards", async () => {
    await mountPage();
    typeInto(credInput("pg-cred-vanta-VANTA_ID"), "xyz");
    const unloadFns = (winListeners.beforeunload || []).slice();
    page.destroy();
    expect(winListeners.beforeunload).toEqual([]);
    expect(docListeners.click).toEqual([]);
    const ev = { type: "beforeunload", preventDefault() { this.prevented = true; } };
    unloadFns.forEach((f) => f(ev));
    expect(ev.prevented).toBeUndefined();
    page.destroy();
    await mountPage();
    typeInto(credInput("pg-cred-vanta-VANTA_ID"), "xyz");
    expect(winListeners.beforeunload.length).toBe(1);
    ctx = mkCtx();
    await page.load(ctx);
    expect(winListeners.beforeunload).toEqual([]);
  });

  test("revert drops the drafts for that connector and restores the saved values", async () => {
    await mountPage();
    typeInto(credInput("pg-cred-vanta-VANTA_ID"), "xyz");
    typeInto(credInput("pg-cred-vanta-vanta_secret"), "s3");
    btn("Revert", connRow("vanta")).click();
    expect(credInput("pg-cred-vanta-VANTA_ID").value).toBe("abc");
    expect(credInput("pg-cred-vanta-vanta_secret").value).toBe("");
    expect(byId("pg-cred-dirty").hidden).toBe(true);
    expect(winListeners.beforeunload).toEqual([]);
  });

  test("a draft survives a redraw of its row", async () => {
    await mountPage();
    typeInto(credInput("pg-cred-vanta-VANTA_ID"), "xyz");
    routes["POST /api/connectors/test"] = { ok: true };
    btn("Test", connRow("vanta")).click();
    await flush();
    expect(credInput("pg-cred-vanta-VANTA_ID").value).toBe("xyz");
    expect(connRow("vanta").querySelector("span.pg-cred-edited").hidden).toBe(false);
    expect(connRow("vanta").querySelector("button[data-cred-action=\"save\"]").disabled).toBe(false);
  });

  test("saving sends only the changed keys, re-reads the connectors and reports the saved keys", async () => {
    await mountPage();
    typeInto(credInput("pg-cred-vanta-VANTA_ID"), "xyz");
    typeInto(credInput("pg-cred-vanta-vanta_secret"), "s3");
    routes["POST /api/connectors/env"] = { ok: true, updated_user_config_keys: ["vanta_secret"], updated_env_keys: ["VANTA_ID", "vanta_secret"] };
    const gets = calls.gets.length;
    btn("Save", connRow("vanta")).click();
    await flush();
    expect(calls.posts).toEqual([["/api/connectors/env", { updates: { VANTA_ID: "xyz", vanta_secret: "s3" } }]]);
    expect(calls.gets.slice(gets)).toEqual(["/api/connectors"]);
    const msg = savedOf(connRow("vanta"));
    expect(msg.textContent).toBe("Saved vanta_secret, VANTA_ID. Restart Claude Code so the server re-reads credentials.");
    expect(msg.className).toBe("pg-saved is-ok");
    expect(byId("pg-cred-dirty").hidden).toBe(true);
    expect(winListeners.beforeunload).toEqual([]);
    expect(connRow("vanta").querySelector("button[data-cred-action=\"save\"]").disabled).toBe(true);
  });

  test("without a read-back list the saved message names the keys that were sent", async () => {
    await mountPage();
    typeInto(credInput("pg-cred-vanta-VANTA_ID"), "xyz");
    btn("Save", connRow("vanta")).click();
    await flush();
    expect(savedOf(connRow("vanta")).textContent).toBe("Saved VANTA_ID. Restart Claude Code so the server re-reads credentials.");
  });

  test("a drafted key from another connector stays drafted when this one is saved", async () => {
    await mountPage();
    typeInto(credInput("pg-cred-vanta-VANTA_ID"), "xyz");
    typeInto(credInput("pg-cred-ninja-NINJA_KEY"), "n1");
    btn("Save", connRow("ninja")).click();
    await flush();
    expect(calls.posts[0][1]).toEqual({ updates: { NINJA_KEY: "n1" } });
    expect(byId("pg-cred-dirty").hidden).toBe(false);
    expect(connRow("vanta").querySelector("span.pg-cred-edited").hidden).toBe(false);
  });

  test("saving with nothing changed only tells you so", async () => {
    await mountPage();
    btn("Save", connRow("vanta")).click();
    await flush();
    expect(calls.posts).toEqual([]);
    expect(calls.toasts).toEqual([["Nothing changed for vanta.", "info"]]);
  });

  test("a failed save keeps the drafts and says Not saved with the reason", async () => {
    await mountPage();
    typeInto(credInput("pg-cred-vanta-VANTA_ID"), "xyz");
    routes["POST /api/connectors/env"] = { ok: false, error: "readonly", why: "no keychain" };
    btn("Save", connRow("vanta")).click();
    await flush();
    const msg = savedOf(connRow("vanta"));
    expect([msg.textContent, msg.className]).toEqual(["Not saved: readonly — no keychain", "pg-saved is-fail"]);
    expect(credInput("pg-cred-vanta-VANTA_ID").value).toBe("xyz");
    expect(byId("pg-cred-dirty").hidden).toBe(false);
  });

  test("a second save while one is running is ignored and the buttons show Saving…", async () => {
    await mountPage();
    typeInto(credInput("pg-cred-vanta-VANTA_ID"), "xyz");
    const d = defer();
    routes["POST /api/connectors/env"] = () => d.p;
    btn("Save", connRow("vanta")).click();
    await flush();
    const saving = btn("Saving…", connRow("vanta"));
    expect(saving.disabled).toBe(true);
    expect(connRow("vanta").querySelector("button[data-cred-action=\"revert\"]").disabled).toBe(true);
    saving.click();
    await flush();
    expect(calls.posts.length).toBe(1);
    d.res({ ok: true });
    await flush();
    expect(btn("Save", connRow("vanta"))).toBeDefined();
  });

  test("Test starts the handshake, shows Testing… meanwhile and then the result", async () => {
    await mountPage();
    const d = defer();
    routes["POST /api/connectors/test"] = () => d.p;
    btn("Test", connRow("vanta")).click();
    await flush();
    const testing = btn("Testing…", connRow("vanta"));
    expect(testing.disabled).toBe(true);
    testing.click();
    await flush();
    expect(calls.posts).toEqual([["/api/connectors/test", { name: "vanta" }]]);
    d.res({ ok: true, tool_count: 4, elapsed_ms: 120, note: "bundle runs" });
    await flush();
    const line = connRow("vanta").querySelector("p.pg-test");
    expect([line.textContent, line.className, line.getAttribute("role")]).toEqual(["Handshake ok — 4 tools in 120ms. bundle runs", "pg-test is-ok", "status"]);
    expect(btn("Test", connRow("vanta")).disabled).toBeFalsy();
  });

  test("handshake text without counts or notes is short; failures show error and hint", async () => {
    await mountPage();
    routes["POST /api/connectors/test"] = { ok: true };
    btn("Test", connRow("vanta")).click();
    await flush();
    expect(connRow("vanta").querySelector("p.pg-test").textContent).toBe("Handshake ok.");
    routes["POST /api/connectors/test"] = { ok: true, tool_count: 0, elapsed_ms: 0 };
    btn("Test", connRow("vanta")).click();
    await flush();
    expect(connRow("vanta").querySelector("p.pg-test").textContent).toBe("Handshake ok — 0 tools in 0ms.");
    routes["POST /api/connectors/test"] = { ok: false, error: "spawn failed", hint: "check node" };
    btn("Test", connRow("vanta")).click();
    await flush();
    const line = connRow("vanta").querySelector("p.pg-test");
    expect([line.textContent, line.className]).toEqual(["Test failed: spawn failed — check node", "pg-test is-fail"]);
    routes["POST /api/connectors/test"] = { ok: false };
    btn("Test", connRow("vanta")).click();
    await flush();
    expect(connRow("vanta").querySelector("p.pg-test").textContent).toBe("Test failed: unknown");
  });

  test("a test request that throws is shown as a failed test", async () => {
    await mountPage();
    routes["POST /api/connectors/test"] = Object.assign(new Error("net"), { error: "offline", why: "no route", do: "retry" });
    btn("Test", connRow("vanta")).click();
    await flush();
    expect(connRow("vanta").querySelector("p.pg-test").textContent).toBe("Test failed: offline — no route — retry");
    expect(connRow("ninja").querySelector("p.pg-test")).toBeNull();
  });

  test("starting a new test clears the old result first", async () => {
    await mountPage();
    routes["POST /api/connectors/test"] = { ok: true };
    btn("Test", connRow("vanta")).click();
    await flush();
    const d = defer();
    routes["POST /api/connectors/test"] = () => d.p;
    btn("Test", connRow("vanta")).click();
    await flush();
    expect(connRow("vanta").querySelector("p.pg-test")).toBeNull();
    d.res({ ok: false, error: "x" });
    await flush();
  });

  test("the connector switch toggles the mcp server by its server name and reports on that row", async () => {
    await mountPage();
    const s = sw("pg-conn-vanta");
    expect([s.getAttribute("aria-checked"), s.getAttribute("aria-label")]).toEqual(["true", "Enable connector vanta"]);
    expect(sw("pg-conn-ninja").getAttribute("aria-checked")).toBe("false");
    routes["/api/connectors"] = () => ({ ...CONNECTORS(), connectors: CONNECTORS().connectors.map((c) => (c.name === "vanta" ? { ...c, enabled: false } : c)) });
    const d = defer();
    routes["POST /api/mcp/toggle"] = () => d.p;
    s.click();
    await flush();
    expect(sw("pg-conn-vanta").disabled).toBe(true);
    sw("pg-conn-vanta").click();
    await flush();
    expect(calls.posts).toEqual([["/api/mcp/toggle", { name: "vanta-mcp", enabled: false }]]);
    d.res({ ok: true });
    await flush();
    expect(savedOf(connRow("vanta")).textContent).toBe("Disabled. Restart Claude Code to apply.");
    expect(sw("pg-conn-vanta").getAttribute("aria-checked")).toBe("false");
    expect(sw("pg-conn-vanta").disabled).toBeFalsy();
  });

  test("enabling says Enabled and a refused toggle says Not changed", async () => {
    await mountPage();
    routes["POST /api/mcp/toggle"] = { ok: true };
    sw("pg-conn-ninja").click();
    await flush();
    expect(calls.posts[0]).toEqual(["/api/mcp/toggle", { name: "ninja-mcp", enabled: true }]);
    expect(savedOf(connRow("ninja")).textContent).toBe("Enabled. Restart Claude Code to apply.");
    routes["POST /api/mcp/toggle"] = { ok: false, error: "denied", why: "locked" };
    sw("pg-conn-ninja").click();
    await flush();
    const msg = savedOf(connRow("ninja"));
    expect([msg.textContent, msg.className]).toEqual(["Not changed: denied — locked", "pg-saved is-fail"]);
    expect(sw("pg-conn-ninja").disabled).toBeFalsy();
  });

  test("a redraw updates the card title count", async () => {
    await mountPage();
    routes["POST /api/mcp/toggle"] = { ok: true };
    routes["/api/connectors"] = { connectors: [mkConn({ name: "vanta", server_name: "vanta-mcp", health: "degraded", configured_hint: false })] };
    sw("pg-conn-vanta").click();
    await flush();
    expect($("#pg-sec-connectors h2").textContent).toBe("Connectors (0/1 configured, 1 degraded)");
  });

  test("a failing connectors route is an error card and the other sections still render", async () => {
    await mountPage({ routes: { "/api/connectors": Object.assign(new Error("x"), { error: "nope", why: "bad json" }) } });
    expect(byId("pg-sec-connectors").textContent).toContain("Connectors unavailable: nope");
    expect(byId("pg-sec-connectors").textContent).toContain("bad json");
    expect(ecoRows().length).toBe(3);
    expect($("#st-tab-integrations span.st-count").textContent).toBe("6");
  });

  test("while connectors are loading the card says Loading…", async () => {
    ctx = mkCtx({ routes: { "/api/connectors": () => new Promise(() => {}) } });
    await page.load(ctx);
    body.replaceChildren(page.render(ctx));
    await flush();
    expect(byId("pg-sec-connectors").textContent).toContain("Loading…");
    expect($("#pg-sec-connectors h2").textContent).toBe("Connectors");
  });
});

// ---------------------------------------------------------------------------------------------
const agentSel = () => byId("pg-agent-name");
const projSel = () => byId("pg-agent-project");
const optsOf = (sel) => sel.querySelectorAll("option").map((o) => [o.value, o.textContent, !!o.selected]);
const pickVal = (sel, v) => fire(sel, "change", { target: { value: v } });
const agentsText = () => byId("pg-sec-agents").textContent;

describe("agents editor", () => {
  test("the roster table lists model, effort, chain, dispatch counts and last use", async () => {
    freezeNow(1_700_000_000_000 + 7200_000);
    await mountPage();
    const table = $("#pg-sec-agents table.pg-table");
    expect(table.getAttribute("aria-label")).toBe("Agent roster");
    expect(table.querySelectorAll("thead th").map((t) => t.textContent)).toEqual(["Agent", "Model", "Effort", "omp chain", "Dispatched 7d", "Total", "Last used"]);
    const rows = table.querySelectorAll("tbody tr");
    const cells = (r) => r.querySelectorAll("td").map((c) => c.textContent);
    expect(cells(rows[0])).toEqual(["opus", "high", "a → b", "2", "9", "2h ago"]);
    expect(cells(rows[1])).toEqual(["—", "low", "not generated", "0", "0", "never"]);
    expect(cells(rows[2])).toEqual(["—", "—", "not generated", "0", "0", "never"]);
    expect(rows.map((r) => r.querySelector("th").textContent)).toEqual(["worker", "scout overridden", "solo"]);
    expect(rows[1].querySelector("span.badge").textContent).toBe("overridden");
    expect(rows[0].querySelector("span.badge")).toBeNull();
    expect(rows.map((r) => r.className)).toEqual(["is-selected", "", ""]);
    expect(rows[0].querySelectorAll("td")[5].getAttribute("title")).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(rows[1].querySelectorAll("td")[5].getAttribute("title")).toBe("");
  });

  test("the project picker offers each project by label, folder, name or path and selects the current one", async () => {
    await mountPage();
    expect(optsOf(projSel())).toEqual([["1", "One", true], ["2", "two", false], ["3", "Three", false], ["4", "/r4", false]]);
    expect(optsOf(agentSel())).toEqual([["worker", "worker", true], ["scout", "scout (overridden)", false], ["solo", "solo", false]]);
    expect(byId("pg-agent-body").value).toBe("worker body");
    expect(byId("pg-agent-body").getAttribute("aria-label")).toBe("Agent definition");
    expect(byId("pg-agent-body").attrs.rows).toBe("16");
    expect($$("#pg-sec-agents label.pg-label").map((l) => [l.textContent, l.getAttribute("for")])).toEqual([["Project", "pg-agent-project"], ["Agent", "pg-agent-name"]]);
    expect(calls.gets).toContain("/api/agents?project_id=1");
    expect(calls.gets).toContain("/api/agents/worker?project_id=1");
  });

  test("the project matching the page's current project is the one chosen, else the first", async () => {
    await mountPage({ ctx: { project: "/r3" } });
    expect(optsOf(projSel()).map((o) => o[2])).toEqual([false, false, true, false]);
    expect(calls.gets).toContain("/api/agents?project_id=3");
    await mountPage({ ctx: { project: "/nowhere" } });
    expect(optsOf(projSel()).map((o) => o[2])).toEqual([true, false, false, false]);
  });

  test("an override-only agent says so and Reset is enabled only when there is something to reset", async () => {
    await mountPage();
    const source = () => $("#pg-sec-agents div.pg-agent-controls span.badge");
    expect([source().textContent, source().attrs["data-status"]]).toEqual(["plugin", "idle"]);
    expect(btn("Reset").disabled).toBe(true);
    expect(btn("Save override").disabled).toBeFalsy();
    pickVal(agentSel(), "scout");
    await flush();
    expect([source().textContent, source().attrs["data-status"]]).toEqual(["overridden (project)", "info"]);
    expect(btn("Reset").disabled).toBeFalsy();
    pickVal(agentSel(), "solo");
    await flush();
    expect(source().textContent).toBe("override (project-only)");
    expect(btn("Reset").disabled).toBeFalsy();
  });

  test("choosing another agent loads its definition and clears the note", async () => {
    await mountPage();
    pickVal(agentSel(), "scout");
    await flush();
    expect(calls.gets).toContain("/api/agents/scout?project_id=1");
    expect(byId("pg-agent-body").value).toBe("scout body");
    expect(optsOf(agentSel()).map((o) => o[2])).toEqual([false, true, false]);
    expect($$("#pg-sec-agents tbody tr").map((r) => r.className)).toEqual(["", "is-selected", ""]);
  });

  test("an agent definition that cannot be read shows the error above an empty editor", async () => {
    await mountPage({ routes: { "/api/agents/scout?project_id=1": Object.assign(new Error("x"), { error: "gone", why: "no file" }) } });
    pickVal(agentSel(), "scout");
    await flush();
    const e = $("#pg-sec-agents p.pg-field-error");
    expect([e.textContent, e.getAttribute("role")]).toEqual(["gone — no file", "alert"]);
    expect(byId("pg-agent-body").value).toBe("");
    pickVal(agentSel(), "worker");
    await flush();
    expect($("#pg-sec-agents p.pg-field-error")).toBeNull();
    expect(byId("pg-agent-body").value).toBe("worker body");
  });

  test("an error with only a title shows no dash", async () => {
    await mountPage({ routes: { "/api/agents/scout?project_id=1": new Error("boom") } });
    pickVal(agentSel(), "scout");
    await flush();
    expect($("#pg-sec-agents p.pg-field-error").textContent).toBe("boom");
  });

  test("agent names are URL-encoded in the definition request", async () => {
    await mountPage({ routes: { "/api/agents?project_id=1": { agents: [{ name: "a b/c", source: "plugin" }] }, "/api/agents/a%20b%2Fc?project_id=1": { content: "spaced" } } });
    expect(byId("pg-agent-body").value).toBe("spaced");
  });

  test("a definition without content is an empty editor", async () => {
    await mountPage({ routes: { "/api/agents/worker?project_id=1": {} } });
    expect(byId("pg-agent-body").value).toBe("");
  });

  test("choosing another project reloads its roster and first agent", async () => {
    await mountPage();
    pickVal(projSel(), "2");
    await flush();
    expect(calls.gets).toContain("/api/agents?project_id=2");
    expect(calls.gets).toContain("/api/agents/other?project_id=2");
    expect(optsOf(projSel()).map((o) => o[2])).toEqual([false, true, false, false]);
    expect(optsOf(agentSel())).toEqual([["other", "other", true]]);
    expect(byId("pg-agent-body").value).toBe("other body");
  });

  test("after an action the chosen agent stays chosen when the reloaded roster still has it; a new project starts at its first agent", async () => {
    await mountPage({ routes: { "/api/agents?project_id=2": AGENTS(), "/api/agents/worker?project_id=2": { content: "worker in 2" } } });
    pickVal(agentSel(), "scout");
    await flush();
    routes["POST /api/agents"] = { ok: true };
    btn("Reset").click();
    await flush();
    expect(optsOf(agentSel()).map((o) => o[2])).toEqual([false, true, false]);
    expect(byId("pg-agent-body").value).toBe("scout body");
    pickVal(projSel(), "2");
    await flush();
    expect(optsOf(agentSel()).map((o) => o[2])).toEqual([true, false, false]);
    expect(byId("pg-agent-body").value).toBe("worker in 2");
  });

  test("choosing no project falls back to the unscoped roster", async () => {
    await mountPage();
    pickVal(projSel(), "");
    await flush();
    expect(calls.gets[calls.gets.length - 1]).toBe("/api/agents");
    expect(byId("pg-agent-body").value).toBe("");
  });

  test("the roster alone is shown when no projects are registered", async () => {
    await mountPage({ routes: { "/api/projects?editable=1": { projects: [] } } });
    expect(agentsText()).toContain("No registered projects yet, so overrides cannot be edited.");
    expect($$("#pg-sec-agents tbody tr").length).toBe(3);
    expect(byId("pg-agent-body")).toBeNull();
    expect(calls.gets).toContain("/api/agents");
    expect(calls.gets.some((g) => String(g).startsWith("/api/agents/"))).toBe(false);
  });

  test("a project list that failed is an error with Retry, not an empty list", async () => {
    await mountPage({ routes: { "/api/projects?editable=1": Object.assign(new Error("x"), { error: "slow", why: "db busy" }) } });
    expect(agentsText()).toContain("Project list unavailable: slow");
    expect(agentsText()).toContain("db busy");
    expect(agentsText()).not.toContain("No registered projects yet");
    expect($$("#pg-sec-agents tbody tr").length).toBe(3);
    routes["/api/projects?editable=1"] = PROJECT_LIST();
    btn("Retry", byId("pg-sec-agents")).click();
    await flush();
    expect(byId("pg-agent-body")).toBeDefined();
  });

  test("a roster that failed is an error card; an empty roster shows no table", async () => {
    await mountPage({ routes: { "/api/agents?project_id=1": Object.assign(new Error("x"), { error: "agents down" }) } });
    expect(agentsText()).toContain("Agents unavailable: agents down");
    expect($("#pg-sec-agents table")).toBeNull();
    await mountPage({ routes: { "/api/agents?project_id=1": { agents: [] } } });
    expect($("#pg-sec-agents table")).toBeNull();
    expect(optsOf(agentSel())).toEqual([]);
    expect(btn("Save override").disabled).toBe(true);
    expect($("#pg-sec-agents div.pg-agent-controls span.badge").textContent).toBe("—");
    expect($("#st-tab-agents span.st-count").textContent).toBe("0");
  });

  test("editing the definition and saving posts the project, action, name and text", async () => {
    await mountPage();
    typeInto(byId("pg-agent-body"), "new body");
    routes["POST /api/agents"] = { ok: true };
    const gets = calls.gets.length;
    btn("Save override").click();
    await flush();
    expect(calls.posts).toEqual([["/api/agents", { project_id: 1, action: "save", name: "worker", content: "new body" }]]);
    expect($("#pg-sec-agents span[role=\"status\"]").textContent).toBe("Override saved.");
    expect(calls.toasts).toEqual([["worker: Override saved.", "ok"]]);
    expect(calls.gets.slice(gets)).toContain("/api/agents?project_id=1");
    expect(byId("pg-agent-body").disabled).toBeFalsy();
  });

  test("a note from the server replaces the default wording", async () => {
    await mountPage();
    routes["POST /api/agents"] = { ok: true, note: "Wrote .claude/agents/worker.md" };
    btn("Save override").click();
    await flush();
    expect($("#pg-sec-agents span[role=\"status\"]").textContent).toBe("Wrote .claude/agents/worker.md");
  });

  test("Reset sends no content and says the override was removed", async () => {
    await mountPage();
    pickVal(agentSel(), "scout");
    await flush();
    routes["POST /api/agents"] = { ok: true };
    btn("Reset").click();
    await flush();
    expect(calls.posts).toEqual([["/api/agents", { project_id: 1, action: "reset", name: "scout" }]]);
    expect("content" in calls.posts[0][1]).toBe(false);
    expect($("#pg-sec-agents span[role=\"status\"]").textContent).toBe("Override removed.");
    expect(calls.toasts).toEqual([["scout: Override removed.", "ok"]]);
  });

  test("a failed save keeps the text, reports the reason and toasts a failure", async () => {
    await mountPage();
    typeInto(byId("pg-agent-body"), "mine");
    routes["POST /api/agents"] = { ok: false, error: "denied", why: "Read only" };
    btn("Save override").click();
    await flush();
    expect($("#pg-sec-agents span[role=\"status\"]").textContent).toBe("denied — Read only");
    expect(calls.toasts).toEqual([["Could not save worker: denied — Read only", "fail"]]);
    expect(byId("pg-agent-body").value).toBe("mine");
    expect(btn("Save override").disabled).toBeFalsy();
  });

  test("while saving the editor and buttons are disabled and a second press is ignored", async () => {
    await mountPage();
    const d = defer();
    routes["POST /api/agents"] = () => d.p;
    btn("Save override").click();
    await flush();
    expect([byId("pg-agent-body").disabled, btn("Save override").disabled, btn("Reset").disabled]).toEqual([true, true, true]);
    btn("Save override").click();
    await flush();
    expect(calls.posts.length).toBe(1);
    d.res({ ok: true });
    await flush();
    expect(byId("pg-agent-body").disabled).toBeFalsy();
  });

  test("with no agent selected a stray save does nothing", async () => {
    await mountPage({ routes: { "/api/agents?project_id=1": { agents: [] } } });
    btn("Save override").click();
    await flush();
    expect(calls.posts).toEqual([]);
  });

  test("with no project selected a stray save does nothing", async () => {
    await mountPage();
    pickVal(projSel(), "");
    await flush();
    btn("Save override").click();
    await flush();
    expect(calls.posts).toEqual([]);
  });
});

describe("filtering across tabs", () => {
  const typeFilter = (v) => { const f = byId("st-filter"); f.value = v; fire(f, "input"); };
  const panelHidden = () => ["dashboard", "behavior", "models", "integrations", "agents"].map((t) => !!byId("st-panel-" + t).hidden);
  const counts = () => ["dashboard", "behavior", "models", "integrations", "agents"].map((t) => $("#st-tab-" + t + " span.st-count").textContent);

  test("without a query only the selected tab's panel is visible and headings are hidden", async () => {
    await mountPage();
    expect(panelHidden()).toEqual([false, true, true, true, true]);
    expect(["dashboard", "behavior"].map((t) => !!$("#st-panel-" + t + " h2.st-tab-heading").hidden)).toEqual([true, true]);
    expect(byId("st-tab-dashboard").getAttribute("tabindex")).toBe("0");
    expect(byId("st-tab-behavior").getAttribute("tabindex")).toBe("-1");
  });

  test("a query stacks every tab with a match, with headings, and counts the matching rows", async () => {
    await mountPage();
    typeFilter("tripwire");
    expect(panelHidden()).toEqual([true, false, true, true, true]);
    expect(counts()).toEqual(["0", "1", "0", "9", "3"]);
    expect(!!$("#st-panel-behavior h2.st-tab-heading").hidden).toBe(false);
    expect($("#st-panel-behavior h2.st-tab-heading").textContent).toBe("Behavior");
    expect(byId("st-tab-dashboard").getAttribute("aria-selected")).toBe("true");
  });

  test("a query is trimmed and matches the group's section visibility", async () => {
    await mountPage();
    typeFilter("   tripwire  ");
    const groups = $$("#st-panel-behavior section.st-group");
    expect(groups.map((g) => !!g.hidden)).toEqual([false, true, true]);
    const rows = $$("#st-panel-behavior li.st-card");
    expect(rows.filter((r) => !r.hidden).map((r) => r.getAttribute("id"))).toEqual(["st-ATLAS_TRIPWIRE-row"]);
    typeFilter("");
    expect(panelHidden()).toEqual([false, true, true, true, true]);
    expect(groups.map((g) => !!g.hidden)).toEqual([false, false, false]);
    expect(counts()).toEqual(["6", "4", "1", "9", "3"]);
  });

  test("a query naming a wide tab shows that tab; a query matching nothing hides everything", async () => {
    await mountPage();
    typeFilter("integr");
    expect(panelHidden()).toEqual([true, true, true, false, true]);
    typeFilter("AGENT");
    expect(panelHidden()).toEqual([true, true, true, true, false]);
    typeFilter("zzzzzz");
    expect(panelHidden()).toEqual([true, true, true, true, true]);
    expect(counts()).toEqual(["0", "0", "0", "9", "3"]);
  });
});
