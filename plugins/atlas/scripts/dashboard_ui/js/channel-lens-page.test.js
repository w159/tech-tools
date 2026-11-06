import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { body as docBody, installDom, restoreDom } from "./operate-dom-stub.js";

// pages/channel-lens.js against the shared operate-dom stub. Globals are installed per test and restored afterwards;
// the real agents store and api module are reused with their touched members restored.
installDom();
const { MemberBoard, mountChannelLens, recOfMember } = await import("./pages/channel-lens.js");
const { agentsStore } = await import("./agents-store.js");
const { api } = await import("./api.js");
const { HexGlyph } = await import("./components.js");
restoreDom();

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realNow = Date.now;
const NOW = 1_800_000_000_000;
let lenses;
let nodeProto;
let savedRemoveChild;
let savedAgents;
let savedPost;

beforeEach(() => {
  installDom();
  // the stub's node has no removeChild (ChannelList clears with it)
  nodeProto = Object.getPrototypeOf(docBody);
  savedRemoveChild = Object.getOwnPropertyDescriptor(nodeProto, "removeChild");
  nodeProto.removeChild = function (c) { this.children = this.children.filter((x) => x !== c); c.parent = null; return c; };
  globalThis.setTimeout = () => 0; // State() arms 600ms/8s timers; none may fire during a test
  globalThis.clearTimeout = () => {};
  Date.now = () => NOW;
  lenses = [];
  savedAgents = agentsStore.getState().agents;
  savedPost = api.post;
  agentsStore.getState().agents = [];
});
afterEach(() => {
  lenses.forEach((l) => l.destroy());
  agentsStore.getState().agents = savedAgents;
  api.post = savedPost;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  Date.now = realNow;
  if (savedRemoveChild) Object.defineProperty(nodeProto, "removeChild", savedRemoveChild); else delete nodeProto.removeChild;
  restoreDom();
});

// ---- helpers: the stub's selectors only understand one tag or one class, so look nodes up by walking ----
const walk = (n, out = []) => { if (n) { out.push(n); (n.children || []).forEach((c) => walk(c, out)); } return out; };
const hasClass = (n, c) => (n.attrs && n.attrs.class ? n.attrs.class.split(/\s+/).includes(c) : false);
const byClass = (root, c) => walk(root).filter((n) => hasClass(n, c));
const byTag = (root, t) => walk(root).filter((n) => n.tag === t);
const one = (root, c) => { const r = byClass(root, c); if (r.length !== 1) throw new Error(`expected one .${c}, got ${r.length}`); return r[0]; };
const txt = (n) => n.textContent;
const fire = (n, ev, arg) => n.listeners[ev].forEach((f) => f(arg));
const settle = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
const flush = async () => { await settle(); await new Promise((r) => realSetTimeout(r, 0)); await settle(); };

const ch = (name, over = {}) => ({ name, project: "/w/" + name.split("@")[0], branch: name.split("@")[1] || "", members: [], ...over });
const LEAD = (over = {}) => ({ name: "lead-1", kind: "lead", state: "working", ...over });

// mount({ channels, current, detail: {channelName: detail | Error}, params, project, projects })
async function mount(o = {}) {
  const calls = [];
  const spies = { setProject: [], openAgent: [], navigate: [] };
  const data = o.data === undefined ? { current: o.current, channels: o.channels || [] } : o.data;
  const ctx = {
    params: o.params || {},
    project: o.project === undefined ? "proj" : o.project,
    store: { get: (k) => (k === "projects" ? o.projects || [] : null) },
    setProject: (...a) => spies.setProject.push(a),
    openAgent: (...a) => spies.openAgent.push(a),
    navigate: (...a) => spies.navigate.push(a),
    api: {
      get: async (path, q) => {
        calls.push([path, q]);
        if (path === "channels") { if (data instanceof Error) throw data; return o.channelsResult ? o.channelsResult(calls) : data; }
        const name = decodeURIComponent(path.slice("channels/".length));
        const d = o.detail && o.detail[name];
        if (typeof o.detailFn === "function") return o.detailFn(name, q);
        if (d instanceof Error) throw d;
        return d || { channel: { name }, messages: [] };
      },
      post: async () => ({}),
    },
  };
  const host = docBody;
  const lens = mountChannelLens(ctx, host);
  lenses.push(lens);
  if (!o.noWait) await flush();
  return { host, lens, ctx, calls, spies };
}

const MSGS = [{ ts: 1_700_000_000_000, from: "lead-1", to: "all", body: "hello team", delivered: true }, { ts: 1_700_000_100_000, from: "w1", to: "lead-1", body: "ack" }];

