import { test, expect, afterEach } from "bun:test";

// Minimal DOM stand-in (no DOM lib is installed): enough for h()/replace() and the workspace page.
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.isConnected = false; this.style = {}; this.textContent = ""; }
  appendChild(c) { this.children.push(c); if (c instanceof N) c.parent = this; if (c instanceof N) c.isConnected = this.isConnected || this.root === true; return c; }
  replaceChildren(...c) { this.children = []; c.forEach((x) => x && this.appendChild(x)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  insertBefore(c) { return this.appendChild(c); }
  contains() { return false; }
  focus() { this.focused = true; }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); }
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
  parser = { registerOscHandler: (id, fn) => { this.osc = this.osc || {}; this.osc[id] = fn; return { dispose() {} }; } };
  loadAddon() {} open() {} focus() {} dispose() { this.disposed = true; } reset() { this.out = ""; }
  write(d) { this.out += typeof d === "string" ? d : "<bytes>"; }
  onData(fn) { this.dataFn = fn; return { dispose() {} }; }
  onBinary() { return { dispose() {} }; }
  onResize(fn) { this.resizeFn = fn; return { dispose() {} }; }
};
window.FitAddon = { FitAddon: class { fit() {} } };
const sockets = [];
const observers = [];
const IO = globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; this.seen = new Set(); observers.push(this); } observe(el) { this.seen.add(el); if (IO.auto) queueMicrotask(() => this.cb([{ target: el, isIntersecting: true }])); } unobserve(el) { this.seen.delete(el); } disconnect() { this.seen.clear(); } };
IO.auto = true;
globalThis.WebSocket = class {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  send(d) { this.sent.push(JSON.parse(d)); } close() { this.readyState = 3; }
};


const { default: page, TUNE } = await import("./pages/terminal.js");

const seat = (address, extra = {}) => ({ address, name: address.split("@")[0], role: "Code explorer", runtime: "claude", state: "idle", pane: "p1", target: "%" + address.length, kind: "pane", project: "/p", cwd: "/p", started_at: 1, last_activity: Math.floor(Date.now() / 1000) - 12, ...extra });
const SEATS = {
  ok: true, machine: "mac", clock: "2026-10-22T10:00:00Z",
  spaces: [
    { id: "run1", name: "run1", kind: "colony", seats: [seat("lead@run1", { state: "running", runtime: "omp" }), seat("impl@run1", { runtime: "codex", state: "ended", target: null }), seat("shell@run1", { kind: "shell", runtime: "shell", target: null, cwd: "/p" })] },
    { id: "host", name: "host", kind: "host", seats: [seat("shell@host", { kind: "shell", runtime: "shell", target: null, cwd: "/home/u" }), seat("tui@host", { kind: "tui", runtime: "shell", target: null })] },
  ],
};
const tickets = [];
const captures = [];
const mk = (data, params = {}, extra = {}) => ({
  params, project: "/p",
  api: {
    get: async (path, q) => { if (path === "term/seats") return data; captures.push(q.target); return { ok: true, text: "hello\nworld" }; },
    post: async (path, body) => { tickets.push([path, body]); return { ticket: "T" + tickets.length }; },
    ...extra,
  },
});
const walk = (n, out = []) => { if (n && n.children) { out.push(n); n.children.forEach((c) => walk(c, out)); } return out; };
const text = (n) => walk(n).flatMap((x) => x.children.map((c) => c.text)).filter(Boolean).join("|");
const byClass = (n, c) => walk(n).filter((x) => (x.attrs.class || "").split(" ").includes(c));
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const reset = () => { terms.length = 0; sockets.length = 0; tickets.length = 0; captures.length = 0; observers.length = 0; };
const mountCtx = async (ctx) => { const root = page.render(ctx); root.isConnected = true; walk(root).forEach((x) => (x.isConnected = true)); await tick(); return root; };
const mount = (data, params, extra) => mountCtx(mk(data, params, extra));
const click = (el) => el.listeners.click();
// A failed assertion skips the inline page.destroy(), leaking the keydown listener and poll timer into the next test.
afterEach(() => page.destroy());

test("rail lists spaces and `Agents · N`; the grid has one openrig terminal-card per seat in server order, shell seat last", async () => {
  reset();
  const root = await mount(SEATS, { space: "run1" });
  expect(text(root)).toContain("mac · Terminal");
  expect(text(root)).toContain("Agents · 3");
  expect(text(root)).toContain("Code explorer");
  const cards = byClass(root, "terminal-card");
  expect(cards.map((c) => c.attrs["data-address"])).toEqual(["lead@run1", "impl@run1", "shell@run1"]);
  expect(text(cards[0])).toContain("omp");
  expect(text(cards[1])).toContain("Codex CLI");
  expect(text(cards[2])).toContain("Shell");
  expect(byClass(root, "runtime-title").length).toBe(3);
  page.destroy();
});

