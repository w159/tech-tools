import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { api, ApiError } from "./api.js";
import { STATES, STATE_WORD, ageSeconds, joinAgents } from "./agents-store.js";
import { SESSION_EXPIRED_TEXT } from "./poll-backoff.js";

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const pane = (pane_id, extra = {}) => ({ pane_id, title: "worker-" + pane_id, cwd: "/p/a", status: "working", state_change_seq: 1, state_changed_at: "2026-10-16T11:59:00Z", ...extra });
const join = (o) => joinAgents({ seen: new Map(), now: NOW, ...o });
const one = (agent, extra = {}) => join({ herd: { agents: [agent] }, ...extra })[0];

describe("vocabulary", () => {
  test("states are ordered by urgency and every one has a word", () => {
    expect(STATES).toEqual(["input", "fail", "working", "idle", "done", "unknown"]);
    expect(STATE_WORD).toEqual({ input: "Needs input", fail: "Failed", working: "Working", idle: "Ready", done: "Done", unknown: "Not measured" });
  });
});

describe("ageSeconds", () => {
  test("null without a record or a since stamp", () => {
    expect(ageSeconds(null)).toBe(null);
    expect(ageSeconds({})).toBe(null);
    expect(ageSeconds({ since: 0 })).toBe(null);
  });
  test("whole seconds from milliseconds, rounded, never negative, now overridable", () => {
    expect(ageSeconds({ since: 10000 }, 25000)).toBe(15);
    expect(ageSeconds({ since: 10000 }, 10499)).toBe(0);
    expect(ageSeconds({ since: 10000 }, 10500)).toBe(1);
    expect(ageSeconds({ since: 50000 }, 10000)).toBe(0);
    const real = Date.now();
    const a = ageSeconds({ since: real - 90000 });
    expect(a).toBeGreaterThanOrEqual(90);
    expect(a).toBeLessThan(95);
  });
});

describe("joinAgents: state vocabulary", () => {
  const stateOf = (status) => one(pane("p", { status })).state;
  test("herd words map to the Command Center states", () => {
    expect(["blocked", "working", "idle", "done", "unknown"].map(stateOf)).toEqual(["input", "working", "idle", "done", "unknown"]);
  });
  test("todo-style and failure words map too, case-insensitively; anything else is unknown", () => {
    expect(["in_progress", "open", "fail", "failed", "error", "needs_input", "BLOCKED", "Failed"].map(stateOf)).toEqual(["working", "idle", "fail", "fail", "fail", "input", "input", "fail"]);
    expect(stateOf(null)).toBe("unknown");
    expect(stateOf(undefined)).toBe("unknown");
    expect(stateOf("wat")).toBe("unknown");
    expect(one(pane("p", { status: "weird" })).rawStatus).toBe("weird");
  });
});

describe("joinAgents: identity", () => {
  test("the title loses the harness glyph and spinner and collapses whitespace; the name is a worker slug when there is one", () => {
    const r = one(pane("p", { title: "π ⠏   Fix   the bug ", label: "ignored label" }));
    expect(r.title).toBe("Fix the bug");
    expect(r.name).toBe("Fix the bug");
    expect(one(pane("p", { title: "π > impl-1" })).name).toBe("impl-1");
    expect(one(pane("p", { title: "* • · spaced out" })).title).toBe("spaced out");
  });
  test("a prompt-like title falls back to a worker-shaped label; a non-slug label is ignored", () => {
    expect(one(pane("p", { title: "Do things", label: "test-engineer-2" })).name).toBe("test-engineer-2");
    expect(one(pane("p", { title: "Do things", label: "Not A Slug" })).name).toBe("Do things");
    expect(one(pane("p", { title: "Do things", label: "  padded-slug  " })).name).toBe("padded-slug");
    expect(one(pane("p", { title: "Do things", label: null })).name).toBe("Do things");
  });
  test("the display title falls back to the name, then the pane id", () => {
    expect(one(pane("pid", { title: "", label: "w-one" })).title).toBe("w-one");
    expect(one(pane("pid", { title: "   ", label: "" })).title).toBe("pid");
    expect(one(pane("pid", { title: undefined })).title).toBe("pid");
  });
  test("slugs need a lowercase start and at least one dash group", () => {
    expect(one(pane("p", { title: "single" })).name).toBe("single");
    expect(one(pane("p", { title: "A-b", label: "x-y" })).name).toBe("x-y");
    expect(one(pane("p", { title: "a-B", label: "x-y" })).name).toBe("x-y");
    expect(one(pane("p", { title: "1a-b", label: "x-y" })).name).toBe("x-y");
    expect(one(pane("p", { title: "a1-b2-c3" })).name).toBe("a1-b2-c3");
  });
  test("agent kinds, including aliases, case and the unknown bucket", () => {
    const k = (agent) => one(pane("p", { agent })).kind;
    expect(["omp", "claude", "codex", "shell", "pi", "claude-code", "claude_code", "Codex", "CLAUDE"].map(k)).toEqual(["omp", "claude", "codex", "shell", "omp", "claude", "claude", "codex", "claude"]);
    expect(k("vim")).toBe("unknown");
    expect(k(undefined)).toBe("unknown");
    expect(k(null)).toBe("unknown");
  });
  test("pane fields are carried over with safe defaults", () => {
    const r = one({ pane_id: "p9", title: "w-a", status: "idle", state_change_seq: 4, workspace_id: "ws1", workspace: "Alpha", tab_id: "t1", focused: 1, parent_pane: "pp" });
    expect([r.key, r.pane_id, r.workspace_id, r.workspace, r.tab_id, r.seq, r.focused, r.cwd, r.deep_link, r.parent, r.exit, r.task, r.lastMsg, r.colony, r.project, r.children]).toEqual(["p9", "p9", "ws1", "Alpha", "t1", 4, true, "", "", "pp", null, "", "", false, null, []]);
    const f = one(pane("p", { focused: undefined, deep_link: "http://x/y", cwd: "/c" }));
    expect([f.focused, f.deep_link, f.cwd]).toEqual([false, "http://x/y", "/c"]);
  });
  test("no herd rows is an empty list", () => {
    expect(join({})).toEqual([]);
    expect(join({ herd: {} })).toEqual([]);
  });
});