// =================================================================== MemberBoard
describe("MemberBoard", () => {
  const row = (over = {}) => ({ name: "w1", role: "subagent", parent: null, pane_id: null, state: "working", counts: { active: 1, open: 2, blocked: 0, done: 3 }, items: [], current: "", note: null, ...over });

  test("no rows -> the empty hint", () => {
    const p = MemberBoard({ rows: [] });
    expect(p.tag).toBe("p");
    expect(p.attrs.class).toBe("dim chan-empty");
    expect(txt(p)).toBe("No members yet. Subagents join when a lead dispatches them.");
  });

  test("a row shows name, role, presence word, todo summary, and placeholders for no item / no note", () => {
    const ul = MemberBoard({ rows: [row()] });
    expect(ul.tag).toBe("ul");
    expect(ul.attrs["aria-label"]).toBe("Member boards");
    const li = one(ul, "mb-row");
    expect(li.attrs["data-role"]).toBe("subagent");
    expect(li.attrs["data-state"]).toBe("working");
    expect(li.attrs["data-nested"]).toBeUndefined();
    expect(li.attrs["data-on"]).toBeUndefined();
    const name = one(li, "mb-name");
    expect(txt(name)).toBe("w1");
    expect(name.attrs.title).toBe("w1");
    expect(txt(one(li, "chip-lite"))).toBe("subagent");
    expect(txt(one(li, "mb-presence"))).toBe("running");
    expect(txt(one(li, "mb-counts"))).toBe("1 active, 2 open, 3 done");
    expect(one(li, "mb-counts").attrs.title).toBe("Todos");
    const now = one(li, "mb-now");
    expect(txt(now.children[0])).toBe("Now");
    expect(txt(now.children[1])).toBe("No item in progress");
    expect(now.children[1].attrs.class).toBe("dim");
    expect(byClass(li, "mb-items").length).toBe(0);
    const note = one(li, "mb-note");
    expect(txt(note)).toBe("No notes yet");
    expect(note.attrs.class).toBe("mb-note dim");
  });

  test("the in-progress item is shown undimmed", () => {
    const li = one(MemberBoard({ rows: [row({ current: "port the parser" })] }), "mb-row");
    const span = one(li, "mb-now").children[1];
    expect(txt(span)).toBe("port the parser");
    expect(span.attrs.class).toBe("");
  });

  test("items show their status word (unknown statuses verbatim) and content with a tooltip", () => {
    const items = [{ status: "open", content: "a" }, { status: "in_progress", content: "b" }, { status: "blocked", content: "c" }, { status: "done", content: "d" }, { status: "weird", content: "e" }];
    const li = one(MemberBoard({ rows: [row({ items })] }), "mb-row");
    const ul = one(li, "mb-items");
    expect(ul.attrs["aria-label"]).toBe("w1 todos");
    const lis = byTag(ul, "li");
    expect(lis.map((x) => x.attrs["data-status"])).toEqual(["open", "in_progress", "blocked", "done", "weird"]);
    expect(lis.map((x) => txt(x.children[0]))).toEqual(["open", "active", "blocked", "done", "weird"]);
    expect(lis.map((x) => txt(x.children[1]))).toEqual(["a", "b", "c", "d", "e"]);
    expect(lis[0].children[1].attrs.title).toBe("a");
    expect(byClass(ul, "dim").length).toBe(0);
  });

  test("at most 8 items are listed, the rest collapse into '+N more'", () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ status: "open", content: "t" + i }));
    const ul8 = one(MemberBoard({ rows: [row({ items: eight })] }), "mb-items");
    expect(byTag(ul8, "li").length).toBe(8);
    const nine = [...eight, { status: "open", content: "t8" }, { status: "done", content: "t9" }];
    const ul = one(MemberBoard({ rows: [row({ items: nine })] }), "mb-items");
    const lis = byTag(ul, "li");
    expect(lis.length).toBe(9);
    expect(txt(lis[8])).toBe("+2 more");
    expect(lis[8].attrs.class).toBe("dim");
    expect(lis.slice(0, 8).map((x) => txt(x.children[1]))).toEqual(eight.map((i) => i.content));
  });

  test("a note shows its text, tooltip and relative age; ts 0 hides the age", () => {
    const withTs = one(MemberBoard({ rows: [row({ note: { text: "halfway", ts: NOW / 1000 - 120 } })] }), "mb-note");
    expect(withTs.attrs.class).toBe("mb-note");
    expect(withTs.attrs.title).toBe("halfway");
    expect(txt(withTs.children[0])).toBe("Note");
    expect(txt(withTs.children[1])).toBe("halfway");
    expect(txt(withTs.children[2])).toBe("2m ago");
    const noTs = one(MemberBoard({ rows: [row({ note: { text: "x", ts: 0 } })] }), "mb-note");
    expect(noTs.children.length).toBe(2);
  });

  test("Message / Clear button follows the selected recipient and calls onTo with the member name", () => {
    const picked = [];
    const ul = MemberBoard({ rows: [row({ name: "a" }), row({ name: "b" })], to: "b", onTo: (n) => picked.push(n) });
    const [a, b] = byClass(ul, "mb-row");
    expect(a.attrs["data-on"]).toBeUndefined();
    expect(b.attrs["data-on"]).toBe("true");
    const ba = byTag(a, "button")[0], bb = byTag(b, "button")[0];
    expect(txt(ba)).toBe("Message");
    expect(ba.attrs["aria-label"]).toBe("Message a");
    expect(txt(bb)).toBe("Clear");
    expect(bb.attrs["aria-label"]).toBe("Stop messaging b");
    ba.click(); bb.click();
    expect(picked).toEqual(["a", "b"]);
  });

  test("without onTo there is no message button", () => {
    expect(byTag(MemberBoard({ rows: [row()] }), "button").length).toBe(0);
  });

  test("Open appears only when the member has a live agent record and onOpen is given", () => {
    const opened = [];
    const rec = { name: "w1", key: "k1", state: "idle" };
    agentsStore.getState().agents = [rec];
    const withOpen = MemberBoard({ rows: [row({ name: "w1" }), row({ name: "w2" })], onOpen: (r) => opened.push(r) });
    const [r1, r2] = byClass(withOpen, "mb-row");
    const open = byTag(r1, "button");
    expect(open.length).toBe(1);
    expect(txt(open[0])).toBe("Open");
    expect(open[0].attrs["aria-label"]).toBe("Open w1");
    open[0].click();
    expect(opened).toEqual([rec]);
    expect(byTag(r2, "button").length).toBe(0);
    expect(byTag(MemberBoard({ rows: [row({ name: "w1" })] }), "button").length).toBe(0);
  });

  test("the live agent record drives the state; a parked member shows the idle glyph", () => {
    agentsStore.getState().agents = [{ name: "w1", key: "k", state: "input" }];
    const li = one(MemberBoard({ rows: [row({ name: "w1", state: "working" })] }), "mb-row");
    expect(li.attrs["data-state"]).toBe("input");
    expect(txt(one(li, "mb-presence"))).toBe("waiting for input");
    expect(byTag(li, "svg")[0].attrs["data-state"]).toBe(HexGlyph("input").attrs["data-state"]);
    agentsStore.getState().agents = [];
    const parked = one(MemberBoard({ rows: [row({ name: "p", state: "parked" })] }), "mb-row");
    expect(parked.attrs["data-state"]).toBe("parked");
    expect(txt(one(parked, "mb-presence"))).toBe("parked");
    expect(byTag(parked, "svg")[0].attrs["data-state"]).toBe(HexGlyph("idle").attrs["data-state"]);
  });

  test("nested marks every non-lead row only", () => {
    const rows = [row({ name: "boss", role: "lead" }), row({ name: "w" })];
    const [boss, w] = byClass(MemberBoard({ rows, nested: true }), "mb-row");
    expect(boss.attrs["data-nested"]).toBeUndefined();
    expect(w.attrs["data-nested"]).toBe("true");
    expect(byClass(MemberBoard({ rows }), "mb-row").every((r) => r.attrs["data-nested"] === undefined)).toBe(true);
  });
});

