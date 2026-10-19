import { test, expect } from "bun:test";

// Minimal DOM stand-in (no DOM lib is installed): enough for h()/replace() and the workspace page.
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.isConnected = false; this.style = {}; this.textContent = ""; }
  appendChild(c) { this.children.push(c); if (c instanceof N) c.isConnected = this.isConnected || this.root === true; return c; }
  replaceChildren(...c) { this.children = []; c.forEach((x) => x && this.appendChild(x)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  insertBefore(c) { return this.appendChild(c); }
  contains() { return false; }
  remove() { this.isConnected = false; }
}
globalThis.Node = N;
const keys = [];
const SELF = {};
globalThis.window = { self: SELF, top: SELF, addEventListener() {}, removeEventListener() {}, __ATLAS_BASE__: "" };
globalThis.location = { protocol: "http:", host: "127.0.0.1:7421", href: "http://127.0.0.1:7421/" };
globalThis.sessionStorage = { getItem: () => null, setItem() {} };
globalThis.document = {
  createElement: (t) => new N(t), createElementNS: (_n, t) => new N(t), createTextNode: (t) => ({ text: t }),
  querySelector: (sel) => (sel.includes("atlas-token") ? { getAttribute: () => "tok123" } : null),
  addEventListener(k, fn) { keys.push([k, fn]); }, removeEventListener(k, fn) { const i = keys.findIndex((x) => x[1] === fn); if (i >= 0) keys.splice(i, 1); },
  documentElement: new N("html"), body: new N("body"), head: new N("head"),
};

const terms = [];
window.Terminal = class {
  constructor(o) { this.opts = o; this.cols = 80; this.rows = 24; this.out = ""; this.sent = []; terms.push(this); }
  loadAddon() {} open() {} focus() {} dispose() { this.disposed = true; } reset() { this.out = ""; }
  write(d) { this.out += typeof d === "string" ? d : "<bytes>"; }
  onData(fn) { this.dataFn = fn; return { dispose() {} }; }
  onResize(fn) { this.resizeFn = fn; return { dispose() {} }; }
};
window.FitAddon = { FitAddon: class { fit() {} } };
const sockets = [];
globalThis.WebSocket = class {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  send(d) { this.sent.push(JSON.parse(d)); } close() { this.readyState = 3; }
};

const { default: page } = await import("./pages/terminal.js");

const SNAP = {
  ok: true, host: "mac", clock: "2026-10-16T20:00:00Z", project: "/p",
  colonies: [{ id: "run1", label: "run1 · audit/high", session: "atlas-run1", transport: "tmux", task: "audit the repo", channel: "c", created: 1, pods: [] }],
  seats: [
    { name: "explorer-ab12", colony: "run1", pod: "explorer", role: "explorer", runtime: "claude", state: "working", target: "%3", exit_code: null },
    { name: "impl-cd34", colony: "run1", pod: "implementer", role: "implementer", runtime: "codex", state: "finished", target: "", exit_code: 0 },
  ],
};
const captures = [];
const mk = (snap, params = {}) => ({ params, project: "/p", api: { get: async (path, q) => { if (path === "term/snapshot") return snap; captures.push(q.target); return { ok: true, text: "hello\nworld" }; } } });
const walk = (n, out = []) => { if (n && n.children) { out.push(n); n.children.forEach((c) => walk(c, out)); } return out; };
const text = (n) => walk(n).flatMap((x) => x.children.map((c) => c.text)).filter(Boolean).join("|");
const byClass = (n, c) => walk(n).filter((x) => (x.attrs.class || "").split(" ").includes(c));
const tick = () => new Promise((r) => setTimeout(r, 10));
const mount = async (snap, params) => { const root = page.render(mk(snap, params)); root.isConnected = true; walk(root).forEach((x) => (x.isConnected = true)); await tick(); return root; };

test("Command Center is the default space and opens a live ws kind=tui", async () => {
  terms.length = 0; sockets.length = 0;
  const root = await mount(SNAP);
  expect(text(root)).toContain("mac · Atlas Colony");
  expect(text(root)).toContain("terminal workspace");
  expect(text(root)).toContain("Atlas Command Center");
  expect(text(root)).toContain("Atlas Command Center · live");
  expect(sockets.length).toBe(1);
  expect(sockets[0].url).toContain("ws://127.0.0.1:7421/api/v2/term/ws?");
  expect(sockets[0].url).toContain("kind=tui");
  expect(sockets[0].url).toContain("token=tok123");
  sockets[0].readyState = 1; sockets[0].onopen();
  expect(sockets[0].sent[0]).toEqual({ t: "resize", cols: 80, rows: 24 });
  terms[0].dataFn("x");
  expect(sockets[0].sent[1]).toEqual({ t: "in", d: "x" });
  page.destroy();
  expect(terms[0].disposed).toBe(true);
});

test("ws close shows a visible reconnect status and reconnects", async () => {
  sockets.length = 0;
  const root = await mount(SNAP);
  sockets[0].onclose();
  expect(text(root)).toContain("disconnected, retrying in 1s");
  await new Promise((r) => setTimeout(r, 1100));
  expect(sockets.length).toBe(2);
  page.destroy();
});

test("colony space lists agents and renders one card per seat from live captures", async () => {
  terms.length = 0; captures.length = 0;
  const root = await mount(SNAP, { space: "run1" });
  expect(text(root)).toContain("Agents · 2");
  expect(text(root)).toContain("run1 / All agents");
  expect(text(root)).toContain("2 agents in run1 · live tmux panes");
  expect(byClass(root, "tw-card").length).toBe(2);
  expect(text(root)).toContain("Claude Code");
  expect(text(root)).toContain("Codex CLI");
  expect(text(root)).toContain("finished, exit 0");
  expect(captures).toContain("%3");
  expect(terms[0].out).toBe("\x1b[?7lhello\r\nworld");
  page.destroy();
});

test("switching spaces from the sidebar, enlarge opens ws kind=pane, back and Esc return to the grid", async () => {
  sockets.length = 0;
  const root = await mount(SNAP);
  byClass(root, "tw-space").find((b) => text(b) === "run1").listeners.click();
  await tick();
  expect(byClass(root, "tw-card").length).toBe(2);
  byClass(root, "tw-open")[0].listeners.click();
  await tick();
  const ws = sockets[sockets.length - 1];
  expect(ws.url).toContain("kind=pane");
  expect(ws.url).toContain("target=%253");
  expect(byClass(root, "tw-back").length).toBe(1);
  byClass(root, "tw-back")[0].listeners.click();
  await tick();
  expect(byClass(root, "tw-card").length).toBe(2);
  // Esc: plain Esc inside the xterm belongs to the worker; outside it returns to the grid
  byClass(root, "tw-agent")[0].listeners.click();
  await tick();
  const esc = keys.find((k) => k[0] === "keydown")[1];
  esc({ key: "Escape", target: { closest: () => ({}) }, shiftKey: false });
  expect(byClass(root, "tw-back").length).toBe(1);
  esc({ key: "Escape", target: {}, shiftKey: false });
  await tick();
  expect(byClass(root, "tw-card").length).toBe(2);
  page.destroy();
});

test("?seat= deep link opens the enlarged pane; unknown space falls back to Command Center", async () => {
  sockets.length = 0;
  await mount(SNAP, { space: "run1", seat: "explorer-ab12" });
  expect(sockets[sockets.length - 1].url).toContain("kind=pane");
  page.destroy();
  sockets.length = 0;
  await mount(SNAP, { space: "nope" });
  expect(sockets[sockets.length - 1].url).toContain("kind=tui");
  page.destroy();
});

test("no colonies: empty state says how to start one", async () => {
  const root = await mount({ ...SNAP, colonies: [], seats: [] });
  expect(text(root)).toContain("No colonies yet");
  expect(text(root)).toContain("atlas_team");
  expect(text(root)).toContain("atlas_mux.py spawn-team");
  page.destroy();
});

test("?seat= alone resolves the colony from the snapshot", async () => {
  sockets.length = 0;
  const root = await mount(SNAP, { seat: "explorer-ab12" });
  expect(sockets.length).toBe(1);
  expect(sockets[0].url).toContain("kind=pane");
  expect(text(root)).toContain("Agents · 2");
  page.destroy();
});

test("All projects: ws url carries no project, snapshot is asked with all=1", async () => {
  sockets.length = 0;
  const asked = [];
  const ctx = { params: {}, project: "all", api: { get: async (_p, q) => { asked.push(q); return SNAP; } } };
  const root = page.render(ctx); root.isConnected = true; walk(root).forEach((x) => (x.isConnected = true)); await tick();
  expect(sockets[0].url).toContain("kind=tui");
  expect(sockets[0].url).not.toContain("project=");
  expect(asked[0]).toEqual({ all: "1" });
  page.destroy();
});

test("a 4xx behind the ws close renders the server reason and stops retrying", async () => {
  sockets.length = 0;
  const ctx = { params: {}, project: "/nope", api: { get: async () => { throw Object.assign(new Error("bad_project"), { status: 400, error: "bad_project" }); } } };
  const root = page.render(ctx); root.isConnected = true; walk(root).forEach((x) => (x.isConnected = true)); await tick();
  sockets[0].onclose();
  await tick();
  expect(text(root)).toContain("refused by server: bad_project");
  await new Promise((r) => setTimeout(r, 1100));
  expect(sockets.length).toBe(1);
  page.destroy();
});

test("stepFont steps 13 -> 10 until the grid reaches 100x30", async () => {
  const { stepFont } = await import("./pages/terminal.js");
  const grid = (w, h) => (n) => ({ cols: Math.floor(w / (n * 0.6)), rows: Math.floor(h / (n * 1.2)) });
  expect(stepFont(grid(1400, 900))).toBe(13);
  const mid = stepFont(grid(700, 420));
  expect(mid).toBeLessThan(13);
  expect(mid).toBeGreaterThanOrEqual(10);
  expect(stepFont(grid(500, 300))).toBe(10);
});
