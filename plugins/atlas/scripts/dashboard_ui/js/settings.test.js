import { test, expect } from "bun:test";

// Minimal DOM stand-in (same pattern as terminal.test.js; no DOM lib is installed).
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; this.textContent = ""; this.hidden = false; this.isConnected = true; }
  appendChild(c) { this.children.push(c); if (c instanceof N) c.parent = this; return c; }
  replaceChildren(...c) { this.children = []; c.forEach((x) => x && this.appendChild(x)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
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

const { SettingRow, verifyStatus, clampNumber, categoryOf, liveVsSaved } = await import("./settings-row.js");
const { default: page } = await import("./pages/settings.js");

const walk = (n, out = []) => { if (n && n.children) { out.push(n); n.children.forEach((c) => walk(c, out)); } return out; };
const text = (n) => walk(n).flatMap((x) => [x.textContent, ...x.children.map((c) => c.text)]).filter(Boolean).join("|");
const byClass = (n, c) => walk(n).filter((x) => (x.attrs.class || "").split(" ").includes(c));
const byTag = (n, t) => walk(n).filter((x) => x.tag === t);
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

const L = (live, store) => ({ live_env: { supported: true, value: live }, store: { supported: true, value: store }, claude_settings: { supported: true, value: store } });
const KNOBS = [
  { key: "ATLAS_TRIPWIRE", title: "Tripwire", description: "Dispatch gate.", effect: "Blocks unbounded dispatches.", applies: "next-session", kind: "toggle", on: "on", off: "off", value: "on", scope: "hooks", layers: L("on", "on") },
  { key: "ATLAS_TRIPWIRE_THRESHOLD", title: "Tripwire threshold", description: "Inline op budget.", effect: "Raises or lowers the budget.", applies: "next-session", kind: "number", range: { min: 1, max: 20, step: 1 }, value: "7", scope: "hooks", layers: L("7", "7") },
  { key: "ATLAS_OPTIMIZE", title: "Prompt optimizer", description: "When to rewrite prompts.", effect: "Rewrites prompts.", applies: "next-session", kind: "select", options: [{ value: "off", label: "Off", hint: "never" }, { value: "trigger", label: "Trigger" }, { value: "always", label: "Always" }], value: "off", scope: "hooks", layers: L("off", "off") },
  { key: "ATLAS_DECISION_MODEL", title: "Decision model", description: "Classifier model.", effect: "Picks the classifier.", applies: "next-session", kind: "model", value: "nimble:latest", scope: "hooks", layers: L("nimble:latest", "nimble:latest") },
  { key: "ATLAS_OPTIMIZE_CMD", title: "Optimizer command", description: "Shell command.", effect: "Runs per prompt.", applies: "next-session", kind: "command", value: "", scope: "hooks", layers: L("", "") },
  { key: "ATLAS_OLLAMA_URL", title: "Ollama URL", description: "Server.", effect: "Where models load.", applies: "next-session", kind: "url", value: "http://127.0.0.1:11434", scope: "hooks", layers: L("http://127.0.0.1:11434", "http://127.0.0.1:11434") },
  { key: "ATLAS_HOOK_BRIDGE", title: "Hook bridge", description: "omp bridge.", effect: "Enables the bridge.", applies: "next-session", kind: "toggle", on: "1", off: "0", value: "1", scope: "shell",
    layers: { live_env: { supported: true, value: "1" }, claude_settings: { supported: true, value: "1" }, omp_config: { supported: true, value: "1" }, shell_rc: { supported: true, value: "1" } } },
];
const BEHAVIOR = {
  groups: [
    { title: "Guardrails", knobs: [KNOBS[0], KNOBS[1]] }, { title: "Prompt optimizer", knobs: [KNOBS[2], KNOBS[3], KNOBS[4], KNOBS[5]] },
    { title: "omp extension", knobs: [KNOBS[6]] },
  ],
  advanced: [],
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
    post: async (p, b) => { posts.push([p, b]); return extra.post ? extra.post(p, b) : { ok: true, key: Object.keys(b.updates)[0], layers: [{ layer: "store", wrote: "1", got: "1", ok: true }, { layer: "claude_settings", wrote: "1", got: "1", ok: true }], applies: "next-session" }; },
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
  input.value = "999";
  await input.listeners.change();
  expect(input.value).toBe("20");
  expect(api.posts.at(-1)[1].updates.ATLAS_TRIPWIRE_THRESHOLD).toBe("20");
  const [dec] = byClass(row, "st-step");
  await dec.listeners.click();
  expect(api.posts.at(-1)[1].updates.ATLAS_TRIPWIRE_THRESHOLD).toBe("19");
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
  expect(text(row)).toContain("✓ reachable");
  expect(liveVsSaved({ kind: "toggle", off: "off", layers: L("on", "off") })).toBe("live: on · saved: off");
  expect(liveVsSaved({ kind: "toggle", layers: L("on", "on") })).toBe(null);
});

test("shell-scope rows are editable, list the files written and say next session", async () => {
  const api = mkApi();
  const row = SettingRow(KNOBS[6], deps(api));
  expect(text(row)).toContain("Writes: claude settings.json, omp config, ~/.atlas/env.sh");
  expect(text(row)).toContain("next session");
  await byTag(row, "button")[0].listeners.click();
  expect(api.posts.at(-1)[1].updates.ATLAS_HOOK_BRIDGE).toBe("0");
});

test("categoryOf routes decision, colony and storage keys, then groups, else Advanced", () => {
  expect(categoryOf({ key: "ATLAS_DECISION_MODEL" }, "")).toBe("Decision model");
  expect(categoryOf({ key: "ATLAS_COLONY" }, "")).toBe("Colony");
  expect(categoryOf({ key: "ATLAS_DB" }, "omp extension")).toBe("Storage");
  expect(categoryOf({ key: "ATLAS_X" }, "Turn scoring")).toBe("Scoring");
  expect(categoryOf({ key: "ATLAS_X" }, "")).toBe("Advanced");
});

test("the page renders every category in the nav and the sections, with counts", async () => {
  const root = await mountPage(mkApi());
  const nav = byClass(root, "st-nav")[0];
  const labels = byClass(nav, "st-nav-item").map((b) => b.children[0].text);
  expect(labels).toEqual(["Preferences", "Session automation", "Guardrails", "Prompt optimizer", "Decision model", "Storage", "Colony", "Scoring", "Integrations", "Ecosystem", "Connectors", "Agents", "Advanced"]);
  expect(byClass(root, "st-cat").length).toBe(13);
  const counts = Object.fromEntries(byClass(nav, "st-nav-item").map((b) => [b.children[0].text, b.children.at(-1).textContent]));
  expect(counts.Preferences).toBe("6");
  expect(counts.Guardrails).toBe("2");
  expect(counts["Prompt optimizer"]).toBe("3");
  expect(counts["Decision model"]).toBe("1");
  page.destroy();
});

test("the filter narrows rows across categories and updates the counts", async () => {
  const root = await mountPage(mkApi());
  const filter = byClass(root, "st-filter")[0];
  filter.value = "threshold";
  filter.listeners.input();
  const visible = byClass(root, "st-card").filter((c) => !c.hidden);
  expect(visible.map((c) => c.attrs.id)).toEqual(["st-ATLAS_TRIPWIRE_THRESHOLD-row"]);
  const nav = byClass(root, "st-nav")[0];
  const counts = Object.fromEntries(byClass(nav, "st-nav-item").map((b) => [b.children[0].text, b.children.at(-1).textContent]));
  expect(counts.Guardrails).toBe("1");
  expect(counts.Preferences).toBe("0");
  page.destroy();
});

test("preferences use the same row component and verify against the saved state", async () => {
  const root = await mountPage(mkApi());
  const theme = byClass(root, "st-card").find((c) => c.attrs.id === "st-theme-row");
  const sel = byTag(theme, "select")[0];
  sel.value = "light";
  await sel.listeners.change();
  expect(byClass(theme, "st-status")[0].textContent).toBe("✓ verified · dashboard prefs");
  page.destroy();
});