describe("recOfMember", () => {
  test("matches by name, else by pane id, else nothing", () => {
    const a = { name: "n1", key: "p1" }, b = { name: "n2", key: "p2" };
    agentsStore.getState().agents = [a, b];
    expect(recOfMember({ name: "n2" })).toBe(b);
    expect(recOfMember({ name: "zzz", pane_id: "p1" })).toBe(a);
    expect(recOfMember({ name: "zzz", pane_id: "nope" })).toBeUndefined();
    expect(recOfMember({ name: "zzz" })).toBeUndefined();
    agentsStore.getState().agents = [{ name: "x", key: undefined }];
    expect(recOfMember({ name: "zzz", pane_id: undefined })).toBeUndefined();
  });
});

// =================================================================== mountChannelLens: loading / error / empty
describe("mountChannelLens states", () => {
  test("shows a loading state until the channels arrive", async () => {
    const never = new Promise(() => {});
    const { host } = await mount({ channelsResult: () => never, channels: [ch("a@b")], noWait: true });
    await settle();
    const st = one(host, "state");
    expect(st.attrs.class).toBe("state state-loading");
    expect(st.attrs["aria-busy"]).toBe("true");
  });

  test("a failed channel list shows an error state and Retry reloads", async () => {
    let fail = true;
    const { host, calls } = await mount({ channelsResult: () => { if (fail) throw new Error("boom"); return { current: "a@b", channels: [ch("a@b")] }; }, channels: [ch("a@b")] });
    const st = one(host, "state");
    expect(st.attrs.class).toContain("state-error");
    expect(txt(st)).toContain("boom");
    expect(calls.filter((c) => c[0] === "channels").length).toBe(1);
    fail = false;
    const retry = byTag(st, "button").find((b) => /retry/i.test(txt(b)));
    expect(retry).toBeTruthy();
    retry.click();
    await flush();
    expect(byClass(host, "state-error").length).toBe(0);
    expect(byClass(host, "chan-page").length).toBe(1);
  });

  test("with no channels the page asks to pick a project, offering at most 8 and switching to the chosen one", async () => {
    const projects = Array.from({ length: 10 }, (_, i) => ({ root: "/r" + i, name: i === 1 ? "" : "P" + i }));
    const { host, spies } = await mount({ channels: [], projects });
    const st = one(host, "state");
    expect(st.attrs.class).toBe("state state-empty");
    expect(txt(st)).toContain("No channels in these projects yet");
    expect(txt(st)).toContain("Every project has one main channel named folder@branch.");
    const btns = byTag(byClass(st, "row").find((r) => byTag(r, "button").length), "button");
    expect(btns.map(txt)).toEqual(["P0", "/r1", "P2", "P3", "P4", "P5", "P6", "P7"]);
    btns[1].click();
    expect(spies.setProject).toEqual([["/r1", true]]);
  });

  test("with no channels and no projects there is no project chooser", async () => {
    const { host } = await mount({ channels: [] });
    expect(byClass(host, "row").length).toBe(0);
    expect(txt(one(host, "state"))).toContain("No channels in these projects yet");
  });
});