test("the footer shows state and last_activity age; the spinner only while running", async () => {
  reset();
  // Pin the clock: fmtRelative reads Date.now(), so an age built at module load drifts past 12s on a slow run.
  const realNow = Date.now, NOW = 1_800_000_000_000;
  Date.now = () => NOW;
  try {
    const at = (extra) => seat("x@run1", { last_activity: NOW / 1000 - 12, ...extra });
    const data = { ...SEATS, spaces: [{ id: "run1", name: "run1", kind: "colony", seats: [at({ address: "lead@run1", state: "running", runtime: "omp" }), at({ address: "impl@run1", runtime: "codex", state: "ended", target: null })] }] };
    const root = await mount(data, { space: "run1" });
    const [lead, ended] = byClass(root, "terminal-card");
    expect(text(lead)).toContain("✻");
    expect(text(lead)).toContain("running");
    expect(text(lead)).toContain("12s ago");
    expect(text(ended)).not.toContain("✻");
    expect(text(ended)).toContain("ended");
  } finally { Date.now = realNow; }
});

test("a card connects by ticket: POST term/ticket then ws?ticket= (no token=)", async () => {
  reset();
  await mount(SEATS, { space: "run1" });
  const pane = tickets.find((t) => t[1].kind === "pane");
  expect(pane[0]).toBe("term/ticket");
  expect(pane[1]).toMatchObject({ kind: "pane", target: "%9", project: "/p", cols: 80, rows: 24 });
  const ws = sockets.find((s) => s.url.includes("kind=pane"));
  expect(ws.url).toContain("ws://127.0.0.1:7421/api/v2/term/ws?");
  expect(ws.url).toMatch(/ticket=T\d/);
  expect(ws.url).not.toContain("token=");
  const shell = tickets.find((t) => t[1].kind === "shell");
  expect(shell[1].cwd).toBe("/p");
  expect(sockets.some((s) => s.url.includes("kind=shell"))).toBe(true);
  page.destroy();
});

test("the host space carries a shell seat and the TUI seat; the TUI keeps the OSC 7717 handler", async () => {
  reset();
  const sets = [];
  const ctx = mk(SEATS, { space: "host" });
  ctx.setParams = (p) => sets.push(p);
  const root = await mountCtx(ctx);
  expect(byClass(root, "terminal-card").map((c) => c.attrs["data-address"])).toEqual(["shell@host", "tui@host"]);
  expect(tickets.map((t) => t[1].kind).sort()).toEqual(["shell", "tui"]);
  expect(tickets.find((t) => t[1].kind === "shell")[1].cwd).toBe("/home/u");
  const tui = terms.find((t) => t.osc);
  expect(typeof tui.osc[7717]).toBe("function");
  tui.osc[7717]("open;run1;lead@run1");
  expect(sets.pop()).toEqual({ space: "run1", seat: "lead@run1" });
  tui.osc[7717]("garbage");
  expect(sets.length).toBe(0);
  page.destroy();
});

test("at most 6 sockets are live; the rest show capture text with a paused badge", async () => {
  reset();
  const many = { ...SEATS, spaces: [{ id: "big", name: "big", kind: "colony", seats: Array.from({ length: 8 }, (_, i) => seat("w" + i + "@big", { target: "%" + (10 + i) })) }] };
  const root = await mount(many, { space: "big" });
  expect(sockets.length).toBe(6);
  const paused = byClass(root, "terminal-card").filter((c) => (c.attrs.class || "").includes("is-paused"));
  expect(paused.length).toBe(2);
  expect(paused.every((c) => byClass(c, "paused-badge")[0].hidden === false)).toBe(true);
  expect(captures.sort()).toEqual(["%16", "%17"]);
  expect(terms[6].out).toBe("\x1b[?7lhello\r\nworld");
  page.destroy();
});

test("a card that stays offscreen for TUNE.offscreenMs disconnects, and a paused card takes its slot", async () => {
  reset();
  const saved = TUNE.offscreenMs; TUNE.offscreenMs = 40;
  const many = { ...SEATS, spaces: [{ id: "big", name: "big", kind: "colony", seats: Array.from({ length: 7 }, (_, i) => seat("w" + i + "@big", { target: "%" + (10 + i) })) }] };
  await mount(many, { space: "big" });
  const io = observers[observers.length - 1];
  const first = [...io.seen][0];
  expect(sockets.length).toBe(6);
  io.cb([{ target: first, isIntersecting: false }]);
  await tick(10);
  expect(sockets[0].readyState).toBe(0); // still inside the offscreen window
  await tick(60);
  expect(sockets[0].readyState).toBe(3);
  await tick(20);
  expect(sockets.length).toBe(7); // the paused 7th card connected into the freed slot
  TUNE.offscreenMs = saved;
  page.destroy();
});