describe("joinAgents: projects, tasks and messages", () => {
  const projects = { projects: [{ root: "/p" }, { root_path: "/p/a/deeper/" }, { root: "" }, { root: null }] };
  test("the longest matching root wins, a trailing slash is ignored, a sibling prefix does not match", () => {
    expect(one(pane("a", { cwd: "/p/a/deeper/x" }), { projects }).project).toBe("/p/a/deeper/");
    expect(one(pane("a", { cwd: "/p/a" }), { projects }).project).toBe("/p");
    expect(one(pane("a", { cwd: "/p/a/deeper" }), { projects }).project).toBe("/p/a/deeper/");
    expect(one(pane("a", { cwd: "/pq/a" }), { projects }).project).toBe(null);
    expect(one(pane("a", { cwd: "" }), { projects }).project).toBe(null);
    expect(one(pane("a", { cwd: "/p" }), { projects }).project).toBe("/p");
  });
  test("tasks match by claimed_by, owner or launch target; the active task is in_progress, then blocked, then the first", () => {
    const todos = { phases: [{ items: [
      { content: "first", owner: "worker-a", status: "open" },
      { content: "blocked one", claimed_by: "worker-a", status: "blocked" },
      { content: "other", owner: "someone-else", status: "in_progress" },
      { content: "by launch", launch: { target: "a" }, status: "open" },
    ] }] };
    const r = one(pane("a"), { todos });
    expect(r.tasks.map((t) => t.content)).toEqual(["first", "blocked one", "by launch"]);
    expect(r.task).toBe("blocked one");
    const only = one(pane("a"), { todos: { phases: [{ items: [{ content: "solo", owner: "worker-a", status: "open" }] }] } });
    expect(only.task).toBe("solo");
    const prog = one(pane("a"), { todos: { phases: [{ items: [{ content: "b", owner: "worker-a", status: "blocked" }, { content: "p", owner: "worker-a", status: "in_progress" }] }] } });
    expect(prog.task).toBe("p");
  });
  test("todos may arrive as a flat items list when the phases hold nothing", () => {
    const r = one(pane("a"), { todos: { phases: [{ items: [] }], items: [{ content: "flat", owner: "worker-a", status: "open" }] } });
    expect(r.tasks.map((t) => t.content)).toEqual(["flat"]);
    const phased = one(pane("a"), { todos: { phases: [{ items: [{ content: "ph", owner: "worker-a" }] }], items: [{ content: "flat", owner: "worker-a" }] } });
    expect(phased.tasks.map((t) => t.content)).toEqual(["ph"]);
    expect(one(pane("a"), { todos: { phases: [{}] } }).tasks).toEqual([]);
  });
  test("a lead pane without a session takes the project's live items only; done items and other projects stay out", () => {
    const todos = { phases: [{ items: [
      { content: "live", project: "/p", status: "open" },
      { content: "going", project: "/p/", status: "in_progress" },
      { content: "closed", project: "/p", status: "done" },
      { content: "blocked", project: "/p", status: "blocked" },
      { content: "elsewhere", project: "/q", status: "open" },
    ] }] };
    const r = one(pane("l", { title: "Please do the thing", cwd: "/p/sub" }), { todos, projects: { projects: [{ root: "/p" }] } });
    expect(r.tasks.map((t) => t.content)).toEqual(["live", "going"]);
    const noProject = one(pane("l", { title: "Please do the thing", cwd: "/zzz" }), { todos, projects: { projects: [{ root: "/p" }] } });
    expect(noProject.tasks).toEqual([]);
    const worker = one(pane("l", { title: "impl-x", cwd: "/p/sub" }), { todos, projects: { projects: [{ root: "/p" }] } });
    expect(worker.tasks).toEqual([]);
  });
  test("a lead session id strips odd characters and truncates to six for its channel suffix", () => {
    const todos = { phases: [{ items: [
      { content: "mine", project: "/p", status: "open", channel: "x@y/lead-ab12-3" },
      { content: "theirs", project: "/p", status: "open", channel: "x@y/lead-zzzzzz" },
      { content: "nochan", project: "/p", status: "open" },
    ] }] };
    const r = one({ ...pane("l", { title: "Please do the thing", cwd: "/p" }), session_id: "ab12-3!!!9999" }, { todos, projects: { projects: [{ root: "/p" }] } });
    expect(r.tasks.map((t) => t.content)).toEqual(["mine"]);
  });
  test("messages: addressed to or from the name or the pane key; items is accepted for messages", () => {
    const irc = { items: [
      { from: "worker-a", to: "all", body: "from name" },
      { from: "lead", to: "a", body: "to key" },
      { from: "a", to: "lead", body: "from key" },
      { from: "lead", to: "worker-a", body: "to name" },
      { from: "x", to: "y", body: "noise" },
    ] };
    const r = one(pane("a"), { irc });
    expect(r.messages.map((m) => m.body)).toEqual(["from name", "to key", "from key", "to name"]);
    expect(r.lastMsg).toBe("to name");
    expect(one(pane("a"), { irc: { messages: irc.items, items: [] } }).messages.length).toBe(4);
  });
  test("lastMsg skips exit lines and empty bodies", () => {
    const irc = { messages: [
      { from: "worker-a", body: "real" },
      { from: "worker-a", body: "" },
      { from: "worker-a", kind: "exit", body: "exit 0" },
    ] };
    expect(one(pane("a"), { irc }).lastMsg).toBe("real");
  });
  test("colony membership comes from pane_id, id or pane", () => {
    const colony = { panes: [{ pane_id: "a" }, { id: "b" }, { pane: "c" }, {}] };
    const [a, b, c, d] = join({ herd: { agents: ["a", "b", "c", "d"].map((k) => pane(k)) }, colony }).sort((x, y) => x.key.localeCompare(y.key));
    expect([a.colony, b.colony, c.colony, d.colony]).toEqual([true, true, true, false]);
  });
});