// =================================================================== mountChannelLens: data loading
describe("mountChannelLens requests", () => {
  test("requests the channel list for the page's project, then the active channel's detail", async () => {
    const { calls } = await mount({ channels: [ch("a@b")], current: "a@b", project: "ctxproj" });
    expect(calls[0]).toEqual(["channels", { project: "ctxproj" }]);
    expect(calls[1]).toEqual(["channels/a%40b", { limit: 100, project: "ctxproj" }]);
  });

  test("a project in the route params wins over the context project", async () => {
    const { calls } = await mount({ channels: [ch("a@b")], current: "a@b", params: { project: "routeproj" }, project: "ctxproj" });
    expect(calls[0][1]).toEqual({ project: "routeproj" });
    expect(calls[1][1]).toEqual({ limit: 100, project: "routeproj" });
  });

  test("project 'all' is not sent with the detail request", async () => {
    const { calls } = await mount({ channels: [ch("a@b")], current: "a@b", project: "all" });
    expect(calls[0][1]).toEqual({ project: "all" });
    expect(calls[1][1]).toEqual({ limit: 100, project: undefined });
  });

  test("the active channel is, in order: the route's channel, the current one, the first main channel, the first channel", async () => {
    const chans = [ch("a@b/l1", { parent: "a@b" }), ch("m@x"), ch("c@d")];
    expect((await mount({ channels: chans, current: "c@d" })).calls[1][0]).toBe("channels/c%40d");
    expect((await mount({ channels: chans, current: "gone" })).calls[1][0]).toBe("channels/m%40x");
    expect((await mount({ channels: chans })).calls[1][0]).toBe("channels/m%40x");
    expect((await mount({ channels: [chans[0]] })).calls[1][0]).toBe("channels/a%40b%2Fl1");
    expect((await mount({ channels: chans, current: "c@d", params: { channel: "m@x" } })).calls[1][0]).toBe("channels/m%40x");
    expect((await mount({ channels: chans, current: "c@d", params: { channel: "missing" } })).calls[1][0]).toBe("channels/c%40d");
  });

  test("no detail request when there are no channels or the list failed", async () => {
    expect((await mount({ channels: [] })).calls.length).toBe(1);
    expect((await mount({ data: new Error("x") })).calls.length).toBe(1);
  });

  test("a second refresh while one is running is ignored; destroy stops all further work", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { lens, calls, host } = await mount({ channels: [ch("a@b")], current: "a@b", channelsResult: async () => { await gate; return { current: "a@b", channels: [ch("a@b")] }; }, noWait: true });
    await lens.refresh(); await lens.refresh();
    expect(calls.filter((c) => c[0] === "channels").length).toBe(1);
    release(); await flush();
    lens.destroy();
    const before = calls.length;
    await lens.refresh();
    lens.repaint();
    expect(calls.length).toBe(before);
    host.replaceChildren();
    lens.repaint();
    expect(host.children.length).toBe(0);
  });

  test("repaint redraws from loaded data and does nothing before the first load", async () => {
    const never = new Promise(() => {});
    const early = await mount({ channelsResult: () => never, channels: [ch("a@b")], noWait: true });
    const before = early.host.children.length;
    early.lens.repaint();
    expect(early.host.children.length).toBe(before);
    expect(byClass(early.host, "chan-page").length).toBe(0);
    installDom();
    const { lens, host } = await mount({ channels: [ch("a@b")], current: "a@b" });
    host.replaceChildren();
    lens.repaint();
    expect(byClass(host, "chan-page").length).toBe(1);
  });

  test("a late detail answer for a channel that is no longer active is dropped, and the next refresh loads the active one", async () => {
    const waiting = [];
    let live = false;
    const { host, lens } = await mount({
      channels: [ch("a@b"), ch("c@d")], current: "a@b",
      detailFn: (name) => (live || (waiting.length === 0 && name === "a@b") ? { channel: { name }, messages: [{ ts: 1_700_000_000_000, from: "x", to: "all", body: "live-" + name }] } : new Promise((res) => { waiting.push([name, res]); })),
    });
    fire(one(host, "chan-pick"), "change", { target: { value: "c@d" } });
    await settle();
    fire(one(host, "chan-pick"), "change", { target: { value: "a@b" } }); // ignored refresh: one is already running
    await settle();
    expect(waiting.map((w) => w[0])).toEqual(["c@d"]);
    waiting[0][1]({ channel: { name: "c@d" }, messages: [{ ts: 1_700_000_000_000, from: "x", to: "all", body: "from-cd" }] });
    await flush();
    expect(txt(one(host, "chan-log"))).not.toContain("from-cd");
    live = true;
    await lens.refresh();
    expect(txt(one(host, "chan-log"))).toContain("live-a@b");
    expect(txt(one(host, "chan-log"))).not.toContain("from-cd");
  });

  test("a late failure for a channel that is no longer active is dropped too", async () => {
    const waiting = [];
    const { host } = await mount({
      channels: [ch("a@b"), ch("c@d")], current: "a@b",
      detailFn: (name) => (waiting.length === 0 && name === "a@b" ? { channel: { name }, messages: [] } : new Promise((res, rej) => { waiting.push([name, res, rej]); })),
    });
    fire(one(host, "chan-pick"), "change", { target: { value: "c@d" } });
    await settle();
    fire(one(host, "chan-pick"), "change", { target: { value: "a@b" } });
    await settle();
    waiting[0][2](new Error("late failure"));
    await flush();
    expect(txt(one(host, "chan-log"))).not.toContain("late failure");
    expect(byClass(host, "state-error").length).toBe(0);
  });
});

