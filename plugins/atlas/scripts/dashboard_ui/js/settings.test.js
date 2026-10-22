import { test, expect } from "bun:test";

// Minimal DOM stand-in (same pattern as terminal.test.js; no DOM lib is installed).
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; this.dataset = {}; this.textContent = ""; this.hidden = false; this.isConnected = true; }
  appendChild(c) { this.children.push(c); if (c instanceof N) c.parent = this; return c; }
  replaceChildren(...c) { this.children = []; c.forEach((x) => x && this.appendChild(x)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  focus() {}
  contains() { return false; }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
globalThis.Node = N;
globalThis.window = { addEventListener() {}, removeEventListener() {}, __ATLAS_BASE__: "" };
globalThis.location = { protocol: "http:", host: "127.0.0.1:7421", href: "http://127.0.0.1:7421/" };
globalThis.sessionStorage = { getItem: () => null, setItem() {} };
globalThis.document = {
  createElement: (t) => new N(t), createElementNS: (_n, t) => new N(t), createTextNode: (t) => ({ text: t }),
  querySelector: () => null, getElementById: () => null, addEventListener() {}, removeEventListener() {},
  documentElement: new N("html"), body: new N("body"), activeElement: null,
};

const { SettingRow, verifyStatus, clampNumber, liveVsSaved } = await import("./settings-row.js");
const { default: page } = await import("./pages/settings.js");

const walk = (n, out = []) => { if (n && n.children) { out.push(n); n.children.forEach((c) => walk(c, out)); } return out; };
const text = (n) => walk(n).flatMap((x) => [x.textContent, ...x.children.map((c) => c.text)]).filter(Boolean).join("|");
const byClass = (n, c) => walk(n).filter((x) => (x.attrs.class || "").split(" ").includes(c));
const byTag = (n, t) => walk(n).filter((x) => x.tag === t);
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

const L = (live, store) => ({ live_env: { supported: true, value: live }, store: { supported: true, value: store }, claude_settings: { supported: true, value: store } });
const KNOBS = [
  { key: "ATLAS_TRIPWIRE", title: "Tripwire", description: "Dispatch gate.", effect: "Blocks unbounded dispatches.", applies: "now", kind: "toggle", on: "on", off: "off", value: "on", scope: "hooks", layers: L("on", "on") },
  { key: "ATLAS_TRIPWIRE_THRESHOLD", title: "Tripwire threshold", description: "Inline op budget.", effect: "Raises or lowers the budget.", applies: "now", kind: "number", range: { min: 1, max: 20, step: 1 }, value: "7", scope: "hooks", layers: L("7", "7") },
  { key: "ATLAS_OPTIMIZE", title: "Prompt optimizer", description: "When to rewrite prompts.", effect: "Rewrites prompts.", applies: "now", kind: "select", options: [{ value: "off", label: "Off", hint: "never" }, { value: "trigger", label: "Trigger" }, { value: "always", label: "Always" }], value: "off", scope: "hooks", layers: L("off", "off") },
  { key: "ATLAS_DECISION_MODEL", title: "Decision model", description: "Classifier model.", effect: "Picks the classifier.", applies: "now", kind: "model", value: "nimble:latest", scope: "hooks", layers: L("nimble:latest", "nimble:latest") },
  { key: "ATLAS_OPTIMIZE_CMD", title: "Optimizer command", description: "Shell command.", effect: "Runs per prompt.", applies: "now", kind: "command", value: "", scope: "hooks", layers: L("", "") },
  { key: "ATLAS_OLLAMA_URL", title: "Ollama URL", description: "Server.", effect: "Where models load.", applies: "now", kind: "url", value: "http://127.0.0.1:11434", scope: "hooks", layers: L("http://127.0.0.1:11434", "http://127.0.0.1:11434") },
  { key: "ATLAS_HOOK_BRIDGE", title: "Hook bridge", description: "omp bridge.", effect: "Enables the bridge.", applies: "now", kind: "toggle", on: "1", off: "0", value: "1", scope: "shell",
    layers: { live_env: { supported: true, value: "1" }, claude_settings: { supported: true, value: "1" }, omp_config: { supported: true, value: "1" }, shell_rc: { supported: true, value: "1" } } },
];
const EXTRA = [
  { key: "ATLAS_SESSION_AUTO", title: "Session automation", description: "Runs steps at session start.", effect: "Starts helpers.", applies: "now", kind: "toggle", on: "on", off: "off", value: "on", scope: "hooks", layers: L("on", "on") },
  { key: "ATLAS_COLONY", title: "Colony", description: "Colony channel.", effect: "Opens the channel.", applies: "now", kind: "toggle", on: "on", off: "off", value: "on", scope: "hooks", layers: L("on", "on") },
  { key: "ATLAS_SCORE_TURNS", title: "Score turns", description: "Turn scoring.", effect: "Scores each turn.", applies: "now", kind: "toggle", on: "on", off: "off", value: "on", scope: "hooks", layers: L("on", "on") },
];
const BEHAVIOR = {
  groups: [
    { title: "Session automation", intro: "Session steps.", knobs: [EXTRA[0]] },
    { title: "Guardrails", intro: "Dispatch gates.", knobs: [KNOBS[0], KNOBS[1]] },
    { title: "Colony", intro: "Colony channel.", knobs: [EXTRA[1]] },
    { title: "omp extension", intro: "omp bridge.", knobs: [KNOBS[6]] },
    { title: "Prompt optimizer", intro: "Prompt rewriting.", knobs: [KNOBS[2], KNOBS[4]] },
    { title: "Decision model", intro: "Classifier.", knobs: [KNOBS[3], KNOBS[5]] },
    { title: "Turn scoring", intro: "Scoring.", knobs: [EXTRA[2]] },
  ],
  advanced: [],
  paths: [
    { key: "ATLAS_HOME", title: "Atlas state directory", value: "/home/a", description: "" },
    { key: "ATLAS_DB", title: "Telemetry database", value: "/home/a/atlas.db", description: "" },
    { key: "ATLAS_DASHBOARD_PORT", title: "Command Center port", value: "7421", description: "" },
  ],
  hidden: [],
  note: "",
};
const mkApi = (extra = {}) => {
  const posts = [];
  return {
    posts,
    get: async (p) => {
      if (p === "/api/behavior") return BEHAVIOR;
      if (p === "/api/v2/prefs") return { state: { theme: "dark", density: "comfortable", default_project: "all", refresh_seconds: 8, noise: { min_severity: "info" }, nav_order: [] } };
      if (p.startsWith("/api/v2/ollama/models")) return { models: [{ name: "nimble:latest", cloud: false, size_bytes: 9.5e9 }, { name: "x:cloud", cloud: true }] };
      if (p.startsWith("/api/v2/ollama/status")) return { reachable: true, version: "0.12", ps: [] };
      if (p === "/api/v2/projects") return { projects: [] };
      return {};
    },
    post: async (p, b) => { posts.push([p, b]); return extra.post ? extra.post(p, b) : { ok: true, key: Object.keys(b.updates)[0], layers: [{ layer: "store", wrote: "1", got: "1", ok: true }, { layer: "claude_settings", wrote: "1", got: "1", ok: true }], applies: "now" }; },
    put: async (p, b) => ({ state: { theme: "light", density: "comfortable", default_project: "all", refresh_seconds: 8, noise: { min_severity: "info" }, nav_order: [], ...b } }),
  };
};
const deps = (api, over = {}) => ({ api, save: async (item, v, extra) => (await api.post("/api/behavior", { updates: { [item.key]: v }, ...extra })), confirm: async () => true, testUrl: async () => ({ text: "✓ reachable" }), ...over });
const mountPage = async (api) => {
  const ctx = { api, project: "all", prefs: {}, toast() {} };
  await page.load(ctx);
  const root = page.render(ctx);
  await tick(30);
  return root;
};

test("verifyStatus: all layers equal prints verified with the layers; a mismatch names layer and got", () => {
  expect(verifyStatus({ ok: true, layers: [{ layer: "claude_settings", ok: true }, { layer: "omp_config", ok: true }, { layer: "shell_rc", ok: true }] }).text)
    .toBe("✓ verified · claude settings.json, omp config, ~/.atlas/env.sh");
  const bad = verifyStatus({ ok: false, layers: [{ layer: "store", ok: true }, { layer: "claude_settings", wrote: "on", got: "off", ok: false }] });
  expect(bad).toEqual({ ok: false, text: "✗ not saved: claude settings.json has off" });
});

test("a save whose read-back mismatches renders `not saved`, never a green tick", async () => {
  const api = mkApi({ post: async () => ({ ok: false, layers: [{ layer: "claude_settings", wrote: "on", got: "off", ok: false }] }) });
  const row = SettingRow(KNOBS[0], deps(api));
  await byTag(row, "button")[0].listeners.click();
  const status = byClass(row, "st-status")[0];
  expect(status.textContent).toBe("✗ not saved: claude settings.json has off");
  expect(status.attrs.class).toContain("is-fail");
});

test("a verified save lists the layers that read back", async () => {
  const row = SettingRow(KNOBS[0], deps(mkApi()));
  await byTag(row, "button")[0].listeners.click();
  expect(byClass(row, "st-status")[0].textContent).toBe("✓ verified · atlas store, claude settings.json");
});

test("an options knob renders a <select> from the options, with no free-text input", () => {
  const row = SettingRow(KNOBS[2], deps(mkApi()));
  const sel = byTag(row, "select")[0];
  expect(sel.children.map((o) => o.children[0].text)).toEqual(["Off", "Trigger", "Always"]);
  expect(byTag(row, "input").length).toBe(0);
});

test("number knobs clamp to range and the stepper moves by step", async () => {
  expect(clampNumber({ min: 1, max: 20 }, "999")).toBe(20);
  expect(clampNumber({ min: 1, max: 20 }, "-4")).toBe(1);
  expect(clampNumber({ min: 1, max: 20 }, "abc")).toBe(null);
  const api = mkApi();
  const row = SettingRow(KNOBS[1], deps(api));
  const input = byTag(row, "input")[0];
  input.value = "20";
  await input.listeners.change();
  expect(api.posts.at(-1)[1].updates.ATLAS_TRIPWIRE_THRESHOLD).toBe("20");
  const [dec] = byClass(row, "st-step");
  await dec.listeners.click();
  expect(api.posts.at(-1)[1].updates.ATLAS_TRIPWIRE_THRESHOLD).toBe("19");
});

test("an out-of-range typed value is sent as typed; the server 400 is shown and the field keeps it", async () => {
  const api = mkApi({ post: async () => { throw Object.assign(new Error("out_of_range"), { status: 400, data: { ok: false, error: "out_of_range", range: { min: 1, max: 20, step: 1 } } }); } });
  const row = SettingRow(KNOBS[1], deps(api));
  const input = byTag(row, "input")[0];
  input.value = "99999999";
  await input.listeners.change();
  expect(api.posts.at(-1)[1].updates.ATLAS_TRIPWIRE_THRESHOLD).toBe("99999999");
  expect(byClass(row, "st-status")[0].textContent).toBe("✗ not saved: 99999999 is outside 1..20");
  expect(input.value).toBe("99999999");
});

test("command knobs confirm before saving; cancel saves nothing", async () => {
  const api = mkApi();
  let asked = 0;
  const row = SettingRow(KNOBS[4], deps(api, { confirm: async () => { asked += 1; return false; } }));
  const input = byTag(row, "input")[0];
  input.value = "ollama run x {prompt}";
  await byClass(row, "btn").find((b) => b.tag === "button").listeners.click();
  expect(asked).toBe(1);
  expect(api.posts.length).toBe(0);
  expect(byClass(row, "st-status")[0].textContent).toContain("cancelled");
});

test("a server needs_confirm (409) is confirmed then retried with confirm:true", async () => {
  let n = 0;
  const api = mkApi({ post: async (p, b) => { if (!b.confirm && n++ === 0) throw Object.assign(new Error("x"), { status: 409, data: { error: "needs_confirm", command: "c" } }); return { ok: true, layers: [{ layer: "store", ok: true }] }; } });
  const row = SettingRow({ ...KNOBS[4], kind: "text" }, deps(api));
  byTag(row, "input")[0].value = "c";
  await byTag(row, "button")[0].listeners.click();
  expect(api.posts.at(-1)[1].confirm).toBe(true);
  expect(byClass(row, "st-status")[0].textContent).toContain("✓ verified");
});

test("unknown_model errors name the closest matches", async () => {
  const api = mkApi({ post: async () => { throw Object.assign(new Error("unknown_model"), { status: 400, data: { error: "unknown_model", matches: ["nimble:latest"] } }); } });
  const row = SettingRow(KNOBS[5], deps(api));
  byTag(row, "input")[0].value = "nimbl";
  await byTag(row, "button")[0].listeners.click();
  expect(byClass(row, "st-status")[0].textContent).toContain("closest: nimble:latest");
});

test("url rows have a Test button; live vs saved shows only when they differ", async () => {
  const row = SettingRow(KNOBS[5], deps(mkApi()));
  const test = byTag(row, "button").find((b) => b.attrs.id.endsWith("-test"));
  await test.listeners.click();
  expect(text(row)).toContain("\u2713 reachable");
  expect(liveVsSaved({ kind: "toggle", off: "off", layers: L("on", "off") })).toBe("live: on \u00b7 saved: off");
  expect(liveVsSaved({ kind: "toggle", layers: L("on", "on") })).toBe(null);
});

test("shell-scope rows are editable, list the files written and show no applies badge for `now`", async () => {
  const api = mkApi();
  const row = SettingRow(KNOBS[6], deps(api));
  expect(text(row)).toContain("Writes: claude settings.json, omp config, ~/.atlas/env.sh");
  expect(text(row)).not.toContain("next session");
  expect(byClass(row, "st-badge").length).toBe(0);
  await byTag(row, "button")[0].listeners.click();
  expect(api.posts.at(-1)[1].updates.ATLAS_HOOK_BRIDGE).toBe("0");
});

test("an applies value other than now still renders a badge", () => {
  const row = SettingRow({ ...KNOBS[0], applies: "dashboard-restart" }, deps(mkApi()));
  expect(byClass(row, "st-badge")[0].children[0].text).toBe("restart dashboard");
});

const tabsOf = (root) => byClass(root, "st-tab");
const panelsOf = (root) => byClass(root, "st-panel");
const shownPanels = (root) => panelsOf(root).filter((p) => !p.hidden);
const tabLabel = (b) => b.children[0].text;
const tabCount = (b) => b.children.at(-1).textContent;
const key = (k) => ({ key: k, preventDefault() {} });

test("the page renders five tabs with labels and row counts", async () => {
  const root = await mountPage(mkApi());
  const tabs = tabsOf(root);
  expect(tabs.map(tabLabel)).toEqual(["Dashboard", "Behavior", "Models", "Integrations", "Agents"]);
  const counts = Object.fromEntries(tabs.map((b) => [tabLabel(b), tabCount(b)]));
  expect(counts.Dashboard).toBe("6");
  expect(counts.Behavior).toBe("5");
  expect(counts.Models).toBe("5");
  expect(byClass(root, "st-nav").length).toBe(0);
  expect(byClass(root, "st-layout").length).toBe(0);
  page.destroy();
});

test("Dashboard is the default tab; ?tab= and legacy ?cat= pick a tab", async () => {
  const selected = (root) => tabsOf(root).filter((b) => b.attrs["aria-selected"] === "true").map(tabLabel);
  const root = await mountPage(mkApi());
  expect(selected(root)).toEqual(["Dashboard"]);
  expect(shownPanels(root).length).toBe(1);
  page.destroy();
  for (const [search, label] of [["?tab=behavior", "Behavior"], ["?cat=guardrails", "Behavior"], ["?cat=Prompt%20optimizer", "Models"], ["?cat=Connectors", "Integrations"], ["?tab=nope", "Dashboard"]]) {
    globalThis.location.search = search;
    const r = await mountPage(mkApi());
    expect([search, selected(r)]).toEqual([search, [label]]);
    page.destroy();
  }
  globalThis.location.search = "";
});

test("tabs follow WAI-ARIA: roving tabindex, arrows move, Home and End jump", async () => {
  const root = await mountPage(mkApi());
  const list = byClass(root, "st-tabs")[0];
  const sel = () => tabsOf(root).filter((b) => b.attrs["aria-selected"] === "true").map(tabLabel)[0];
  expect(tabsOf(root).map((b) => b.attrs.tabindex)).toEqual(["0", "-1", "-1", "-1", "-1"]);
  list.listeners.keydown(key("ArrowRight"));
  expect(sel()).toBe("Behavior");
  list.listeners.keydown(key("End"));
  expect(sel()).toBe("Agents");
  list.listeners.keydown(key("ArrowRight"));
  expect(sel()).toBe("Dashboard");
  list.listeners.keydown(key("ArrowLeft"));
  expect(sel()).toBe("Agents");
  list.listeners.keydown(key("Home"));
  expect(sel()).toBe("Dashboard");
  expect(shownPanels(root).length).toBe(1);
  page.destroy();
});

test("Behavior lists server groups in order with h3 titles, intros and the paths footer", async () => {
  globalThis.location.search = "?tab=behavior";
  const root = await mountPage(mkApi());
  const panel = shownPanels(root)[0];
  expect(byTag(panel, "h3").map((x) => x.textContent || x.children[0].text)).toEqual(["Session automation", "Guardrails", "Colony", "omp extension"]);
  expect(byClass(panel, "st-group-intro").map((x) => x.children[0].text)).toContain("Dispatch gates.");
  expect(byClass(panel, "st-paths")[0].children[0].text).toBe("Atlas state directory (ATLAS_HOME): /home/a | Telemetry database (ATLAS_DB): /home/a/atlas.db | Command Center port (ATLAS_DASHBOARD_PORT): 7421. Set these in your shell before starting atlas.");
  page.destroy();
  globalThis.location.search = "?tab=models";
  const models = shownPanels(await mountPage(mkApi()))[0];
  expect(byTag(models, "h3").map((x) => x.textContent || x.children[0].text)).toEqual(["Prompt optimizer", "Decision model", "Turn scoring"]);
  expect(byClass(models, "st-paths").length).toBe(0);
  page.destroy();
  globalThis.location.search = "";
});

test("Integrations drops the read-only inventory panel and holds the ecosystem and connectors", async () => {
  globalThis.location.search = "?tab=integrations";
  const root = await mountPage(mkApi());
  const panel = shownPanels(root)[0];
  expect(byTag(panel, "h3").map((x) => x.textContent || x.children[0].text)).toEqual(["Ecosystem", "Connectors"]);
  expect(walk(panel).some((x) => x.attrs.id === "integrations")).toBe(false);
  expect(text(panel)).toContain("Claude Code reads them when it starts.");
  expect(text(panel)).not.toContain("next session");
  page.destroy();
  globalThis.location.search = "";
});

test("the filter shows matches from several tabs stacked under tab headings, then returns to one tab", async () => {
  const root = await mountPage(mkApi());
  const filter = byClass(root, "st-filter")[0];
  filter.value = "when";
  filter.listeners.input();
  const panels = shownPanels(root);
  expect(panels.length).toBeGreaterThan(1);
  expect(panels.map((p) => byTag(p, "h2").find((x) => (x.attrs.class || "").includes("st-tab-heading") && !x.hidden)).every(Boolean)).toBe(true);
  const visible = byClass(root, "st-card").filter((c) => !c.hidden).map((c) => c.attrs.id);
  expect(visible).toContain("st-ATLAS_OPTIMIZE-row");
  expect(visible).not.toContain("st-ATLAS_TRIPWIRE-row");
  filter.value = "threshold";
  filter.listeners.input();
  expect(byClass(root, "st-card").filter((c) => !c.hidden).map((c) => c.attrs.id)).toEqual(["st-ATLAS_TRIPWIRE_THRESHOLD-row"]);
  expect(tabCount(tabsOf(root)[1])).toBe("1");
  expect(tabCount(tabsOf(root)[0])).toBe("0");
  filter.value = "";
  filter.listeners.input();
  expect(shownPanels(root).length).toBe(1);
  expect(tabCount(tabsOf(root)[0])).toBe("6");
  page.destroy();
});

test("preferences use the same row component and verify against the saved state", async () => {
  const root = await mountPage(mkApi());
  const theme = byClass(root, "st-card").find((c) => c.attrs.id === "st-theme-row");
  const sel = byTag(theme, "select")[0];
  sel.value = "light";
  await sel.listeners.change();
  expect(byClass(theme, "st-status")[0].textContent).toBe("\u2713 verified \u00b7 dashboard prefs");
  page.destroy();
});

test("settings.css: tabs replace the sidebar grid and the card grid is two columns from 1100px", async () => {
  const css = await Bun.file(new URL("../css/settings.css", import.meta.url)).text();
  expect(css).not.toContain("200px minmax");
  expect(css).not.toContain(".st-nav");
  expect(css).toContain(".st-tabs");
  expect(css).toMatch(/@media \(min-width: 1100px\) \{ \.st-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

const arrowEnter = { key: "Enter", preventDefault() {} };

test("number row: Enter then blur sends exactly one POST and the status stays verified", async () => {
  const api = mkApi();
  const row = SettingRow(KNOBS[1], deps(api));
  const input = byTag(row, "input")[0];
  input.blur = () => input.listeners.change();
  input.value = "11";
  await input.listeners.keydown(arrowEnter);
  await tick();
  await input.listeners.change();
  expect(api.posts.length).toBe(1);
  expect(byClass(row, "st-status")[0].textContent).toContain("\u2713 verified");
});

test("a failed number save posts once per Enter, not once per handler", async () => {
  const api = mkApi({ post: async () => { throw Object.assign(new Error("boom"), { status: 500 }); } });
  const row = SettingRow(KNOBS[1], deps(api));
  const input = byTag(row, "input")[0];
  input.blur = () => input.listeners.change();
  input.value = "11";
  await input.listeners.keydown(arrowEnter);
  await tick();
  expect(api.posts.length).toBe(1);
});

test("a second commit while one is pending is ignored", async () => {
  let release;
  const api = mkApi({ post: () => new Promise((r) => { release = () => r({ ok: true, layers: [{ layer: "store", ok: true }] }); }) });
  const row = SettingRow(KNOBS[1], deps(api));
  const input = byTag(row, "input")[0];
  input.value = "12";
  const first = input.listeners.change();
  input.value = "13";
  await input.listeners.change();
  expect(api.posts.length).toBe(1);
  release();
  await first;
});

test("text rows save on blur", async () => {
  const api = mkApi();
  const row = SettingRow(KNOBS[5], deps(api));
  const input = byTag(row, "input")[0];
  input.value = "http://x:1";
  await input.listeners.change();
  expect(api.posts.length).toBe(1);
  expect(api.posts[0][1].updates.ATLAS_OLLAMA_URL).toBe("http://x:1");
  expect(byClass(row, "st-status")[0].textContent).toContain("\u2713 verified");
});

test("a later successful save replaces an earlier error, and a repeat save never reads `unchanged`", async () => {
  let fail = true;
  const api = mkApi({ post: async () => { if (fail) throw Object.assign(new Error("boom"), { status: 500 }); return { ok: true, layers: [{ layer: "store", ok: true }] }; } });
  const row = SettingRow(KNOBS[5], deps(api));
  const input = byTag(row, "input")[0];
  const save = byTag(row, "button")[0];
  input.value = "http://x:1";
  await save.listeners.click();
  const status = byClass(row, "st-status")[0];
  expect(status.textContent).toContain("not saved");
  fail = false;
  input.value = "http://x:1";
  await save.listeners.click();
  expect(status.textContent).toBe("\u2713 verified \u00b7 atlas store");
  await save.listeners.click();
  expect(status.textContent).toBe("\u2713 verified \u00b7 atlas store");
  expect(api.posts.length).toBe(2);
});

test("restoring the previous value after an error clears the error", async () => {
  const api = mkApi({ post: async () => { throw Object.assign(new Error("boom"), { status: 500 }); } });
  const row = SettingRow(KNOBS[5], deps(api));
  const input = byTag(row, "input")[0];
  const save = byTag(row, "button")[0];
  input.value = "http://other";
  await save.listeners.click();
  const status = byClass(row, "st-status")[0];
  expect(status.textContent).toContain("not saved");
  input.value = "http://127.0.0.1:11434";
  await save.listeners.click();
  expect(status.textContent).toBe("");
});

test("hash-form tab and legacy cat links select a tab; selectTab writes the hash form", async () => {
  const selected = (root) => tabsOf(root).filter((b) => b.attrs["aria-selected"] === "true").map(tabLabel);
  globalThis.location.search = "";
  for (const [hash, label] of [["#/settings?tab=models", "Models"], ["#/settings?cat=guardrails", "Behavior"]]) {
    globalThis.location.hash = hash;
    const r = await mountPage(mkApi());
    expect([hash, selected(r)]).toEqual([hash, [label]]);
    page.destroy();
  }
  globalThis.location.hash = "#/settings?tab=models";
  const calls = [];
  globalThis.history = { replaceState: (_s, _t, u) => calls.push(String(u)) };
  const r = await mountPage(mkApi());
  byClass(r, "st-tabs")[0].listeners.keydown(key("ArrowRight"));
  expect(calls.at(-1)).toBe("#/settings?tab=integrations");
  expect(calls.at(-1)).not.toContain("?tab=behavior#");
  page.destroy();
  globalThis.location.hash = "";
  delete globalThis.history;
});

test("paths footer names the environment variables", async () => {
  globalThis.location.search = "?tab=behavior";
  const root = await mountPage(mkApi());
  expect(text(byClass(root, "st-paths")[0])).toContain("(ATLAS_HOME)");
  page.destroy();
  globalThis.location.search = "";
});

test("boolean connector credential renders a switch; a text one still renders an input", async () => {
  globalThis.location.search = "?tab=integrations";
  const api = mkApi();
  const get = api.get;
  api.get = async (p) => (p === "/api/connectors" ? { connectors: [{ name: "panos", bundle_exists: true, health: "ok", enabled: true, fields: [
    { user_config_key: "panos_verify_tls", env_key: "PANOS_VERIFY_TLS", type: "bool", value: "false", is_set: true, title: "TLS" },
    { user_config_key: "panos_host", env_key: "PANOS_HOST", value: "fw", is_set: true, title: "Host" },
  ] }] } : get(p));
  const root = await mountPage(api);
  const sw = walk(root).find((x) => x.attrs.id === "pg-cred-panos-panos_verify_tls");
  expect(sw.attrs.role).toBe("switch");
  expect(sw.attrs["aria-checked"]).toBe("false");
  expect(walk(root).find((x) => x.attrs.id === "pg-cred-panos-panos_host").tag).toBe("input");
  page.destroy();
  globalThis.location.search = "";
});