describe("joinAgents: exits", () => {
  const withExit = (status, body, kind = "exit") => one(pane("a", { status }), { irc: { messages: [{ from: "worker-a", kind, body }] } });
  test("a non-zero exit turns a finished, idle or unknown agent into a failure and records code and error", () => {
    for (const s of ["done", "idle", "unknown"]) expect(withExit(s, "exit 2 [failed: boom town]").state).toBe("fail");
    const r = withExit("done", "exit 2 [failed: boom town]");
    expect(r.exit).toEqual({ code: 2, error: "boom town" });
    expect(withExit("done", "exit -1").exit).toEqual({ code: -1, error: "" });
    expect(withExit("done", "exit -1").state).toBe("fail");
  });
  test("exit 0, a working agent, a blocked agent, or a non-exit line leave the state alone", () => {
    expect(withExit("done", "exit 0").state).toBe("done");
    expect(withExit("done", "exit 0").exit).toEqual({ code: 0, error: "" });
    expect(withExit("working", "exit 3").state).toBe("working");
    expect(withExit("blocked", "exit 3").state).toBe("input");
    expect(withExit("done", "exit 3", "msg").state).toBe("done");
    expect(withExit("done", "exit 3", "msg").exit).toBe(null);
    expect(withExit("done", "no exit here").exit).toBe(null);
    expect(withExit("done", "  exit 3").exit).toBe(null);
  });
  test("only the latest exit line counts", () => {
    const irc = { messages: [{ from: "worker-a", kind: "exit", body: "exit 5" }, { from: "worker-a", kind: "exit", body: "exit 0" }] };
    const r = one(pane("a", { status: "done" }), { irc });
    expect([r.state, r.exit.code]).toEqual(["done", 0]);
  });
  test("an exit line without a body is ignored", () => {
    expect(one(pane("a", { status: "done" }), { irc: { messages: [{ from: "worker-a", kind: "exit" }] } }).exit).toBe(null);
  });
});

describe("joinAgents: age", () => {
  test("a daemon stamp wins; first_seen marks it approximate", () => {
    const exact = one(pane("a", { state_changed_at: "2026-10-16T11:00:00Z", state_changed_source: "daemon" }));
    expect([exact.since, exact.sinceApprox]).toEqual([Date.parse("2026-10-16T11:00:00Z"), false]);
    const approx = one(pane("a", { state_changed_at: "2026-10-16T11:00:00Z", state_changed_source: "first_seen" }));
    expect(approx.sinceApprox).toBe(true);
  });
  test("without a stamp the first sighting counts from now (approximate) and is remembered per sequence", () => {
    const seen = new Map();
    const agent = pane("a", { state_changed_at: undefined, state_change_seq: 7 });
    const first = joinAgents({ herd: { agents: [agent] }, seen, now: NOW })[0];
    expect([first.since, first.sinceApprox]).toEqual([NOW, true]);
    expect(seen.get("a")).toEqual({ seq: 7, at: NOW, approx: true });
    const again = joinAgents({ herd: { agents: [agent] }, seen, now: NOW + 5000 })[0];
    expect([again.since, again.sinceApprox]).toEqual([NOW, true]);
    const changed = joinAgents({ herd: { agents: [{ ...agent, state_change_seq: 8 }] }, seen, now: NOW + 9000 })[0];
    expect([changed.since, changed.sinceApprox]).toEqual([NOW + 9000, false]);
    expect(seen.get("a")).toEqual({ seq: 8, at: NOW + 9000, approx: false });
    const stays = joinAgents({ herd: { agents: [{ ...agent, state_change_seq: 8 }] }, seen, now: NOW + 20000 })[0];
    expect([stays.since, stays.sinceApprox]).toEqual([NOW + 9000, false]);
  });
  test("an unparseable stamp is treated as absent", () => {
    const r = one(pane("a", { state_changed_at: "garbage" }));
    expect([r.since, r.sinceApprox]).toEqual([NOW, true]);
  });
  test("now defaults to the clock", () => {
    const before = Date.now();
    const r = joinAgents({ herd: { agents: [pane("a", { state_changed_at: undefined })] }, seen: new Map() })[0];
    expect(r.since).toBeGreaterThanOrEqual(before);
    expect(r.since).toBeLessThanOrEqual(Date.now());
  });
});