// =================================================================== header
describe("mountChannelLens header", () => {
  const MAIN = ch("demo@feat", { project: "/w/demo", branch: "feat", members: [{ name: "w1" }, { name: "w2", deliver: { ok: false, reason: "pane gone" } }] });
  const SUB = ch("demo@feat/lead-1", { parent: "demo@feat", lead: "lead-1", project: "/w/demo", branch: "feat", lead_state: "working", members: [{ name: "w1" }] });

  test("a main channel: current marker, hidden title, info line with reachable count", async () => {
    const { host } = await mount({ channels: [MAIN], current: "demo@feat" });
    const cur = one(host, "chan-cur");
    expect(txt(cur)).toBe("Current channel");
    expect(cur.attrs["data-current"]).toBe("true");
    expect(txt(one(host, "sr-only"))).toBe("demo@feat");
    expect(one(host, "sr-only").tag).toBe("h2");
    expect(one(host, "sr-only").attrs.title).toBe("demo@feat");
    const line = one(host, "chan-line");
    expect(txt(line)).toBe("main channel · feat · project demo · 1 of 2 members can receive");
    expect(line.attrs.title).toBe(txt(line));
    expect(txt(one(host, "chan-explain"))).toContain("A channel is the shared message board of one lead");
    expect(byTag(host, "button").some((b) => txt(b) === "Go to current")).toBe(false);
    expect(byTag(host, "button").some((b) => txt(b) === "Supervise")).toBe(false);
  });

  test("a subchannel: lead and state in the info line, Supervise navigates to the supervision lens", async () => {
    const { host, spies } = await mount({ channels: [MAIN, SUB], current: "demo@feat", params: { channel: SUB.name } });
    expect(txt(one(host, "chan-line"))).toBe("subchannel · lead lead-1 (working) · feat · project demo · 1 of 1 members can receive");
    expect(txt(one(host, "chan-cur"))).toBe("Not the current channel");
    expect(one(host, "chan-cur").attrs["data-current"]).toBe("false");
    const sup = byTag(host, "button").find((b) => txt(b) === "Supervise");
    expect(sup.attrs.title).toBe("Lead to subagents tree with every member's todo board");
    sup.click();
    expect(spies.navigate).toEqual([["agents", { lens: "supervision", channel: SUB.name }]]);
    expect(byClass(host, "grow").length).toBe(1);
  });

  test("lead liveness text wins over lead_state; no lead -> no lead segment", async () => {
    const live = { ...SUB, lead_liveness: { text: "alive 3s" } };
    const { host } = await mount({ channels: [MAIN, live], current: "demo@feat", params: { channel: SUB.name } });
    expect(txt(one(host, "chan-line"))).toContain("lead lead-1 (alive 3s) ·");
    const bare = { ...SUB, lead_state: undefined };
    const r2 = await mount({ channels: [MAIN, bare], current: "demo@feat", params: { channel: SUB.name } });
    expect(txt(one(r2.host, "chan-line"))).toContain("subchannel · lead lead-1 · feat");
    const noLead = await mount({ channels: [{ ...MAIN, branch: "" }], current: "demo@feat" });
    expect(txt(one(noLead.host, "chan-line"))).toBe("main channel · project demo · 1 of 2 members can receive");
  });

  test("Go to current appears only off the current channel and switches to it", async () => {
    const { host, calls } = await mount({ channels: [MAIN, SUB], current: "demo@feat", params: { channel: SUB.name } });
    const go = byTag(host, "button").find((b) => txt(b) === "Go to current");
    go.click();
    await flush();
    expect(calls[calls.length - 1][0]).toBe("channels/demo%40feat");
    expect(txt(one(host, "chan-cur"))).toBe("Current channel");
    expect(byTag(host, "button").some((b) => txt(b) === "Go to current")).toBe(false);
    const none = await mount({ channels: [MAIN, SUB], params: { channel: SUB.name } });
    expect(byTag(none.host, "button").some((b) => txt(b) === "Go to current")).toBe(false);
  });

  test("the channel picker lists every channel (subchannels indented, current marked) and switching resets recipient and reloads", async () => {
    const { host, calls } = await mount({ channels: [MAIN, SUB], current: "demo@feat" });
    const pick = one(host, "chan-pick");
    expect(pick.attrs["aria-label"]).toBe("Switch channel");
    const opts = byTag(pick, "option");
    expect(opts.map(txt)).toEqual(["demo@feat  (current)", "  demo@feat/lead-1"]);
    expect(opts.map((o) => o.value)).toEqual(["demo@feat", "demo@feat/lead-1"]);
    expect(!!opts[0].selected).toBe(true);
    expect(!!opts[1].selected).toBe(false);
    fire(pick, "change", { target: { value: SUB.name } });
    await flush();
    expect(calls[calls.length - 1]).toEqual(["channels/demo%40feat%2Flead-1", { limit: 100, project: "proj" }]);
    expect(txt(one(host, "sr-only"))).toBe(SUB.name);
    expect(byTag(one(host, "chan-pick"), "option").find((o) => o.selected).value).toBe(SUB.name);
  });
});

// =================================================================== member chips
describe("mountChannelLens member chips", () => {
  const MEMBERS = [
    { name: "w1", state: "working", last_seen: new Date(NOW - 90_000).toISOString() },
    { name: "w2", state: "done", deliver: { ok: false, reason: "pane gone" }, live_state: "dead" },
    { name: "w3", parked: true, last_seen: new Date(NOW - 3_600_000).toISOString() },
    { name: "w4", state: "idle", deliver: { ok: true } },
  ];
  const CHAN = ch("a@b", { members: MEMBERS });

  test("each member is a chip with its presence word and last-seen age", async () => {
    const { host } = await mount({ channels: [CHAN], current: "a@b" });
    const chips = byClass(host, "chan-chip");
    expect(chips.length).toBe(4);
    expect(one(host, "chan-chips").attrs["aria-label"]).toBe("Members");
    const main = (i) => one(chips[i], "chan-chip-main");
    expect(txt(main(0))).toBe("w1" + "running · 1m 30s ago");
    expect(txt(main(1))).toBe("w2" + "exited");
    expect(txt(main(2))).toBe("w3" + "parked · last seen 1h ago");
    expect(txt(main(3))).toBe("w4" + "idle");
    expect(chips.map((c) => c.attrs["data-state"])).toEqual(["working", "done", "parked", "idle"]);
  });

  test("unreachable members are disabled and their tooltip carries the reason", async () => {
    const { host } = await mount({ channels: [CHAN], current: "a@b" });
    const mains = byClass(host, "chan-chip-main");
    expect(mains.map((m) => !!m.disabled)).toEqual([false, true, false, false]);
    expect(mains[0].attrs.title).toBe("w1, running, last seen 1m 30s ago. Click to message it.");
    expect(mains[1].attrs.title).toBe("w2, exited. pane gone");
    expect(mains.map((m) => m.attrs.type)).toEqual(["button", "button", "button", "button"]);
    const noReason = await mount({ channels: [ch("c@d", { members: [{ name: "x", deliver: { ok: false } }] })], current: "c@d" });
    expect(one(noReason.host, "chan-chip-main").attrs.title).toBe("x, no pane. Cannot receive messages.");
  });

  test("clicking a chip retargets the composer and highlights the chip; clicking again returns to everyone", async () => {
    const { host } = await mount({ channels: [CHAN], current: "a@b" });
    const to = () => one(host, "chan-to");
    const ta = () => byTag(host, "textarea")[0];
    expect(to().value).toBe("all");
    expect(ta().placeholder).toBe("Message everyone in a@b");
    byClass(host, "chan-chip-main")[0].click();
    expect(to().value).toBe("w1");
    expect(ta().placeholder).toBe("Message w1: it reads this on its next tool call");
    let chip = byClass(host, "chan-chip")[0];
    expect(chip.attrs["data-on"]).toBe("true");
    expect(one(chip, "chan-chip-main").attrs["aria-pressed"]).toBe("true");
    expect(one(chip, "chan-chip-main").attrs.title).toContain("Click to message everyone instead.");
    expect(byClass(host, "chan-chip")[1].attrs["data-on"]).toBeUndefined();
    expect(one(byClass(host, "chan-chip")[1], "chan-chip-main").attrs["aria-pressed"]).toBe("false");
    byClass(host, "chan-chip-main")[0].click();
    expect(to().value).toBe("all");
    expect(ta().placeholder).toBe("Message everyone in a@b");
    expect(byClass(host, "chan-chip")[0].attrs["data-on"]).toBeUndefined();
  });

  test("a chip with a live agent record gets an Open button for that agent", async () => {
    const rec = { name: "w1", key: "k", state: "working" };
    agentsStore.getState().agents = [rec];
    const { host, spies } = await mount({ channels: [CHAN], current: "a@b" });
    const opens = byClass(host, "chan-chip-open");
    expect(opens.length).toBe(1);
    expect(opens[0].attrs["aria-label"]).toBe("Open w1");
    expect(opens[0].attrs.title).toBe("Open w1");
    opens[0].click();
    expect(spies.openAgent).toEqual([[rec]]);
    expect(byClass(byClass(host, "chan-chip")[1], "chan-chip-open").length).toBe(0);
  });

  test("a live agent record overrides the member's reported state; live_state members keep the server's", async () => {
    agentsStore.getState().agents = [{ name: "w1", key: "k", state: "input" }];
    const { host } = await mount({ channels: [ch("a@b", { members: [{ name: "w1", state: "working" }, { name: "w5", state: "idle", live_state: "x" }, { name: "w6", state: "blocked" }] })], current: "a@b" });
    expect(byClass(host, "chan-chip").map((c) => c.attrs["data-state"])).toEqual(["input", "idle", "input"]);
  });

  test("a channel with no members says so", async () => {
    const { host } = await mount({ channels: [ch("a@b")], current: "a@b" });
    const hint = byClass(host, "chan-empty").find((n) => n.tag === "p");
    expect(txt(hint)).toBe("No members yet. Subagents join when a lead dispatches them.");
    expect(byClass(host, "chan-chips").length).toBe(0);
  });
});