test("enlarge shows one seat and disconnects the others; back restores the grid; Esc outside the terminal also backs out", async () => {
  reset();
  const sets = [];
  const ctx = mk(SEATS, { space: "run1" });
  ctx.setParams = (p) => sets.push(p);
  const root = await mountCtx(ctx);
  expect(sockets.length).toBe(2);
  const grid = byClass(root, "tw-grid")[0];
  click(byClass(root, "tw-open")[0]);
  await tick();
  expect(sets.pop()).toEqual({ space: "run1", seat: "lead@run1" });
  expect(grid.attrs.class).toContain("enlarged");
  const cards = byClass(root, "terminal-card");
  expect(cards.map((c) => c.hidden)).toEqual([false, true, true]);
  expect(sockets.filter((s) => s.readyState === 3).length).toBe(1); // the shell card closed, lead stays
  expect(byClass(root, "tw-back").length).toBe(1);
  expect(byClass(root, "tw-agent")[0].attrs["aria-current"]).toBe("true");
  click(byClass(root, "tw-back")[0]);
  await tick();
  expect(cards.map((c) => c.hidden)).toEqual([false, false, false]);
  expect(grid.attrs.class).not.toContain("enlarged");
  click(byClass(root, "tw-agent")[0]);
  await tick();
  const esc = keys.find((k) => k[0] === "keydown")[1];
  esc({ key: "Escape", target: { closest: () => ({}) }, shiftKey: false });
  expect(byClass(root, "tw-back").length).toBe(1); // plain Esc inside the xterm belongs to the program
  esc({ key: "Escape", target: {}, shiftKey: false });
  await tick();
  expect(cards.map((c) => c.hidden)).toEqual([false, false, false]);
  page.destroy();
});

test("Enter on a focused card enlarges it and arrows move focus between cards", async () => {
  reset();
  const root = await mount(SEATS, { space: "run1" });
  const cards = byClass(root, "terminal-card");
  const key = (c, k) => c.listeners.keydown({ key: k, target: c, preventDefault() {} });
  key(cards[0], "ArrowRight");
  expect(cards[1].focused).toBe(true);
  key(cards[0], "ArrowDown");
  expect(cards[2].focused).toBe(true);
  key(cards[1], "Enter");
  await tick();
  expect(cards.map((c) => c.hidden)).toEqual([true, false, true]);
  page.destroy();
});

test("?seat=<address> deep link opens that seat enlarged; ?seat= alone finds its space", async () => {
  reset();
  let root = await mount(SEATS, { space: "run1", seat: "lead@run1" });
  expect(byClass(root, "terminal-card").map((c) => c.hidden)).toEqual([false, true, true]);
  expect(tickets.length).toBe(1); // the enlarged seat always connects, even before the observer reports it
  page.destroy();
  reset();
  root = await mount(SEATS, { seat: "tui@host" });
  expect(text(root)).toContain("Agents · 2");
  expect(byClass(root, "terminal-card").map((c) => c.hidden)).toEqual([true, false]);
  expect(tickets.map((t) => t[1].kind)).toEqual(["tui"]);
  page.destroy();
});

test("placeholder: connecting to <address>, then an error line with Retry after TUNE.noFrameMs without a frame", async () => {
  reset();
  const saved = TUNE.noFrameMs; TUNE.noFrameMs = 30;
  const one = { ...SEATS, spaces: [{ id: "r", name: "r", kind: "colony", seats: [seat("lead@r")] }] };
  const root = await mount(one, { space: "r", seat: "lead@r" });
  expect(terms[0].out).toContain("connecting to lead@r…");
  expect(byClass(root, "tw-ph").length).toBe(0);
  await tick(50);
  expect(text(byClass(root, "tw-ph")[0])).toContain("no output from lead@r");
  click(byClass(root, "tw-retry")[0]);
  await tick();
  expect(tickets.length).toBe(2); // Retry fetched a fresh single-use ticket
  expect(sockets.length).toBe(2);
  sockets[1].onmessage({ data: new ArrayBuffer(1) }); // a frame clears the timer
  await tick(50);
  expect(byClass(root, "tw-ph").length).toBe(0);
  TUNE.noFrameMs = saved;
  page.destroy();
});