describe("joinAgents: tree and order", () => {
  test("children attach to a parent that exists; unknown parents are left alone", () => {
    const out = join({ herd: { agents: [pane("p"), pane("c1", { parent_pane: "p" }), pane("c2", { parent_pane: "p" }), pane("o", { parent_pane: "missing" })] } });
    const p = out.find((r) => r.key === "p");
    expect(p.children.map((c) => c.key).sort()).toEqual(["c1", "c2"]);
    expect(out.find((r) => r.key === "o").children).toEqual([]);
  });
  test("sorted by urgency, then newest state change, then key", () => {
    const t = (iso) => iso;
    const agents = [
      pane("z-done", { status: "done" }),
      pane("b-work-old", { status: "working", state_changed_at: t("2026-10-16T10:00:00Z") }),
      pane("a-work-new", { status: "working", state_changed_at: t("2026-10-16T11:30:00Z") }),
      pane("m-input", { status: "blocked", state_changed_at: t("2026-10-16T08:00:00Z") }),
      pane("k-fail", { status: "failed", state_changed_at: t("2026-10-16T09:00:00Z") }),
      pane("c-tie", { status: "idle" }),
      pane("b-tie", { status: "idle" }),
      pane("y-unknown", { status: "zzz" }),
    ];
    expect(join({ herd: { agents } }).map((r) => r.key)).toEqual(["m-input", "k-fail", "a-work-new", "b-work-old", "b-tie", "c-tie", "z-done", "y-unknown"]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The store itself. A fresh module copy per test (?n=) with api methods, timers and document stubbed.

const SAVED = {};
const API_KEYS = ["get", "post", "probe", "stream"];
let n = 0;
let h;

async function mount({ routes = {}, hidden = false } = {}) {
  const timers = { timeouts: [], intervals: [], clearedT: [], clearedI: [] };
  const docListeners = {};
  const streams = [];
  const calls = [];
  h = { timers, docListeners, streams, calls, routes, doc: null, errors: [] };
  globalThis.setTimeout = (fn, ms) => { timers.timeouts.push({ fn, ms }); return timers.timeouts.length; };
  globalThis.clearTimeout = (id) => { timers.clearedT.push(id); };
  globalThis.setInterval = (fn, ms) => { timers.intervals.push({ fn, ms }); return timers.intervals.length; };
  globalThis.clearInterval = (id) => { timers.clearedI.push(id); };
  globalThis.document = { hidden, addEventListener: (k, f) => { (docListeners[k] = docListeners[k] || []).push(f); }, removeEventListener() {}, querySelector: () => null };
  h.doc = globalThis.document;
  api.get = async (path, params) => {
    calls.push([path, params]);
    const r = h.routes[path];
    const v = typeof r === "function" ? await r(params) : r;
    if (v instanceof Error) throw v;
    if (v === undefined) throw new ApiError(404, "no route " + path);
    return v;
  };
  api.post = async (path, body) => { calls.push(["POST " + path, body]); const r = h.routes["POST " + path]; if (r instanceof Error) throw r; return r || {}; };
  api.probe = async () => { calls.push(["probe"]); const r = h.routes.probe; return typeof r === "function" ? r() : r || { up: true, data: {} }; };
  api.stream = (opts) => { const s = { opts, closed: false, close() { this.closed = true; } }; streams.push(s); return s; };
  console.error = (...a) => h.errors.push(a);
  return (await import("./agents-store.js?n=" + ++n)).agentsStore;
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const HERD = { herdr: { reachable: true }, web_ui: { healthy: true, url: "http://h:1", auth_required: true }, workspaces: [{ workspace_id: "w1", label: "Alpha", focused: true, pane_count: 2 }], agents: [
  { pane_id: "a", title: "impl-a", status: "working", workspace_id: "w1", workspace: "Alpha", cwd: "/p", state_change_seq: 1, state_changed_at: "2026-10-16T11:59:00Z" },
  { pane_id: "b", title: "impl-b", status: "blocked", workspace_id: "w1", workspace: "Alpha", cwd: "/p", state_change_seq: 1, state_changed_at: "2026-10-16T11:58:00Z" },
] };
const OK = () => ({ "herd/agents": HERD, "herd/status": { backend: "herdr", web_ui: true }, todos: { phases: [] }, irc: { messages: [] }, projects: { projects: [{ root: "/p" }] }, "herd/colony": { panes: [] } });

describe("agents store", () => {
  beforeEach(() => { for (const k of API_KEYS) SAVED[k] = api[k]; SAVED.timers = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "document", "error"].map((k) => [k, k === "error" ? console.error : globalThis[k]]); });
  afterEach(() => {
    for (const k of API_KEYS) api[k] = SAVED[k];
    for (const [k, v] of SAVED.timers) { if (k === "error") console.error = v; else if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  });

  test("before start: empty, not loaded, daemon assumed up, other layers unknown", async () => {
    const s = await mount();
    const st = s.getState();
    expect(st.agents).toEqual([]);
    expect(st.loaded).toBe(false);
    expect(st.counts).toEqual({ input: 0, fail: 0, working: 0, idle: 0, done: 0, unknown: 0, total: 0 });
    expect(st.layers).toEqual({ daemon: { state: "up", reason: "" }, herdr: { state: "unknown", reason: "", backend: "" }, webui: { state: "unknown", url: "", authRequired: false } });
    expect(st.down).toBe(null);
    expect(st.conn).toBe("idle");
    expect(st.project).toBe("all");
    expect(st.projects).toEqual([]);
    expect(s.find(null)).toBe(null);
    expect(s.get("x")).toBe(null);
  });

  test("start loads the fleet, opens the stream for the project with the poll interval, and exposes the joined model", async () => {
    const s = await mount({ routes: OK() });
    await s.start({ project: "/p", pollMs: 5000 });
    const st = s.getState();
    expect(h.streams.length).toBe(1);
    expect([h.streams[0].opts.project, h.streams[0].opts.pollMs]).toEqual(["/p", 5000]);
    expect(st.project).toBe("/p");
    expect(st.loaded).toBe(true);
    expect(st.agents.map((a) => a.key)).toEqual(["b", "a"]);
    expect(st.counts).toEqual({ input: 1, fail: 0, working: 1, idle: 0, done: 0, unknown: 0, total: 2 });
    expect(st.projects).toEqual([{ root: "/p" }]);
    expect(st.layers.herdr).toEqual({ state: "up", reason: "", backend: "herdr" });
    expect(st.layers.webui).toEqual({ state: "up", url: "http://h:1", authRequired: true });
    expect(st.down).toBe(null);
    expect(st.herd).toBe(HERD);
    expect(st.todos).toEqual({ phases: [] });
    expect(st.irc).toEqual({ messages: [] });
    expect(st.sources.herd.ok).toBe(true);
    expect(st.workspaces).toBe(HERD.workspaces);
    const gets = h.calls.map((c) => c[0]);
    expect(gets).toEqual(expect.arrayContaining(["herd/agents", "herd/status", "todos", "irc", "projects"]));
    expect(h.calls.find((c) => c[0] === "irc")[1]).toEqual({ project: "/p", limit: 200 });
    expect(h.calls.find((c) => c[0] === "herd/agents")[1]).toEqual({ project: "/p" });
    expect(h.calls.find((c) => c[0] === "projects")[1]).toBeUndefined();
    expect(h.timers.intervals.map((t) => t.ms)).toEqual([60000]);
  });

  test("start defaults: project all, poll 8000; restarting closes the previous stream and re-clears the projects timer", async () => {
    const s = await mount({ routes: OK() });
    await s.start();
    expect([h.streams[0].opts.project, h.streams[0].opts.pollMs]).toEqual(["all", 8000]);
    await s.start({ project: "/p" });
    expect(h.streams[0].closed).toBe(true);
    expect(h.streams.length).toBe(2);
    expect(h.timers.clearedI.length).toBeGreaterThanOrEqual(2);
  });

  test("stream mode changes drive state.conn; going live refreshes", async () => {
    const s = await mount({ routes: OK() });
    await s.start({});
    const { onMode, poll } = h.streams[0].opts;
    const before = h.calls.length;
    onMode("poll");
    expect(s.getState().conn).toBe("poll");
    expect(h.calls.length).toBe(before);
    onMode("reconnecting");
    expect(s.getState().conn).toBe("reconnecting");
    onMode("live");
    await flush();
    expect(s.getState().conn).toBe("live");
    expect(h.calls.length).toBeGreaterThan(before);
    const mid = h.calls.length;
    poll();
    await flush();
    expect(h.calls.length).toBeGreaterThan(mid);
    onMode("idle");
    expect(s.getState().conn).toBe("idle");
  });

  test("subscribe calls back at once and after real changes only; unsubscribe stops; a throwing subscriber is isolated", async () => {
    const routes = OK();
    const s = await mount({ routes });
    const seen = [];
    const off = s.subscribe((st) => seen.push(st.generation));
    expect(seen).toEqual([0]);
    s.subscribe(() => { throw new Error("bad sub"); });
    expect(h.errors[0][0]).toBe("agents-store subscriber failed");
    await s.start({});
    const gen = s.getState().generation;
    expect(gen).toBeGreaterThan(0);
    const calls = seen.length;
    await s.refresh();
    expect(seen.length).toBe(calls); // nothing changed
    routes["herd/agents"] = { ...HERD, agents: [{ ...HERD.agents[0], status: "idle" }, HERD.agents[1]] };
    await s.refresh();
    expect(seen.length).toBe(calls + 1);
    expect(s.getState().generation).toBe(gen + 1);
    expect([...s.getState().changed]).toEqual(["a"]);
    off();
    routes["herd/agents"] = { ...HERD, agents: [HERD.agents[1]] };
    await s.refresh();
    expect(seen.length).toBe(calls + 1);
    expect(h.errors.length).toBeGreaterThan(1); // the bad subscriber failed again, quietly
  });

  test("changed flags a new agent, a retitle, a task change and a message change", async () => {
    const routes = OK();
    const s = await mount({ routes });
    await s.start({});
    routes.todos = { phases: [{ items: [{ content: "t", owner: "impl-a", status: "open" }] }] };
    await s.refresh();
    expect([...s.getState().changed]).toEqual(["a"]);
    routes.irc = { messages: [{ from: "impl-b", to: "x", body: "hi" }] };
    await s.refresh();
    expect([...s.getState().changed]).toEqual(["b"]);
    routes["herd/agents"] = { ...HERD, agents: [{ ...HERD.agents[0], title: "impl-a2" }, HERD.agents[1], { pane_id: "c", title: "impl-c", status: "idle" }] };
    await s.refresh();
    expect([...s.getState().changed].sort()).toEqual(["a", "c"]);
  });

  test("layers: herdr down names its reason; the first failing layer is reported", async () => {
    const routes = OK();
    routes["herd/agents"] = { ...HERD, herdr: { reachable: false, reason: "socket gone" }, web_ui: { healthy: false } };
    const s = await mount({ routes });
    await s.start({});
    const st = s.getState();
    expect(st.layers.herdr).toEqual({ state: "down", reason: "socket gone", backend: "herdr" });
    expect(st.layers.webui).toEqual({ state: "down", url: "", authRequired: false });
    expect(st.down).toBe("herdr");
  });

  test("layers: only the web UI down; a herd answer without herdr info is down with no reason; no web_ui block is unknown", async () => {
    const routes = OK();
    routes["herd/agents"] = { ...HERD, web_ui: { healthy: false, url: "u" } };
    let s = await mount({ routes });
    await s.start({});
    expect(s.getState().down).toBe("webui");
    expect(s.getState().layers.webui).toEqual({ state: "down", url: "u", authRequired: false });
    routes["herd/agents"] = { agents: [] };
    s = await mount({ routes });
    await s.start({});
    expect(s.getState().layers.herdr).toEqual({ state: "down", reason: "", backend: "herdr" });
    expect(s.getState().layers.webui).toEqual({ state: "unknown", url: "", authRequired: false });
  });

  test("layers: a runtime without a web UI is never down at that layer", async () => {
    const routes = OK();
    routes["herd/status"] = { backend: "rig", web_ui: false };
    routes["herd/agents"] = { ...HERD, web_ui: { healthy: false } };
    const s = await mount({ routes });
    await s.start({});
    expect(s.getState().layers.webui).toEqual({ state: "unknown", url: "", authRequired: false, none: true });
    expect(s.getState().layers.herdr.backend).toBe("rig");
    expect(s.getState().down).toBe(null);
  });

  test("a network failure probes the daemon: unreachable marks the daemon layer down with the error; an HTTP error does not", async () => {
    const routes = OK();
    routes["herd/agents"] = new ApiError(0, "Cannot reach the Atlas dashboard");
    routes.probe = { up: false };
    let s = await mount({ routes });
    await s.start({});
    let st = s.getState();
    expect(st.layers.daemon).toEqual({ state: "down", reason: "Cannot reach the Atlas dashboard" });
    expect(st.down).toBe("daemon");
    expect(st.loaded).toBe(true); // a recorded failure still counts as loaded
    expect(st.sources.herd).toMatchObject({ ok: false, error: "Cannot reach the Atlas dashboard", code: 0 });
    routes["herd/agents"] = new ApiError(500, "boom", "because");
    s = await mount({ routes });
    await s.start({});
    st = s.getState();
    expect(st.layers.daemon.state).toBe("up");
    expect(st.sources.herd).toMatchObject({ ok: false, error: "boom", why: "because", code: 500 });
    expect(h.calls.some((c) => c[0] === "probe")).toBe(false);
    routes["herd/agents"] = new ApiError(0, "Cannot reach");
    routes.probe = { up: true };
    s = await mount({ routes });
    await s.start({});
    expect(s.getState().layers.daemon).toEqual({ state: "up", reason: "" });
  });

  test("a plain Error is recorded by its message with code 0; a thrown string by itself", async () => {
    const routes = OK();
    routes.todos = new Error("plain failure");
    routes.irc = () => { throw "str"; };
    const s = await mount({ routes });
    await s.start({});
    const src = s.getState().sources;
    expect(src.todos).toMatchObject({ ok: false, error: "plain failure", why: "", code: 0 });
    expect(src.irc).toMatchObject({ ok: false, error: "str", code: 0 });
    expect(src.herd.ok).toBe(true);
    expect(src.herd.error).toBe("");
    expect(typeof src.herd.at).toBe("number");
  });

  test("workspaces roll up the most urgent child; sorted by urgency then label; panes with unknown workspaces get a derived group", async () => {
    const routes = OK();
    routes["herd/agents"] = { ...HERD, workspaces: [
      { workspace_id: "w1", label: "Zeta", pane_count: 2 },
      { workspace_id: "w2", label: "Beta", pane_count: 1 },
      { workspace_id: "w3", label: "Empty", pane_count: 0 },
      { workspace_id: "w4", label: "Quiet", pane_count: 3 },
    ], agents: [
      { pane_id: "a", title: "impl-a", status: "working", workspace_id: "w1", state_changed_at: "2026-10-16T11:59:00Z" },
      { pane_id: "b", title: "impl-b", status: "done", workspace_id: "w1", state_changed_at: "2026-10-16T11:59:00Z" },
      { pane_id: "c", title: "impl-c", status: "done", workspace_id: "w2", state_changed_at: "2026-10-16T11:59:00Z" },
      { pane_id: "d", title: "impl-d", status: "blocked", workspace_id: "ghost", workspace: "Ghosty", state_changed_at: "2026-10-16T11:59:00Z" },
      { pane_id: "e", title: "impl-e", status: "idle", workspace_id: "ghost2", state_changed_at: "2026-10-16T11:59:00Z" },
    ] };
    const s = await mount({ routes });
    await s.start({});
    const tree = s.getState().tree;
    expect(tree.map((w) => [w.id, w.label, w.state, w.agents.map((a) => a.key).sort()])).toEqual([
      ["ghost", "Ghosty", "input", ["d"]],
      ["w1", "Zeta", "working", ["a", "b"]],
      ["ghost2", "ghost2", "idle", ["e"]],
      ["w2", "Beta", "done", ["c"]],
      ["w4", "Quiet", "unknown", []],
    ]);
    expect(tree.find((w) => w.id === "w1").paneCount).toBe(2);
    expect(tree.find((w) => w.id === "ghost").paneCount).toBe(0);
    expect(tree.find((w) => w.id === "ghost").focused).toBe(false);
  });

  test("subagents render under their parent, not at the top of the tree", async () => {
    const routes = OK();
    routes["herd/agents"] = { ...HERD, agents: [
      { pane_id: "p", title: "impl-p", status: "working", workspace_id: "w1" },
      { pane_id: "c", title: "impl-c", status: "working", workspace_id: "w1", parent_pane: "p" },
      { pane_id: "o", title: "impl-o", status: "working", workspace_id: "w1", parent_pane: "gone" },
    ] };
    const s = await mount({ routes });
    await s.start({});
    expect(s.getState().tree[0].agents.map((a) => a.key).sort()).toEqual(["o", "p"]);
  });

  test("todo owners with no pane are listed as others, sorted, once", async () => {
    const routes = OK();
    routes.todos = { phases: [{ items: [
      { content: "x", owner: "zed", status: "open" },
      { content: "y", claimed_by: "amy", owner: "impl-a", status: "open" },
      { content: "z", owner: "zed", status: "open" },
      { content: "w", status: "open" },
    ] }] };
    const s = await mount({ routes });
    await s.start({});
    expect(s.getState().others).toEqual(["amy", "zed"]);
  });

  test("find resolves a pane key, a worker name, and nothing else; get is by key", async () => {
    const s = await mount({ routes: OK() });
    await s.start({});
    expect(s.find("a").key).toBe("a");
    expect(s.find("impl-b").key).toBe("b");
    expect(s.find("nope")).toBe(null);
    expect(s.find("")).toBe(null);
    expect(s.get("a").name).toBe("impl-a");
    expect(s.get("impl-a")).toBe(null);
  });

  test("lastEventId follows the api", async () => {
    const s = await mount({ routes: OK() });
    api.lastEventId = "77";
    await s.start({});
    expect(s.getState().lastEventId).toBe("77");
    api.lastEventId = "";
  });

  test("onEvent: herd, todos and irc payloads replace the source, mark it ok and emit; wrong shapes are ignored", async () => {
    const routes = OK();
    const s = await mount({ routes });
    await s.start({});
    const { onEvent } = h.streams[0].opts;
    const gen = s.getState().generation;
    onEvent("herd", { agents: [HERD.agents[0]], herdr: { reachable: true } });
    expect(s.getState().agents.map((a) => a.key)).toEqual(["a"]);
    expect(s.getState().generation).toBe(gen + 1);
    onEvent("herd", { nothing: 1 });
    onEvent("herd", null);
    onEvent("todos", { items: [] });
    onEvent("irc", {});
    expect(s.getState().generation).toBe(gen + 1);
    onEvent("todos", { phases: [{ items: [{ content: "n", owner: "impl-a", status: "open" }] }] });
    expect(s.get("a").task).toBe("n");
    onEvent("irc", { items: [{ from: "impl-a", body: "hello" }] });
    expect(s.get("a").lastMsg).toBe("hello");
    onEvent("irc", { messages: [{ from: "impl-a", body: "again" }, { from: "impl-a", body: "and more" }] });
    expect(s.get("a").lastMsg).toBe("and more");
  });

  test("a herd event clears a previous daemon outage", async () => {
    const routes = OK();
    routes["herd/agents"] = new ApiError(0, "Cannot reach");
    routes.probe = { up: false };
    const s = await mount({ routes });
    await s.start({});
    expect(s.getState().down).toBe("daemon");
    h.streams[0].opts.onEvent("herd", HERD);
    expect(s.getState().layers.daemon.state).toBe("up");
  });

  test("route_error marks a known source failed; unknown topics are ignored; subscribers see every raw event", async () => {
    const s = await mount({ routes: OK() });
    await s.start({});
    const { onEvent } = h.streams[0].opts;
    const raw = [];
    const off = s.onEvent((name, data) => raw.push([name, data]));
    s.onEvent(() => { throw new Error("bad raw"); });
    onEvent("route_error", { topic: "herd", error: "kaput" });
    expect(s.getState().sources.herd).toMatchObject({ ok: false, error: "kaput" });
    onEvent("route_error", { topic: "todos", error: "todo down" });
    expect(s.getState().sources.todos.error).toBe("todo down");
    const gen = s.getState().generation;
    onEvent("route_error", { topic: "mystery", error: "x" });
    onEvent("route_error", { error: "no topic" });
    onEvent("route_error", null);
    expect(s.getState().generation).toBe(gen);
    expect(s.getState().sources.mystery).toBeUndefined();
    onEvent("tick", { ts: 1 });
    expect(raw.map((r) => r[0])).toEqual(["route_error", "route_error", "route_error", "route_error", "route_error", "tick"]);
    expect(h.errors.some((e) => e[0] === "agents-store event subscriber failed")).toBe(true);
    off();
    onEvent("tick", {});
    expect(raw.length).toBe(6);
  });

  test("route_error for a source the store has never loaded but knows is still recorded", async () => {
    const s = await mount({ routes: OK() });
    const { onEvent } = (await (async () => { await s.start({}); return h.streams[0].opts; })());
    onEvent("route_error", { topic: "colony", error: "c down" });
    expect(s.getState().sources.colony.error).toBe("c down");
  });

  test("refresh with names loads only those; recheck reloads herd and status; startHerdr posts then rechecks and survives a failed start", async () => {
    const routes = OK();
    const s = await mount({ routes });
    await s.refresh(["todos"]);
    expect(h.calls.map((c) => c[0])).toEqual(["todos"]);
    h.calls.length = 0;
    await s.recheck();
    expect(h.calls.map((c) => c[0]).sort()).toEqual(["herd/agents", "herd/status"]);
    h.calls.length = 0;
    await s.startHerdr();
    expect(h.calls.map((c) => c[0])).toEqual(["POST herd/server/start", "herd/agents", "herd/status"]);
    expect(h.calls[0][1]).toEqual({});
    h.calls.length = 0;
    routes["POST herd/server/start"] = new Error("no start");
    await s.startHerdr();
    expect(h.calls.map((c) => c[0])).toEqual(["POST herd/server/start", "herd/agents", "herd/status"]);
  });

  test("setPollMs restarts the stream only for a new value while started; stop closes it and the timers", async () => {
    const s = await mount({ routes: OK() });
    s.setPollMs(9000);
    expect(h.streams.length).toBe(0);
    await s.start({ pollMs: 4000 });
    s.setPollMs(4000);
    s.setPollMs(0);
    s.setPollMs(null);
    expect(h.streams.length).toBe(1);
    s.setPollMs(9000);
    expect(h.streams.length).toBe(2);
    expect(h.streams[0].closed).toBe(true);
    expect(h.streams[1].opts.pollMs).toBe(9000);
    s.stop();
    expect(h.streams[1].closed).toBe(true);
    s.setPollMs(1000);
    expect(h.streams.length).toBe(2);
    s.stop(); // safe twice
  });

  test("stop prevents the colony poll from continuing and clears both timers", async () => {
    const s = await mount({ routes: OK() });
    await s.start({});
    const release = s.watchColony();
    await flush();
    expect(h.timers.timeouts.length).toBe(1);
    s.stop();
    const before = h.calls.length;
    h.timers.timeouts[0].fn();
    await flush();
    expect(h.calls.length).toBe(before);
    expect(h.timers.clearedI.length).toBeGreaterThan(0);
    release();
  });

  test("the projects timer refreshes projects every minute, but not while hidden", async () => {
    const routes = OK();
    const s = await mount({ routes });
    await s.start({});
    const before = h.calls.filter((c) => c[0] === "projects").length;
    routes.projects = { projects: [{ root: "/new" }] };
    h.doc.hidden = true;
    h.timers.intervals[0].fn();
    await flush();
    expect(h.calls.filter((c) => c[0] === "projects").length).toBe(before);
    h.doc.hidden = false;
    h.timers.intervals[0].fn();
    await flush();
    expect(h.calls.filter((c) => c[0] === "projects").length).toBe(before + 1);
    expect(s.getState().projects).toEqual([{ root: "/new" }]);
  });

  test("colony: watching polls colony panes on a self-rescheduling 8s timer; the last release stops it", async () => {
    const routes = OK();
    routes["herd/colony"] = { panes: [{ pane_id: "a" }] };
    const s = await mount({ routes });
    await s.start({});
    expect(h.calls.some((c) => c[0] === "herd/colony")).toBe(false); // nobody watches
    const r1 = s.watchColony();
    const r2 = s.watchColony();
    await flush();
    expect(h.calls.filter((c) => c[0] === "herd/colony").length).toBe(1);
    expect(h.timers.timeouts.map((t) => t.ms)).toEqual([8000]);
    expect(s.get("a").colony).toBe(true);
    h.timers.timeouts[0].fn();
    await flush();
    expect(h.calls.filter((c) => c[0] === "herd/colony").length).toBe(2);
    r1();
    r1(); // double release counts once
    h.timers.timeouts[h.timers.timeouts.length - 1].fn();
    await flush();
    expect(h.calls.filter((c) => c[0] === "herd/colony").length).toBe(3);
    const timeoutsBefore = h.timers.timeouts.length;
    r2();
    await flush();
    expect(h.timers.timeouts.length).toBe(timeoutsBefore); // watcher count is zero: no new timer
    expect(h.calls.filter((c) => c[0] === "herd/colony").length).toBe(3);
  });

  test("colony failures back off exponentially and a success resets; an auth failure stops polling with the reload message", async () => {
    const routes = OK();
    let mode = "fail";
    routes["herd/colony"] = () => (mode === "fail" ? new ApiError(500, "colony boom") : mode === "auth" ? new ApiError(401, "bad_token") : { panes: [] });
    const s = await mount({ routes });
    await s.start({});
    s.watchColony();
    await flush();
    const last = () => h.timers.timeouts[h.timers.timeouts.length - 1];
    expect(last().ms).toBe(16000);
    last().fn();
    await flush();
    expect(last().ms).toBe(32000);
    mode = "ok";
    last().fn();
    await flush();
    expect(last().ms).toBe(8000);
    mode = "auth";
    const count = h.timers.timeouts.length;
    last().fn();
    await flush();
    expect(h.timers.timeouts.length).toBe(count);
    expect(s.getState().layers.daemon.reason).toBe(SESSION_EXPIRED_TEXT);
  });

  test("colony polling is skipped while the document is hidden and resumes on becoming visible", async () => {
    const s = await mount({ routes: OK(), hidden: true });
    await s.start({});
    s.watchColony();
    await flush();
    expect(h.calls.some((c) => c[0] === "herd/colony")).toBe(false);
    expect(h.timers.timeouts).toEqual([]);
    h.doc.hidden = false;
    h.docListeners.visibilitychange[0]();
    await flush();
    expect(h.calls.filter((c) => c[0] === "herd/colony").length).toBe(1);
  });

  test("becoming visible does nothing before start, or while still hidden, and resets the colony backoff", async () => {
    const routes = OK();
    let fail = true;
    routes["herd/colony"] = () => (fail ? new ApiError(500, "x") : { panes: [] });
    const s = await mount({ routes });
    h.docListeners.visibilitychange[0]();
    await flush();
    expect(h.calls.length).toBe(0);
    await s.start({});
    s.watchColony();
    await flush();
    h.timers.timeouts[h.timers.timeouts.length - 1].fn();
    await flush();
    expect(h.timers.timeouts[h.timers.timeouts.length - 1].ms).toBe(32000);
    h.doc.hidden = true;
    const n0 = h.calls.length;
    h.docListeners.visibilitychange[0]();
    await flush();
    expect(h.calls.length).toBe(n0);
    h.doc.hidden = false;
    fail = true;
    h.docListeners.visibilitychange[0]();
    await flush();
    expect(h.timers.timeouts[h.timers.timeouts.length - 1].ms).toBe(16000); // first failure again, not the third
  });

  test("start clears the previous source data before reloading", async () => {
    const routes = OK();
    const s = await mount({ routes });
    await s.start({});
    expect(s.getState().agents.length).toBe(2);
    routes["herd/agents"] = new ApiError(500, "down now");
    await s.start({ project: "/other" });
    expect(s.getState().agents).toEqual([]);
    expect(s.getState().project).toBe("/other");
  });

  test("each field of an agent counts as a change on its own", async () => {
    const base = { ...HERD.agents[0], label: "impl-a" };
    const items = (...x) => ({ phases: [{ items: x }] });
    const t1 = { content: "t1", owner: "impl-a", status: "in_progress" };
    const scenarios = {
      state: (r) => { r["herd/agents"] = { ...HERD, agents: [{ ...base, status: "idle" }] }; },
      title: (r) => { r["herd/agents"] = { ...HERD, agents: [{ ...base, title: "Pretty name" }] }; },
      task: (r) => { r.todos = items({ ...t1, content: "renamed" }); },
      taskCount: (r) => { r.todos = items(t1, { content: "t2", owner: "impl-a", status: "open" }); },
      messageCount: (r) => { r.irc = { messages: [{ from: "impl-a", body: "x" }] }; },
    };
    for (const [name, mutate] of Object.entries(scenarios)) {
      const routes = OK();
      routes["herd/agents"] = { ...HERD, agents: [base] };
      routes.todos = items(t1);
      const s = await mount({ routes });
      await s.start({});
      const gen = s.getState().generation;
      mutate(routes);
      await s.refresh();
      expect([name, s.getState().generation, [...s.getState().changed]]).toEqual([name, gen + 1, ["a"]]);
    }
  });

  test("a changed error text on a still-failing source is a real change", async () => {
    const routes = OK();
    routes.todos = new Error("first failure");
    const s = await mount({ routes });
    await s.start({});
    const gen = s.getState().generation;
    await s.refresh();
    expect(s.getState().generation).toBe(gen); // same failure: quiet
    routes.todos = new Error("second failure");
    await s.refresh();
    expect(s.getState().generation).toBe(gen + 1);
    expect(s.getState().sources.todos.error).toBe("second failure");
  });

  test("a recovered source is a real change", async () => {
    const routes = OK();
    routes.todos = new Error("bad");
    const s = await mount({ routes });
    await s.start({});
    const gen = s.getState().generation;
    routes.todos = { phases: [] };
    await s.refresh();
    expect(s.getState().generation).toBe(gen + 1);
    expect(s.getState().sources.todos.ok).toBe(true);
  });

  test("events of another name never replace the todo or channel sources, and empty payloads do not throw", async () => {
    const s = await mount({ routes: OK() });
    await s.start({});
    const { onEvent } = h.streams[0].opts;
    const gen = s.getState().generation;
    onEvent("tick", { phases: [{ items: [] }] });
    onEvent("tick", { messages: [{ from: "x" }] });
    onEvent("tick", { items: [{ from: "x" }] });
    onEvent("health", { agents: [] });
    expect(() => { onEvent("todos", null); onEvent("irc", null); onEvent("herd", undefined); }).not.toThrow();
    onEvent("todos", { items: [] });
    onEvent("irc", { other: 1 });
    expect(s.getState().generation).toBe(gen);
    h.streams[0].opts.onMode("poll"); // forces a rebuild from the sources
    expect(s.getState().todos).toEqual({ phases: [] });
    expect(s.getState().irc).toEqual({ messages: [] });
  });

  test("a stream mode report forces a notification even when nothing else changed", async () => {
    const s = await mount({ routes: OK() });
    await s.start({});
    const gens = [];
    s.subscribe((st) => gens.push(st.generation));
    h.streams[0].opts.onMode("poll");
    h.streams[0].opts.onMode("poll");
    expect(gens.length).toBe(3);
    expect(gens[2]).toBe(gens[0] + 2);
  });

  test("start ends with one forced notification after the initial load", async () => {
    const s = await mount({ routes: OK() });
    const gens = [];
    s.subscribe((st) => gens.push(st.generation));
    await s.start({});
    expect(gens.length).toBe(3); // initial, first load, forced
    expect(gens[2]).toBe(gens[1] + 1);
  });

  test("releasing the last watcher stops the colony timer for good", async () => {
    const s = await mount({ routes: OK() });
    await s.start({});
    const r1 = s.watchColony();
    const r2 = s.watchColony();
    await flush();
    const pending = h.timers.timeouts[h.timers.timeouts.length - 1];
    r1();
    const clearedBefore = h.timers.clearedT.length;
    r2();
    expect(h.timers.clearedT.length).toBeGreaterThan(clearedBefore);
    const before = h.calls.filter((c) => c[0] === "herd/colony").length;
    pending.fn();
    await flush();
    expect(h.calls.filter((c) => c[0] === "herd/colony").length).toBe(before);
  });

  test("a hidden-tab visibility event leaves the colony backoff alone", async () => {
    const routes = OK();
    routes["herd/colony"] = () => new ApiError(500, "x");
    const s = await mount({ routes });
    await s.start({});
    s.watchColony();
    await flush();
    const last = () => h.timers.timeouts[h.timers.timeouts.length - 1];
    last().fn();
    await flush(); // two failures so far
    h.doc.hidden = true;
    h.docListeners.visibilitychange[0](); // a hide event is not a reset
    h.doc.hidden = false;
    last().fn();
    await flush();
    expect(last().ms).toBe(60000); // third failure: 8000 * 2^3 capped
  });
});