// =================================================================== composer
describe("mountChannelLens composer", () => {
  const MEMBERS = [{ name: "w1" }, { name: "w2", deliver: { ok: false, reason: "r" }, live_state: "dead" }, { name: "w3", deliver: { ok: false } }];
  const CHAN = ch("a@b", { members: MEMBERS });

  test("To lists everyone plus each member, disabling those that cannot receive", async () => {
    const { host } = await mount({ channels: [CHAN], current: "a@b" });
    const sel = one(host, "chan-to");
    expect(sel.attrs["aria-label"]).toBe("To");
    const opts = byTag(sel, "option");
    expect(opts.map(txt)).toEqual(["Everyone in channel", "w1", "w2 (dead, cannot receive)", "w3 (unreachable, cannot receive)"]);
    expect(opts.map((o) => !!o.disabled)).toEqual([false, false, true, true]);
    expect(opts.map((o) => o.value)).toEqual(["all", "w1", "w2", "w3"]);
    expect(opts[2].attrs.title).toBe("r");
    expect(sel.value).toBe("all");
  });

  test("when nobody can receive the composer is disabled with an explanation", async () => {
    const dead = ch("a@b", { members: [{ name: "w2", deliver: { ok: false } }] });
    const { host } = await mount({ channels: [dead], current: "a@b" });
    const ta = byTag(host, "textarea")[0];
    expect(ta.disabled).toBe(true);
    expect(ta.placeholder).toBe("Nobody in this channel can receive a message (members finished, dead or none)");
    expect(byTag(one(host, "chan-composer"), "button").every((b) => b.disabled)).toBe(true);
    expect(txt(byTag(one(host, "chan-to"), "option")[0])).toBe("Everyone (nobody can receive)");
    expect(byTag(one(host, "chan-to"), "option")[0].disabled).toBe(true);
    const none = await mount({ channels: [ch("c@d")], current: "c@d" });
    expect(byTag(none.host, "textarea")[0].disabled).toBe(true);
  });

  test("the composer is the plain one-box form: no Send-as mode switch", async () => {
    const { host } = await mount({ channels: [CHAN], current: "a@b" });
    const comp = one(host, "chan-composer");
    expect(byClass(comp, "seg").length).toBe(0);
    expect(byTag(comp, "button").map(txt)).toEqual(["Send"]);
    expect(txt(comp)).not.toContain("Prompt agent");
  });

  test("a reachable channel enables the textarea and buttons", async () => {
    const { host } = await mount({ channels: [CHAN], current: "a@b" });
    const ta = byTag(host, "textarea")[0];
    expect(!!ta.disabled).toBe(false);
    expect(byTag(one(host, "chan-composer"), "button").every((b) => !b.disabled)).toBe(true);
  });

  test("the To select retargets the composer without rebuilding it (a typed draft survives)", async () => {
    const { host } = await mount({ channels: [CHAN], current: "a@b" });
    const ta = byTag(host, "textarea")[0];
    ta.value = "draft";
    const sel = one(host, "chan-to");
    sel.value = "w1";
    fire(sel, "change", { target: sel });
    expect(byTag(host, "textarea")[0]).toBe(ta);
    expect(ta.value).toBe("draft");
    expect(ta.placeholder).toBe("Message w1: it reads this on its next tool call");
    expect(byClass(host, "chan-chip")[0].attrs["data-on"]).toBe("true");
  });

  test("a recipient that stops being reachable falls back to everyone on the next refresh", async () => {
    let reachableNow = true;
    const make = () => ({ current: "a@b", channels: [ch("a@b", { members: [{ name: "w1", deliver: reachableNow ? undefined : { ok: false } }, { name: "w9" }] })] });
    const { host, lens } = await mount({ channels: [CHAN], current: "a@b", channelsResult: make });
    byClass(host, "chan-chip-main")[0].click();
    expect(one(host, "chan-to").value).toBe("w1");
    reachableNow = false;
    await lens.refresh();
    expect(one(host, "chan-to").value).toBe("all");
    expect(byTag(host, "textarea")[0].placeholder).toBe("Message everyone in a@b");
  });

  test("sending to everyone posts to each reachable member and reports the delivery", async () => {
    const posts = [];
    api.post = async (path, b) => { posts.push([path, b]); return { ok: true, message: { delivery_text: "delivered to " + path.split("/")[1] } }; };
    const { host, calls } = await mount({ channels: [CHAN], current: "a@b", detail: { "a@b": { channel: { name: "a@b" }, messages: MSGS } } });
    const ta = byTag(host, "textarea")[0];
    ta.value = "ship it";
    byTag(one(host, "chan-composer"), "button").find((b) => txt(b) === "Send").click();
    await flush();
    expect(posts).toEqual([["colony/w1/send", { text: "ship it", project: "proj" }]]);
    expect(txt(one(docBody, "toast"))).toContain("delivered to w1");
    expect(ta.value).toBe("");
    expect(calls.filter((c) => c[0].startsWith("channels/")).length).toBe(2);
  });

  test("sending to a named member posts to that seat, the toast falls back to 'Posted to <name>'", async () => {
    const posts = [];
    api.post = async (path, b) => { posts.push([path, b]); return { ok: true }; };
    const { host } = await mount({ channels: [CHAN], current: "a@b", params: { project: "rp" } });
    byClass(host, "chan-chip-main")[0].click();
    byTag(host, "textarea")[0].value = "hi";
    byTag(one(host, "chan-composer"), "button").find((b) => txt(b) === "Send").click();
    await flush();
    expect(posts).toEqual([["colony/w1/send", { text: "hi", project: "rp" }]]);
    expect(txt(one(docBody, "toast"))).toContain("Posted to w1");
  });

  test("sending to everyone with no delivery text says 'Posted to <channel>'", async () => {
    api.post = async () => ({ ok: true });
    const { host } = await mount({ channels: [CHAN], current: "a@b" });
    byTag(host, "textarea")[0].value = "yo";
    byTag(one(host, "chan-composer"), "button").find((b) => txt(b) === "Send").click();
    await flush();
    expect(txt(one(docBody, "toast"))).toContain("Posted to a@b");
  });

  test("a refused send shows the API error in the composer and leaves the draft", async () => {
    api.post = async () => { throw Object.assign(new Error("x"), { error: "member_dead", why: "it exited" }); };
    const { host } = await mount({ channels: [CHAN], current: "a@b" });
    const ta = byTag(host, "textarea")[0];
    ta.value = "keep me";
    byTag(one(host, "chan-composer"), "button").find((b) => txt(b) === "Send").click();
    await flush();
    expect(ta.value).toBe("keep me");
    expect(txt(one(host, "field-msg"))).toContain("member_dead");
  });
});