test("ws close shows a visible reconnect status and reconnects with a new ticket", async () => {
  reset();
  const one = { ...SEATS, spaces: [{ id: "r", name: "r", kind: "colony", seats: [seat("lead@r")] }] };
  const root = await mount(one, { space: "r", seat: "lead@r" });
  sockets[0].onclose();
  expect(text(root)).toContain("disconnected, retrying in 1s");
  await tick(1100);
  expect(sockets.length).toBe(2);
  expect(sockets[1].url).toContain("ticket=T2");
  page.destroy();
});

test("a 4xx behind the ws close renders the server reason and stops retrying", async () => {
  reset();
  const one = { ...SEATS, spaces: [{ id: "r", name: "r", kind: "colony", seats: [seat("lead@r")] }] };
  let n = 0;
  const ctx = mk(one, { space: "r", seat: "lead@r" }, { get: async () => { if (n++) throw Object.assign(new Error("bad_project"), { status: 400, error: "bad_project" }); return one; } });
  const root = await mountCtx(ctx);
  sockets[0].onclose();
  await tick();
  expect(text(root)).toContain("refused by server: bad_project");
  await tick(1100);
  expect(sockets.length).toBe(1);
  page.destroy();
});

test("All projects: seats are asked with all=1 and the ticket carries no project", async () => {
  reset();
  const asked = [];
  const data = { ...SEATS, spaces: [{ ...SEATS.spaces[1], seats: [{ ...SEATS.spaces[1].seats[0], project: "" }] }] };
  const ctx = { params: { space: "host", seat: "shell@host" }, project: "all", api: { get: async (_p, q) => { asked.push(q); return data; }, post: async (_p, b) => { tickets.push(b); return { ticket: "T" }; } } };
  await mountCtx(ctx);
  expect(asked[0]).toEqual({ all: "1" });
  expect(tickets[0].project).toBeUndefined();
  page.destroy();
});

test("no colony spaces: the empty state says how to start one", async () => {
  reset();
  const root = await mount({ ...SEATS, spaces: [SEATS.spaces[1]] });
  expect(text(root)).toContain("No colonies yet");
  expect(text(root)).toContain("atlas_mux.py spawn-team");
  page.destroy();
});

test("the old all-cards capture polling is gone: live cards are never captured", async () => {
  reset();
  await mount(SEATS, { space: "run1", seat: "lead@run1" });
  await tick(40);
  expect(captures).toEqual([]);
  const src = await Bun.file(new URL("./pages/terminal.js", import.meta.url)).text();
  expect(src).not.toMatch(/pollCaptures|CAPTURE_MS|term\/snapshot/);
  page.destroy();
});

test("cold load of #/terminal: boot never writes #/overview over a deep link", async () => {
  const { bootHash } = await import("./nav-order.js");
  expect(bootHash("")).toBe("#/overview");
  expect(bootHash("#/terminal")).toBeNull();
  expect(bootHash("#/terminal?space=run1&seat=lead%40run1")).toBeNull();
  const app = await Bun.file(new URL("./app.js", import.meta.url)).text();
  expect(app).not.toMatch(/location\.hash\s*=\s*"#\/overview"/); // the late write that clobbered the cold-load hash
  expect(app.indexOf("bootHash(location.hash)")).toBeLessThan(app.indexOf('await Promise.all([api.get("prefs")'));
});

test("stepFont steps 13 -> 10 until the grid reaches 152x30", async () => {
  const { stepFont } = await import("./pages/terminal.js");
  const grid = (w, h) => (n) => ({ cols: Math.floor(w / (n * 0.6)), rows: Math.floor(h / (n * 1.2)) });
  expect(stepFont(grid(1400, 900))).toBe(13);
  expect(stepFont(grid(1180, 900))).toBe(12); // 13px -> 151 cols (< 152), 12px -> 163
  expect(stepFont(grid(1100, 900))).toBeLessThan(13);
  expect(stepFont(grid(1100, 900))).toBeGreaterThanOrEqual(10);
  expect(stepFont(grid(500, 300))).toBe(10);
});

test("sourceLine and parseOpen keep their human-name contract", async () => {
  const { sourceLine, parseOpen } = await import("./pages/terminal.js");
  expect(sourceLine({ source: { project: "tech-tools", lead: "lead-01a146", harness: "omp", session: "S1" } })).toBe("from omp session S1 · lead lead-01a146 · tech-tools");
  expect(sourceLine({ id: "bare" })).toBe("");
  expect(sourceLine({ source: { label: "channel x@y/z", harness: "omp" } })).toBe("channel x@y/z");
  expect(parseOpen("open;c1;seat-a")).toEqual({ space: "c1", seat: "seat-a" });
  expect(parseOpen("open;c1")).toEqual({ space: "c1", seat: "" });
  expect(parseOpen("close;c1")).toBeNull();
});