// =================================================================== tabs and log
describe("mountChannelLens tabs and log", () => {
  const CHAN = ch("a@b", { members: [{ name: "w1" }, { name: "w2" }] });
  const BOARD = { owners: [{ owner: "w1", role: "subagent", items: [{ content: "do x", status: "in_progress" }], counts: {} }] };

  test("Messages is the default tab and lists the channel's messages", async () => {
    const { host } = await mount({ channels: [CHAN], current: "a@b", detail: { "a@b": { channel: { name: "a@b" }, messages: MSGS } } });
    const tabs = byTag(one(host, "chan-tabs"), "button");
    expect(tabs.map(txt)).toEqual(["Messages", "Board"]);
    expect(tabs.map((t) => t.attrs["aria-checked"])).toEqual(["true", "false"]);
    expect(tabs.map((t) => t.attrs.role)).toEqual(["radio", "radio"]);
    expect(one(host, "chan-tabs").attrs.role).toBe("radiogroup");
    expect(one(host, "chan-tabs").attrs["aria-label"]).toBe("Channel view");
    const log = txt(one(host, "chan-log"));
    expect(log).toContain("hello team");
    expect(log).toContain("ack");
  });

  test("an empty channel says there are no messages", async () => {
    const { host } = await mount({ channels: [CHAN], current: "a@b" });
    expect(txt(one(host, "chan-log"))).toContain("No messages in this channel yet.");
  });

  test("the log keeps the last 100 messages", async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ ts: 1_700_000_000_000 + i, from: "w1", to: "all", body: "m" + i }));
    const { host } = await mount({ channels: [CHAN], current: "a@b", detail: { "a@b": { channel: { name: "a@b" }, messages: many } } });
    const log = txt(one(host, "chan-log"));
    expect(log).toContain("m129");
    expect(log).toContain("m30");
    expect(log).not.toContain("m29" + "|");
    expect(log).not.toMatch(/m29(?!\d)/);
  });

  test("the Board tab shows one row per member joined with the board, the Messages tab returns to the log", async () => {
    const { host } = await mount({ channels: [CHAN], current: "a@b", detail: { "a@b": { channel: { name: "a@b" }, messages: MSGS, board: BOARD } } });
    byTag(one(host, "chan-tabs"), "button")[1].click();
    expect(byTag(one(host, "chan-tabs"), "button").map((t) => t.attrs["aria-checked"])).toEqual(["false", "true"]);
    const rows = byClass(one(host, "chan-log"), "mb-row");
    expect(rows.map((r) => txt(one(r, "mb-name")))).toEqual(["w1", "w2"]);
    expect(txt(one(rows[0], "mb-now").children[1])).toBe("do x");
    expect(byClass(host, "chan-board").length).toBe(1);
    byTag(one(host, "chan-tabs"), "button")[0].click();
    expect(txt(one(host, "chan-log"))).toContain("hello team");
    expect(byClass(host, "chan-board").length).toBe(0);
  });

  test("route param tab=board opens on the Board; any other value opens Messages", async () => {
    const board = await mount({ channels: [CHAN], current: "a@b", params: { tab: "board" }, detail: { "a@b": { channel: { name: "a@b" }, messages: [], board: BOARD } } });
    expect(byTag(one(board.host, "chan-tabs"), "button").map((t) => t.attrs["aria-checked"])).toEqual(["false", "true"]);
    const other = await mount({ channels: [CHAN], current: "a@b", params: { tab: "weird" } });
    expect(byTag(one(other.host, "chan-tabs"), "button").map((t) => t.attrs["aria-checked"])).toEqual(["true", "false"]);
  });

  test("a board with members but no todos explains how items appear; member rows still render", async () => {
    const { host } = await mount({ channels: [CHAN], current: "a@b", params: { tab: "board" } });
    expect(txt(one(host, "chan-board"))).toContain("No todos on this channel's board yet. Members claim items with atlas_todo.py claim.");
    expect(byClass(host, "mb-row").length).toBe(2);
  });

  test("a board with todos shows no empty hint", async () => {
    const { host } = await mount({ channels: [CHAN], current: "a@b", params: { tab: "board" }, detail: { "a@b": { channel: { name: "a@b" }, messages: [], board: BOARD } } });
    expect(txt(one(host, "chan-board"))).not.toContain("No todos on this channel's board yet");
  });

  test("a channel with no members shows the member-board hint on the Board tab and no 'no todos' text", async () => {
    const { host } = await mount({ channels: [ch("e@f")], current: "e@f", params: { tab: "board" } });
    expect(txt(one(host, "chan-board"))).toContain("No members yet.");
    expect(txt(one(host, "chan-board"))).not.toContain("No todos");
  });

  test("the Board's Message button targets that member and Open opens its agent", async () => {
    const rec = { name: "w1", key: "k", state: "idle" };
    agentsStore.getState().agents = [rec];
    const { host, spies } = await mount({ channels: [CHAN], current: "a@b", params: { tab: "board" } });
    const row1 = byClass(host, "mb-row")[0];
    const msgBtn = byTag(row1, "button").find((b) => txt(b) === "Message");
    msgBtn.click();
    expect(one(host, "chan-to").value).toBe("w1");
    expect(byTag(host, "button").filter((b) => txt(b) === "Clear").length).toBeGreaterThan(0);
    byTag(row1, "button").find((b) => txt(b) === "Open").click();
    expect(spies.openAgent).toEqual([[rec]]);
  });

  test("after switching channel the Board tab shows a loading state until that channel's detail arrives", async () => {
    const waiting = [];
    const { host } = await mount({ channels: [CHAN, ch("c@d")], current: "a@b", params: { tab: "board" }, detailFn: (name) => (waiting.length === 0 && name === "a@b" ? { channel: { name }, messages: [] } : new Promise((res) => { waiting.push(res); })) });
    expect(byClass(host, "state-loading").length).toBe(0);
    fire(one(host, "chan-pick"), "change", { target: { value: "c@d" } });
    await settle();
    const st = one(one(host, "chan-log"), "state");
    expect(st.attrs.class).toBe("state state-loading");
    waiting[0]({ channel: { name: "c@d" }, messages: [], board: { owners: [] } });
    await flush();
    expect(byClass(host, "state-loading").length).toBe(0);
    expect(byClass(host, "chan-board").length).toBe(1);
  });

  test("a failing detail request shows the error in the log on both tabs, and Retry refreshes", async () => {
    let fail = true;
    const { host, calls } = await mount({ channels: [CHAN], current: "a@b", detailFn: (name) => { if (fail) throw new Error("detail down"); return { channel: { name }, messages: MSGS }; } });
    const st = one(one(host, "chan-log"), "state");
    expect(st.attrs.class).toContain("state-error");
    expect(st.attrs.class).toContain("is-inline");
    expect(txt(st)).toContain("detail down");
    byTag(one(host, "chan-tabs"), "button")[1].click();
    expect(txt(one(host, "chan-log"))).toContain("detail down");
    expect(byClass(host, "chan-board").length).toBe(0);
    fail = false;
    const before = calls.length;
    byTag(st, "button").find((b) => /retry/i.test(txt(b))).click();
    await flush();
    expect(calls.length).toBeGreaterThan(before);
    byTag(one(host, "chan-tabs"), "button")[0].click();
    expect(txt(one(host, "chan-log"))).toContain("hello team");
  });

  test("refresh keeps the same message list element and appends new messages", async () => {
    let msgs = MSGS;
    const { host, lens } = await mount({ channels: [CHAN], current: "a@b", detailFn: (name) => ({ channel: { name }, messages: msgs }) });
    const list = one(host, "channel-list");
    msgs = [...MSGS, { ts: 1_700_000_200_000, from: "w2", to: "all", body: "brand new" }];
    await lens.refresh();
    expect(one(host, "channel-list")).toBe(list);
    expect(txt(list)).toContain("brand new");
  });

  test("switching channel clears the old log before the new detail arrives", async () => {
    const waiters = {};
    const chans = [CHAN, ch("c@d", { members: [{ name: "z" }] })];
    const { host } = await mount({ channels: chans, current: "a@b", detailFn: (name) => (name === "a@b" ? { channel: { name }, messages: MSGS } : new Promise((r) => { waiters[name] = r; })) });
    expect(txt(one(host, "chan-log"))).toContain("hello team");
    fire(one(host, "chan-pick"), "change", { target: { value: "c@d" } });
    await settle();
    expect(txt(one(host, "chan-log"))).not.toContain("hello team");
    waiters["c@d"]({ channel: { name: "c@d" }, messages: [{ ts: 1_700_000_000_000, from: "z", to: "all", body: "other channel" }] });
    await flush();
    expect(txt(one(host, "chan-log"))).toContain("other channel");
    expect(one(host, "chan-to").value).toBe("all");
  });
});
