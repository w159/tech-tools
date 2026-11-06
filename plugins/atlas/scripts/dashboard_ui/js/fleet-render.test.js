import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { body, installDom, restoreDom } from "./operate-dom-stub.js";
import { api } from "./api.js";

installDom();
const { agentsStore } = await import("./agents-store.js");
const fleet = await import("./fleet.js");
const { warmHp } = await import("./integrations.js");
restoreDom();
const { FleetStrip, AgentRow, AgentCard, AgentTable, Inspector, nowLine, colonyHref, terminalHref, openAgentInspector, closeAgentInspector } = fleet;

const NOW = Date.now();
const rec = (key, over = {}) => ({ key, name: key, title: "Title " + key, kind: "claude", state: "working", workspace: "ws", workspace_id: "w", pane_id: "pane-" + key, cwd: "/proj/" + key, project: "/proj", task: "", lastMsg: "", children: [], messages: [], tasks: [], since: NOW - 120000, sinceApprox: false, parent: null, colony: false, deep_link: "", ...over });

let protoSaved;
let timers;
let patched;
let savedApi;
let postCalls;
let st;

const PROTO_KEYS = ["append", "hasAttribute", "parentNode", "querySelectorAll", "removeChild", "childNodes", "getBoundingClientRect", "nextElementSibling", "previousElementSibling", "closest", "contains", "setAttribute", "appendChild", "remove", "replaceWith"];
function patchDom() {
  const proto = Object.getPrototypeOf(document.createElement("div"));
  protoSaved = Object.fromEntries(PROTO_KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)]));
  const sibling = (n, d) => { const p = n.parent; if (!p) return null; return p.children[p.children.indexOf(n) + d] || null; };
  const mark = (n, on) => { n.isConnected = on; (n.children || []).forEach((c) => mark(c, on)); };
  const origQsa = protoSaved.querySelectorAll.value;
  const origAppend = protoSaved.appendChild.value;
  const origRemove = protoSaved.remove.value;
  const origReplaceWith = protoSaved.replaceWith.value;
  const origSetAttr = protoSaved.setAttribute.value;
  Object.defineProperties(proto, {
    append: { value(...c) { c.forEach((x) => this.appendChild(typeof x === "string" ? document.createTextNode(x) : x)); }, configurable: true, writable: true },
    hasAttribute: { value(k) { return k in this.attrs; }, configurable: true, writable: true },
    parentNode: { get() { return this.parent; }, configurable: true },
    // descendant selectors ("ul.kids li"): chain the stub's simple-selector matcher
    querySelectorAll: { value(sel) { const parts = String(sel).trim().split(/\s+/); let cur = [this]; for (const p of parts) { const next = []; for (const n of cur) for (const m of origQsa.call(n, p)) if (!next.includes(m)) next.push(m); cur = next; } return cur; }, configurable: true, writable: true },
    removeChild: { value(c) { this.children = this.children.filter((x) => x !== c); c.parent = null; mark(c, false); return c; }, configurable: true, writable: true },
    childNodes: { get() { return this.children; }, configurable: true },
    getBoundingClientRect: { value() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; }, configurable: true, writable: true },
    nextElementSibling: { get() { return sibling(this, 1); }, configurable: true },
    previousElementSibling: { get() { return sibling(this, -1); }, configurable: true },
    closest: { value(sel) { for (let n = this; n; n = n.parent) if (n.matches && n.matches(sel)) return n; return null; }, configurable: true, writable: true },
    contains: { value(o) { for (let n = o; n; n = n.parent) if (n === this) return true; return false; }, configurable: true, writable: true },
    setAttribute: { value(k, v) { origSetAttr.call(this, k, v); if (String(k).startsWith("data-")) { this.dataset = this.dataset || {}; this.dataset[String(k).slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v); } }, configurable: true, writable: true },
    appendChild: { value(c) { origAppend.call(this, c); if (this.isConnected) mark(c, true); return c; }, configurable: true, writable: true },
    remove: { value() { origRemove.call(this); mark(this, false); }, configurable: true, writable: true },
    replaceWith: { value(n) { const p = this.parent; origReplaceWith.call(this, n); mark(this, false); if (p && p.isConnected) mark(n, true); }, configurable: true, writable: true },
  });
}
function unpatchDom() {
  const proto = Object.getPrototypeOf(document.createElement("div"));
  for (const k of PROTO_KEYS) { if (protoSaved[k]) Object.defineProperty(proto, k, protoSaved[k]); else delete proto[k]; }
}

const TIMER_KEYS = ["setTimeout", "clearTimeout", "setInterval", "clearInterval"];
function patchTimers() {
  const saved = Object.fromEntries(TIMER_KEYS.map((k) => [k, globalThis[k]]));
  timers = { timeouts: [], cleared: [], intervals: [] };
  globalThis.setTimeout = (fn, ms) => { timers.timeouts.push({ fn, ms }); return timers.timeouts.length; };
  globalThis.clearTimeout = (id) => { timers.cleared.push(id); };
  globalThis.setInterval = (fn, ms) => { timers.intervals.push({ fn, ms }); return timers.intervals.length; };
  globalThis.clearInterval = () => {};
  return saved;
}
let savedTimers;

function stateOf(over = {}) {
  return { agents: [], byKey: new Map(), layers: { daemon: { state: "up" }, herdr: { state: "up" }, webui: { state: "up" } }, sources: { irc: { ok: true } }, counts: {}, ...over };
}

beforeEach(() => {
  installDom();
  patchDom();
  savedTimers = patchTimers();
  globalThis.innerHeight = 800;
  globalThis.innerWidth = 1440;
  globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.requestAnimationFrame = () => 0;
  savedApi = { get: api.get, post: api.post };
  postCalls = [];
  api.get = async () => { throw new Error("no hp"); };
  api.post = async (p, b) => { postCalls.push([p, b]); return {}; };
  st = stateOf();
  const calls = { refresh: [], recheck: 0, startHerdr: 0 };
  patched = { getState: agentsStore.getState, get: agentsStore.get, subscribe: agentsStore.subscribe, refresh: agentsStore.refresh, recheck: agentsStore.recheck, startHerdr: agentsStore.startHerdr, calls, subs: [] };
  agentsStore.getState = () => st;
  agentsStore.get = (k) => st.byKey.get(k) || null;
  agentsStore.subscribe = (fn) => { patched.subs.push(fn); return () => { patched.subs.splice(patched.subs.indexOf(fn), 1); }; };
  agentsStore.refresh = async (n) => { calls.refresh.push(n); };
  agentsStore.recheck = async () => { calls.recheck += 1; };
  agentsStore.startHerdr = async () => { calls.startHerdr += 1; };
});
afterEach(() => {
  closeAgentInspector();
  Object.assign(agentsStore, { getState: patched.getState, get: patched.get, subscribe: patched.subscribe, refresh: patched.refresh, recheck: patched.recheck, startHerdr: patched.startHerdr });
  api.get = savedApi.get;
  api.post = savedApi.post;
  unpatchDom();
  for (const [k, v] of Object.entries(savedTimers)) globalThis[k] = v;
  delete globalThis.innerHeight;
  delete globalThis.innerWidth;
  delete globalThis.CustomEvent;
  delete globalThis.getComputedStyle;
  delete globalThis.requestAnimationFrame;
  restoreDom();
});

const mount = (node) => { body.replaceChildren(); body.appendChild(node); return node; };
const all = (root, sel) => root.querySelectorAll(sel);
const evt = (over = {}) => ({ preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...over });
const fire = (node, type, e) => { const ev = evt(e); (node.listeners[type] || []).forEach((f) => f(ev)); return ev; };
const labelsOf = (root, sel) => all(root, sel).map((n) => n.textContent);

describe("deep links", () => {
  test("colony and terminal hrefs address the seat by name, else by key, URL-encoded", () => {
    expect(colonyHref({ name: "impl 1", key: "k" })).toBe("#/agents?lens=roster&seat=impl%201");
    expect(colonyHref({ key: "k/2" })).toBe("#/agents?lens=roster&seat=k%2F2");
    expect(terminalHref({ name: "a&b", key: "k" })).toBe("#/terminal?seat=a%26b");
    expect(terminalHref({ name: "", key: "k" })).toBe("#/terminal?seat=k");
  });
});

describe("nowLine", () => {
  test("task first, then the latest channel line, then an honest blank that names the state", () => {
    expect(nowLine({ task: "T", lastMsg: "M", state: "idle" })).toEqual({ label: "Task", text: "T" });
    expect(nowLine({ task: "", lastMsg: "M", state: "idle" })).toEqual({ label: "Latest", text: "M" });
    expect(nowLine({ state: "idle" })).toEqual({ label: "", text: "Not attached to an atlas task (idle)" });
    expect(nowLine({})).toEqual({ label: "", text: "Not attached to an atlas task" });
  });
});

describe("FleetStrip", () => {
  const cells = (strip) => all(strip, "button.fleet-cell");

  test("a toolbar with one labelled cell per agent, the first one tabbable", () => {
    const strip = mount(FleetStrip({ agents: [rec("a"), rec("b", { state: "input" })] }));
    expect(strip.getAttribute("role")).toBe("toolbar");
    expect(strip.getAttribute("aria-label")).toBe("Agents (one hexagon per agent; click to open)");
    expect(strip.getAttribute("title")).toBe("Agents: one hexagon per agent session, colored by state. Click one to open it.");
    const cs = cells(strip);
    expect(cs.map((c) => c.getAttribute("data-key"))).toEqual(["a", "b"]);
    expect(cs.map((c) => c.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    expect(cs.map((c) => c.getAttribute("title"))).toEqual(["Title a, Working", "Title b, Needs input"]);
    expect(cs.map((c) => c.getAttribute("data-state"))).toEqual(["working", "input"]);
    expect(cs[0].getAttribute("aria-label")).toBe("Title a in ws, working, 2m");
    expect(strip.querySelector("span.sr-only").textContent).toBe("1 working, 1 needs input");
  });

  test("the screen-reader summary counts states in a fixed order; an empty strip says so", () => {
    const strip = mount(FleetStrip({ agents: [rec("a", { state: "done" }), rec("b", { state: "input" }), rec("c", { state: "working" }), rec("d", { state: "working" }), rec("e", { state: "fail" }), rec("f", { state: "unknown" }), rec("g", { state: "idle" })] }));
    expect(strip.querySelector("span.sr-only").textContent).toBe("2 working, 1 needs input, 1 failed, 1 ready, 1 done, 1 not measured");
    const empty = mount(FleetStrip());
    expect(empty.querySelector("span.sr-only").textContent).toBe("No agents");
    expect(empty.querySelector("span.fleet-empty").textContent).toBe("No agents");
    expect(cells(empty).length).toBe(0);
  });

  test("clicking a cell opens that agent; with no handler nothing throws", () => {
    const opened = [];
    const a = rec("a");
    const strip = mount(FleetStrip({ agents: [a], onOpen: (r) => opened.push(r.key) }));
    fire(cells(strip)[0], "click");
    expect(opened).toEqual(["a"]);
    const bare = mount(FleetStrip({ agents: [a] }));
    expect(() => fire(cells(bare)[0], "click")).not.toThrow();
  });

  test("subagents follow their parent as small cells and open on click", () => {
    const opened = [];
    const kid = rec("k", { state: "idle", title: "Kid" });
    const strip = mount(FleetStrip({ agents: [rec("a", { children: [kid] })], onOpen: (r) => opened.push(r.key) }));
    const cs = cells(strip);
    expect(cs.map((c) => c.className)).toEqual(["fleet-cell", "fleet-cell fleet-sub"]);
    expect(cs[1].getAttribute("data-state")).toBe("idle");
    expect(cs[1].getAttribute("tabindex")).toBe("-1");
    expect(cs[1].getAttribute("aria-label")).toBe("Kid in ws, ready, 2m");
    fire(cs[1], "click");
    expect(opened).toEqual(["k"]);
  });

  test("beyond the limit the rest collapse into one +N cell coloured by the most common hidden state", () => {
    const opened = [];
    const agents = [rec("a"), rec("b"), rec("c", { state: "idle" }), rec("d", { state: "idle" }), rec("e", { state: "fail" })];
    const strip = mount(FleetStrip({ agents, max: 3, onOpen: (r) => opened.push(r.key) }));
    const cs = cells(strip);
    expect(cs.map((c) => c.className)).toEqual(["fleet-cell", "fleet-cell", "fleet-cell fleet-more"]);
    const more = cs[2];
    expect(more.getAttribute("aria-label")).toBe("3 more agents");
    expect(more.getAttribute("title")).toBe("3 more");
    expect(more.getAttribute("data-state")).toBe("idle");
    expect(more.querySelector("span.fleet-more-n").textContent).toBe("+3");
    expect(more.getAttribute("tabindex")).toBe("-1");
    fire(more, "click");
    expect(opened).toEqual(["c"]);
  });

  test("exactly at the limit nothing collapses; the default limit is 24", () => {
    const mk = (n) => Array.from({ length: n }, (_, i) => rec("k" + i));
    expect(cells(mount(FleetStrip({ agents: mk(3), max: 3 }))).length).toBe(3);
    expect(all(mount(FleetStrip({ agents: mk(24) })), "button.fleet-more").length).toBe(0);
    const over = mount(FleetStrip({ agents: mk(26) }));
    expect(cells(over).length).toBe(24);
    expect(over.querySelector("button.fleet-more").getAttribute("aria-label")).toBe("3 more agents");
  });

  test("update redraws in place from a new list", () => {
    const strip = mount(FleetStrip({ agents: [rec("a")] }));
    strip.update([rec("x"), rec("y")]);
    expect(cells(strip).map((c) => c.getAttribute("data-key"))).toEqual(["x", "y"]);
    expect(all(strip, "span.sr-only").length).toBe(1);
    strip.update(null);
    expect(cells(strip).length).toBe(0);
    expect(strip.querySelector("span.fleet-empty")).not.toBeNull();
  });

  test("arrow keys, Home, End and digits rove focus between cells; other keys and outside focus do nothing", () => {
    const strip = mount(FleetStrip({ agents: ["a", "b", "c", "d"].map((k) => rec(k)) }));
    const cs = cells(strip);
    const focused = [];
    cs.forEach((c, i) => { c.focus = () => focused.push(i); });
    const press = (key, from) => { document.activeElement = cs[from]; return fire(strip, "keydown", { key }); };
    const tabs = () => cs.map((c) => c.tabIndex);
    let ev = press("ArrowRight", 0);
    expect(ev.prevented).toBe(true);
    expect(tabs()).toEqual([-1, 0, -1, -1]);
    press("ArrowRight", 3);
    expect(tabs()).toEqual([-1, -1, -1, 0]);
    press("ArrowLeft", 2);
    expect(tabs()).toEqual([-1, 0, -1, -1]);
    press("ArrowLeft", 0);
    expect(tabs()).toEqual([0, -1, -1, -1]);
    press("End", 0);
    expect(tabs()).toEqual([-1, -1, -1, 0]);
    press("Home", 3);
    expect(tabs()).toEqual([0, -1, -1, -1]);
    press("3", 0);
    expect(tabs()).toEqual([-1, -1, 0, -1]);
    press("1", 2);
    expect(tabs()).toEqual([0, -1, -1, -1]);
    expect(focused).toEqual([1, 3, 1, 0, 3, 0, 2, 0]);
    ev = press("9", 0);
    expect(ev.prevented).toBeUndefined();
    ev = press("0", 0);
    expect(ev.prevented).toBeUndefined();
    ev = press("x", 0);
    expect(ev.prevented).toBeUndefined();
    document.activeElement = null;
    ev = fire(strip, "keydown", { key: "ArrowRight" });
    expect(ev.prevented).toBeUndefined();
    expect(focused.length).toBe(8);
  });

  test("hovering or focusing a cell opens a tooltip after a short delay; leaving or blurring cancels it", () => {
    const strip = mount(FleetStrip({ agents: [rec("a", { task: "Doing X" })] }));
    const cell = cells(strip)[0];
    fire(cell, "mouseenter");
    expect(timers.timeouts.map((t) => t.ms)).toEqual([120]);
    expect(body.querySelector("div.agent-pop")).toBeNull();
    timers.timeouts[0].fn();
    const pop = body.querySelector("div.agent-pop");
    expect(pop.querySelector("strong").textContent).toBe("Title a");
    expect(labelsOf(pop, "div.dim")).toEqual(["Claude Code, ws", "Working, 2m"]);
    expect(pop.textContent).toContain("Doing X");
    expect(body.querySelector("div.popover").getAttribute("role")).toBe("tooltip");
    expect(body.querySelector("div.popover").getAttribute("aria-label")).toBe("Title a");
    fire(cell, "mouseleave");
    expect(body.querySelector("div.agent-pop")).toBeNull();
    expect(timers.cleared.length).toBeGreaterThan(0);
    const before = timers.cleared.length;
    fire(cell, "focus");
    fire(cell, "blur");
    expect(timers.cleared.length).toBeGreaterThan(before + 1);
    expect(body.querySelector("div.agent-pop")).toBeNull();
  });

  test("the tooltip omits a missing task and workspace", () => {
    const strip = mount(FleetStrip({ agents: [rec("a", { workspace: "", task: "", kind: "weird", since: null })] }));
    fire(cells(strip)[0], "focus");
    timers.timeouts[0].fn();
    const pop = body.querySelector("div.agent-pop");
    expect(labelsOf(pop, "div.dim")).toEqual(["Agent, ", "Working"]);
    expect(pop.children.length).toBe(3);
  });
});

describe("AgentRow", () => {
  const mk = (a, o = {}) => mount(AgentRow({ agent: a, ...o }));

  test("a labelled row with glyph, kind, title, workspace, state badge, task and age", () => {
    const a = rec("a", { task: "Fix it", workspace: "alpha", kind: "codex" });
    const row = mk(a, { selected: true });
    expect(row.getAttribute("role")).toBe("row");
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("data-state")).toBe("working");
    expect(row.getAttribute("data-key")).toBe("a");
    expect(row.getAttribute("data-selected")).toBe("true");
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(row.getAttribute("aria-label")).toBe("Title a in alpha, working, 2m");
    expect(row.querySelector("span.agent-title").textContent).toBe("Title a");
    expect(row.querySelector("span.agent-ws").textContent).toBe("alpha");
    expect(row.querySelector("span.agent-task").textContent).toBe("Fix it");
    expect(row.querySelector("span.agent-age").textContent).toBe("2m");
    expect(row.textContent).toContain("Working");
    expect(row.querySelector("button.row-menu").getAttribute("aria-label")).toBe("Actions for Title a");
  });

  test("unselected rows carry no selection attributes; a missing workspace and task are blank", () => {
    const row = mk(rec("a", { workspace: "", task: "" }));
    expect(row.getAttribute("data-selected")).toBe(null);
    expect(row.getAttribute("aria-selected")).toBe(null);
    expect(row.querySelector("span.agent-ws").textContent).toBe("");
    expect(row.querySelector("span.agent-task").textContent).toBe("");
    expect(row.getAttribute("aria-label")).toBe("Title a in workspace, working, 2m");
  });

  test("the project column appears only on request and shows the folder name", () => {
    expect(mk(rec("a")).querySelector("span.agent-project")).toBeNull();
    expect(mk(rec("a"), { showProject: true }).querySelector("span.agent-project").textContent).toBe("proj");
    expect(mk(rec("a", { project: "/x/y/deep" }), { showProject: true }).querySelector("span.agent-project").textContent).toBe("deep");
    expect(mk(rec("a", { project: null }), { showProject: true }).querySelector("span.agent-project").textContent).toBe("");
  });

  test("click opens; Enter opens, Shift+Enter opens the terminal; events from children are ignored", () => {
    const calls = [];
    const a = rec("a");
    const row = mk(a, { onOpen: (r, o) => calls.push([r.key, o]) });
    fire(row, "click");
    fire(row, "keydown", { target: row, key: "Enter", shiftKey: false });
    fire(row, "keydown", { target: row, key: "Enter", shiftKey: true });
    fire(row, "keydown", { target: {}, key: "Enter" });
    expect(calls).toEqual([["a", {}], ["a", { terminal: false }], ["a", { terminal: true }]]);
    const bare = mk(a);
    expect(() => { fire(bare, "click"); fire(bare, "keydown", { target: bare, key: "Enter" }); }).not.toThrow();
  });

  test("arrow keys and j/k move focus to the neighbouring row; the dot opens the row menu", () => {
    const list = mount(h2());
    const r1 = AgentRow({ agent: rec("a") });
    const r2 = AgentRow({ agent: rec("b") });
    const r3 = AgentRow({ agent: rec("c") });
    list.append(r1, r2, r3);
    const focused = [];
    [r1, r2, r3].forEach((r, i) => { r.focus = () => focused.push(i); });
    let ev = fire(r2, "keydown", { target: r2, key: "ArrowDown" });
    expect(ev.prevented).toBe(true);
    fire(r2, "keydown", { target: r2, key: "j" });
    fire(r2, "keydown", { target: r2, key: "ArrowUp" });
    fire(r2, "keydown", { target: r2, key: "k" });
    expect(focused).toEqual([2, 2, 0, 0]);
    fire(r3, "keydown", { target: r3, key: "ArrowDown" }); // last row: nothing below
    fire(r1, "keydown", { target: r1, key: "k" }); // first row: nothing above
    expect(focused.length).toBe(4);
    let menuClicks = 0;
    r2.querySelector("button.row-menu").click = () => { menuClicks += 1; };
    ev = fire(r2, "keydown", { target: r2, key: "." });
    expect(menuClicks).toBe(1);
    expect(ev.prevented).toBe(true);
    ev = fire(r2, "keydown", { target: r2, key: "x" });
    expect(ev.prevented).toBeUndefined();
  });
});
function h2() { return document.createElement("div"); }

describe("AgentCard", () => {
  const mk = (a, o = {}) => mount(AgentCard({ agent: a, ...o }));

  test("title, state, now line and footer facts", () => {
    const a = rec("a", { task: "Ship it", pane_id: "pane-9", tasks: [{}, {}] });
    const card = mk(a, { selected: true });
    expect(card.className).toBe("agent-card");
    expect(card.getAttribute("data-state")).toBe("working");
    expect(card.getAttribute("data-key")).toBe("a");
    expect(card.getAttribute("data-selected")).toBe("true");
    expect(card.getAttribute("aria-label")).toBe("Title a in ws, working, 2m");
    const h3 = card.querySelector("h3");
    expect([h3.textContent, h3.getAttribute("title")]).toEqual(["Title a", "Title a"]);
    expect(card.querySelector("div.agent-now").getAttribute("title")).toBe("Ship it");
    expect(card.querySelector("span.agent-now-label").textContent).toBe("Task");
    expect(card.querySelector("div.agent-now").textContent).toBe("TaskShip it");
    const foot = card.querySelector("footer");
    expect(foot.textContent).toContain("Working");
    expect(foot.querySelector("span.num.dim").textContent).toBe("for 2m");
    expect(foot.querySelector("span.num.dim").getAttribute("title")).toBe("Since the last state change");
    expect(foot.textContent).toContain("2 tasks");
    expect(foot.querySelector("span.agent-pane").textContent).toBe("pane-9");
  });

  test("singular wording for one task and one subagent; an approximate age says so", () => {
    const card = mk(rec("a", { tasks: [{}], sinceApprox: true, children: [rec("k", { title: "Kid", state: "idle" })] }));
    const foot = card.querySelector("footer").textContent;
    expect(foot).toContain("1 task");
    expect(foot).not.toContain("1 tasks");
    expect(foot).toContain("1 subagent");
    expect(foot).not.toContain("1 subagents");
    expect(card.querySelector("footer span.num.dim").getAttribute("title")).toBe("Since Atlas first saw this state");
    const none = mk(rec("a"));
    expect(none.querySelector("footer").textContent).not.toContain("task");
    expect(none.querySelector("footer").textContent).not.toContain("subagent");
  });

  test("without an age the footer age is blank; without a task the now line is dim", () => {
    const card = mk(rec("a", { since: null, lastMsg: "last words" }));
    expect(card.querySelector("footer span.num.dim").textContent).toBe("");
    expect(card.querySelector("span.agent-now-label").textContent).toBe("Latest");
    const blank = mk(rec("a"));
    expect(blank.querySelector("div.agent-now").getAttribute("title")).toBe("Not attached to an atlas task (working)");
    expect(blank.querySelector("span.agent-now-label")).toBeNull();
    expect(blank.querySelector("div.agent-now span.dim")).not.toBeNull();
  });

  test("chips: kind, channel alias with full name, colony, parent link", () => {
    const parent = rec("p", { title: "Boss" });
    const calls = [];
    const card = mk(rec("a", { kind: "omp", colony: true }), { channel: { full: "proj@main/lead", alias: "lead" }, parent, onParent: (p) => calls.push(p.key) });
    const chips = card.querySelector("div.agent-chips");
    expect(labelsOf(chips, "span.chip-lite")).toEqual(["omp", "lead", "colony"]);
    expect(all(chips, "span.chip-lite")[1].getAttribute("title")).toBe("Channel proj@main/lead");
    const link = chips.querySelector("button.chip-link");
    expect(link.textContent).toBe("under Boss");
    expect(link.getAttribute("title")).toBe("Parent Boss");
    const ev = fire(link, "click");
    expect(calls).toEqual(["p"]);
    expect(ev.stopped).toBe(true);
    const bare = mk(rec("a"), { parent });
    expect(() => fire(bare.querySelector("button.chip-link"), "click")).not.toThrow();
    expect(labelsOf(mk(rec("a", { kind: "wat" })), "span.chip-lite")).toEqual(["Agent"]);
    expect(labelsOf(mk(rec("a", { kind: "shell" })), "span.chip-lite")).toEqual(["Shell"]);
    expect(labelsOf(mk(rec("a", { kind: "codex" })), "span.chip-lite")).toEqual(["Codex"]);
  });

  test("Supervise appears for an agent with subagents or for a lead with a subchannel, and passes the channel on", () => {
    const calls = [];
    const onSupervise = (r, ch) => calls.push([r.key, ch]);
    const lead = mk(rec("lead", { name: "lead" }), { channel: { sub: true, lead: "lead", full: "x/lead", alias: "lead" }, onSupervise });
    const chip = all(lead, "button.chip-link").find((b) => b.textContent === "Supervise");
    expect(chip.getAttribute("title")).toBe("Watch Title lead's subagents and their todo boards");
    const ev = fire(chip, "click");
    expect(ev.stopped).toBe(true);
    expect(calls).toEqual([["lead", { sub: true, lead: "lead", full: "x/lead", alias: "lead" }]]);
    const other = mk(rec("w", { name: "w" }), { channel: { sub: true, lead: "lead", full: "x/lead", alias: "lead" }, onSupervise });
    expect(all(other, "button.chip-link").length).toBe(0);
    const kids = mk(rec("p", { children: [rec("k")] }), { onSupervise });
    expect(all(kids, "button.chip-link").length).toBe(1);
    const noHandler = mk(rec("p", { children: [rec("k")] }));
    expect(all(noHandler, "button.chip-link").length).toBe(0);
    const plain = mk(rec("p"), { onSupervise, channel: { sub: false, lead: "p" } });
    expect(all(plain, "button.chip-link").length).toBe(0);
  });

  test("up to four subagents are listed, the rest counted", () => {
    const kids = Array.from({ length: 6 }, (_, i) => rec("k" + i, { title: "Kid " + i, state: i === 0 ? "input" : "idle" }));
    const card = mk(rec("a", { children: kids }));
    const ul = card.querySelector("ul.agent-kids");
    expect(ul.getAttribute("aria-label")).toBe("6 subagents");
    const lis = all(ul, "li");
    expect(lis.length).toBe(5);
    expect(lis[0].getAttribute("title")).toBe("Kid 0, Needs input");
    expect(lis.slice(0, 4).map((l) => l.textContent)).toEqual(["Kid 0", "Kid 1", "Kid 2", "Kid 3"]);
    expect(lis[4].textContent).toBe("+2 more");
    const four = mk(rec("a", { children: kids.slice(0, 4) }));
    expect(all(four, "ul.agent-kids li").length).toBe(4);
    expect(mk(rec("a")).querySelector("ul.agent-kids")).toBeNull();
  });

  test("clicking the card opens it; Enter on the card opens it (Shift for the terminal); the Open button focuses the terminal without bubbling", () => {
    const calls = [];
    const termCalls = [];
    const a = rec("a");
    const card = mk(a, { onOpen: (r, o) => calls.push([r.key, o]), onTerminal: (r) => termCalls.push(r.key) });
    fire(card, "click");
    fire(card, "keydown", { target: card, key: "Enter", shiftKey: true });
    fire(card, "keydown", { target: card, key: "Enter", shiftKey: false });
    fire(card, "keydown", { target: {}, key: "Enter" });
    fire(card, "keydown", { target: card, key: "x" });
    expect(calls).toEqual([["a", {}], ["a", { terminal: true }], ["a", { terminal: false }]]);
    const open = all(card, "footer button").find((b) => b.textContent === "Open");
    const ev = fire(open, "click");
    expect(termCalls).toEqual(["a"]);
    expect(ev.stopped).toBe(true);
    const bare = mk(a);
    expect(() => { fire(all(bare, "footer button")[0], "click"); fire(bare, "click"); }).not.toThrow();
  });

  test("a herdr-projects thread on the agent's directory adds a chip naming project, thread and branch", async () => {
    api.get = async () => ({ projects: [{ slug: "proj", threads: [{ id: 7, cwd: "/work/a/", status: "open", branch: "feat", channel: "c1" }, { id: 8, cwd: "/work/b", status: "open" }] }] });
    expect(await warmHp()).toBe(true);
    const card = mk(rec("a", { cwd: "/work/a" }));
    const chip = card.querySelector("span.hp-chip");
    expect(chip.getAttribute("title")).toBe("herdr-projects proj thread 7 on feat, channel c1");
    expect(chip.querySelector("span.hp-chip-text").textContent).toBe("proj #7 feat");
    const plain = mk(rec("b", { cwd: "/work/b" }));
    expect(plain.querySelector("span.hp-chip").getAttribute("title")).toBe("herdr-projects proj thread 8");
    expect(plain.querySelector("span.hp-chip-text").textContent).toBe("proj #8");
    expect(mk(rec("c", { cwd: "/elsewhere" })).querySelector("span.hp-chip")).toBeNull();
    expect(mk(rec("c", { cwd: "" })).querySelector("span.hp-chip")).toBeNull();
    api.get = async () => ({ projects: [] });
    await warmHp();
  });
});

describe("AgentTable", () => {
  const sort = { key: "state", dir: 1 };
  const mk = (o = {}) => mount(AgentTable({ agents: [rec("a", { task: "T", children: [rec("k")] }), rec("b")], sort, onSort() {}, ...o }));

  test("sortable column headers state their direction; the active one shows an arrow", () => {
    const t = mk({ sort: { key: "title", dir: -1 } });
    const ths = all(t, "thead th");
    expect(ths.length).toBe(8);
    expect(ths.slice(0, 7).map((x) => x.getAttribute("aria-sort"))).toEqual(["none", "descending", "none", "none", "none", "none", "none"]);
    expect(all(t, "button.th-btn").map((b) => b.textContent)).toEqual(["State", "Agent↓", "Project", "Now", "In state", "Subagents", "Channel"]);
    const asc = mk({ sort: { key: "state", dir: 1 } });
    expect(all(asc, "button.th-btn")[0].textContent).toBe("State↑");
    expect(all(asc, "thead th")[0].getAttribute("aria-sort")).toBe("ascending");
    expect(ths[7].textContent).toBe("Actions");
  });

  test("a header button reports its column key", () => {
    const keys = [];
    const t = mk({ onSort: (k) => keys.push(k) });
    all(t, "button.th-btn").forEach((b) => b.click());
    expect(keys).toEqual(["state", "title", "project", "now", "age", "subs", "channel"]);
  });

  test("rows show state word, title, project, now text, age, subagent count and channel", () => {
    const t = mk({ projectOf: (r) => "P-" + r.key, channelOf: (r) => (r.key === "a" ? { alias: "lead", full: "x/lead" } : null), selectedKey: "b" });
    const trs = all(t, "tr.agent-tr");
    expect(trs.map((r) => r.getAttribute("data-key"))).toEqual(["a", "b"]);
    expect(trs.map((r) => r.getAttribute("data-selected"))).toEqual([null, "true"]);
    expect(trs[0].getAttribute("aria-label")).toBe("Title a in ws, working, 2m");
    expect(trs[0].querySelector("td.td-state").textContent).toBe("Working");
    expect(trs[0].querySelector("td.td-title span.truncate").getAttribute("title")).toBe("Title a");
    expect(trs[0].querySelector("td.td-project").textContent).toBe("P-a");
    expect(trs[0].querySelector("td.td-project span").getAttribute("title")).toBe("/proj/a");
    expect(trs[0].querySelector("td.td-now").textContent).toBe("TaskT");
    expect(trs[1].querySelector("td.td-now").textContent).toBe("Not attached to an atlas task (working)");
    expect(trs[0].querySelector("td.td-age").textContent).toBe("2m");
    expect(trs[0].querySelector("td.td-age").getAttribute("title")).toBe("Since the last state change");
    expect(trs[0].querySelector("td.td-subs").textContent).toBe("1");
    expect(trs[1].querySelector("td.td-subs").textContent).toBe("");
    expect(trs[0].querySelector("td.td-chan").textContent).toBe("lead");
    expect(trs[0].querySelector("td.td-chan span").getAttribute("title")).toBe("x/lead");
    expect(trs[1].querySelector("td.td-chan").textContent).toBe("");
    expect(trs[1].querySelector("td.td-chan span").getAttribute("title")).toBe("");
    expect(trs[1].querySelector("td.td-project").textContent).toBe("P-b");
    const bare = mk();
    expect(all(bare, "td.td-project").map((c) => c.textContent)).toEqual(["", ""]);
    expect(all(bare, "td.td-chan span").map((c) => c.getAttribute("title"))).toEqual(["", ""]);
  });

  test("click and Enter open rows; arrows, j/k and the dot navigate", () => {
    const calls = [];
    const t = mk({ onOpen: (r, o) => calls.push([r.key, o]) });
    const [r1, r2] = all(t, "tr.agent-tr");
    fire(r1, "click");
    fire(r1, "keydown", { target: r1, key: "Enter", shiftKey: true });
    fire(r1, "keydown", { target: {}, key: "Enter" });
    expect(calls).toEqual([["a", {}], ["a", { terminal: true }]]);
    const focused = [];
    r1.focus = () => focused.push("r1");
    r2.focus = () => focused.push("r2");
    fire(r1, "keydown", { target: r1, key: "ArrowDown" });
    fire(r1, "keydown", { target: r1, key: "j" });
    fire(r2, "keydown", { target: r2, key: "ArrowUp" });
    fire(r2, "keydown", { target: r2, key: "k" });
    expect(focused).toEqual(["r2", "r2", "r1", "r1"]);
    let n = 0;
    r1.querySelector("button.row-menu").click = () => { n += 1; };
    fire(r1, "keydown", { target: r1, key: "." });
    expect(n).toBe(1);
  });
});

describe("agent action menu", () => {
  const items = () => all(body, "div.popover button.menu-item");
  const actionsLog = () => {
    const log = [];
    const mkAction = (name) => (r) => log.push([name, r.key]);
    return { log, actions: { onTerminal: mkAction("terminal"), onMessage: mkAction("message"), onPrompt: mkAction("prompt"), onAssign: mkAction("assign"), onStop: mkAction("stop") } };
  };

  test("the row menu button lists the wired actions and each runs for its agent", () => {
    const { log, actions } = actionsLog();
    const row = mount(AgentRow({ agent: rec("a"), actions }));
    const ev = fire(row.querySelector("button.row-menu"), "click");
    expect(ev.stopped).toBe(true);
    expect(items().map((b) => b.textContent)).toEqual(["Open terminal", "Message", "Send prompt", "Assign task", "Stop"]);
    expect(body.querySelector("div.popover").getAttribute("aria-label")).toBe("Actions for Title a");
    items().forEach((b) => { fire(b, "click"); });
    expect(log).toEqual([["terminal", "a"], ["message", "a"], ["prompt", "a"], ["assign", "a"], ["stop", "a"]]);
  });

  test("only the actions the page wired up are offered, and Stop is marked dangerous", () => {
    const card = mount(AgentCard({ agent: rec("a"), actions: { onStop() {}, onTerminal() {} } }));
    fire(card.querySelector("button.row-menu"), "click");
    expect(items().map((b) => b.textContent)).toEqual(["Open terminal", "Stop"]);
    expect(items()[1].className).toContain("is-danger");
    expect(items()[0].className).not.toContain("is-danger");
  });

  test("a menu opened with no actions at all is empty rather than failing", () => {
    const t = mount(AgentTable({ agents: [rec("a")], sort: { key: "state", dir: 1 }, onSort() {} }));
    expect(() => fire(t.querySelector("button.row-menu"), "click")).not.toThrow();
    expect(items().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe("Inspector", () => {
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const panel = (n) => n.querySelector("div.insp-panel-host");
  const tabLabels = (n) => all(n, "button.tab").map((b) => b.textContent);
  const tabBtn = (n, label) => all(n, "button.tab").find((b) => b.textContent === label);
  const kv = (n) => Object.fromEntries(all(n, "dl.kv dt").map((dt, i) => [dt.textContent, all(n, "dl.kv dd")[i]]));
  const mkInsp = (a = rec("a"), o = {}) => mount(Inspector({ agent: a, ...o }));

  beforeEach(() => {
    st = stateOf({ layers: { daemon: { state: "up" }, herdr: { state: "up" }, webui: { state: "up" } } });
  });

  test("header names the agent with its state badge; the five tabs are offered with Now selected", () => {
    const n = mkInsp(rec("a", { title: "Fix parser", state: "input" }));
    expect(n.querySelector("div.insp-head h2").textContent).toBe("Fix parser");
    expect(n.querySelector("div.insp-head h2").getAttribute("title")).toBe("Fix parser");
    expect(n.querySelector("div.insp-head").textContent).toContain("Needs input");
    expect(tabLabels(n)).toEqual(["Now", "Channel", "Tasks", "Files", "Terminal"]);
    expect(all(n, "button.tab").map((b) => b.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false", "false"]);
    expect(n.getAttribute("aria-label")).toBe("Fix parser");
  });

  test("Now tab: state, age, kind, workspace, pane, directory, project and latest task", () => {
    const n = mkInsp(rec("a", { task: "Do X", workspace: "alpha", kind: "codex", cwd: "/w/dir", project: "/w/proj" }));
    const rows = kv(n);
    expect(Object.keys(rows)).toEqual(["State", "Age", "Kind", "Workspace", "Pane", "Directory", "Project", "Latest task"]);
    expect(rows.State.textContent).toBe("Working");
    expect(rows.Age.textContent).toBe("2m");
    expect(rows.Kind.textContent).toBe("Codex");
    expect(rows.Workspace.textContent).toBe("alpha");
    expect(rows.Pane.textContent).toBe("pane-a");
    expect(rows.Directory.querySelector("span.cwd").getAttribute("title")).toBe("/w/dir");
    expect(rows.Directory.textContent).toBe("/w/dir");
    expect(rows.Project.textContent).toBe("proj");
    expect(rows["Latest task"].textContent).toBe("Do X");
    const bare = mkInsp(rec("b", { since: null, sinceApprox: true, project: null, workspace: "" }));
    const r2 = kv(bare);
    expect(r2.Age.textContent).toBe("n/a (since this page opened)");
    expect(r2.Project.textContent).toBe("None matched");
    expect(r2.Workspace.textContent).toBe("");
    expect(r2["Latest task"].textContent).toBe("Not attached to an atlas task");
    const approx = mkInsp(rec("c", { sinceApprox: true }));
    expect(kv(approx).Age.textContent).toBe("2m (since this page opened)");
  });

  test("Now tab: the Open in Colony and Open terminal buttons set the hash", () => {
    const n = mkInsp(rec("a", { name: "impl 1" }));
    const find = (label) => all(panel(n), "button").find((b) => b.textContent === label);
    find("Open in Colony").click();
    expect(location.hash).toBe("#/agents?lens=roster&seat=impl%201");
    find("Open terminal").click();
    expect(location.hash).toBe("#/terminal?seat=impl%201");
  });

  test("Now tab: send-keys buttons are disabled with an explanation when not served through the host; none without a pane", () => {
    const n = mkInsp(rec("a"));
    const row = n.querySelector("div.insp-keys");
    expect(row.getAttribute("aria-label")).toBe("Send keys");
    const keys = all(row, "button");
    expect(keys.map((b) => b.textContent)).toEqual(["Enter", "Esc", "Tab", "Up", "Down"]);
    expect(keys.every((b) => b.disabled)).toBe(true);
    expect(keys[0].getAttribute("title")).toBe("Needs Atlas opened through the agent runtime host (/atlas/)");
    const none = mkInsp(rec("b", { pane_id: "" }));
    expect(none.querySelector("div.insp-keys")).toBeNull();
  });

  test("Now tab: recent activity shows the last five messages newest first, naming the recipient unless it is 'all'", () => {
    const msgs = Array.from({ length: 7 }, (_, i) => ({ ts: 1000 + i, from: "w" + i, to: i === 6 ? "all" : "lead", body: "msg " + i }));
    msgs.push({ ts: 5000, body: "from nobody", to: "" });
    const n = mkInsp(rec("a", { messages: msgs }));
    const titles = all(n, "span.feed-title").map((t) => t.textContent);
    expect(titles).toEqual(["system", "w6", "w5 to lead", "w4 to lead", "w3 to lead"]);
    expect(all(n, "span.feed-detail").map((t) => t.textContent).slice(0, 2)).toEqual(["from nobody", "msg 6"]);
    expect(n.textContent).not.toContain("No channel activity");
    const empty = mkInsp(rec("b"));
    expect(empty.textContent).toContain("No channel activity for this agent yet.");
  });

  test("Now tab: warns when the channel source is unavailable", () => {
    st = stateOf({ sources: { irc: { ok: false } } });
    expect(mkInsp(rec("a")).textContent).toContain("Channel source unavailable; counts may be incomplete.");
    st = stateOf({ sources: { irc: { ok: true } } });
    expect(mkInsp(rec("a")).textContent).not.toContain("Channel source unavailable");
    st = stateOf({ sources: {} });
    expect(mkInsp(rec("a")).textContent).not.toContain("Channel source unavailable");
  });

  test("an unknown starting tab falls back to Now; a known one opens straight away", () => {
    expect(all(mkInsp(rec("a"), { tab: "bogus" }), "button.tab").map((b) => b.getAttribute("aria-selected"))[0]).toBe("true");
    const n = mkInsp(rec("a"), { tab: "tasks" });
    expect(n.textContent).toContain("No tasks");
    expect(all(n, "button.tab").map((b) => b.getAttribute("aria-selected"))).toEqual(["false", "false", "true", "false", "false"]);
  });

  test("clicking a tab swaps the panel and reports the tab", () => {
    const seen = [];
    const n = mkInsp(rec("a", { messages: [{ ts: 1, from: "x", to: "a", body: "hello there" }] }), { onTab: (t) => seen.push(t) });
    tabBtn(n, "Channel").click();
    expect(seen).toEqual(["channel"]);
    expect(panel(n).querySelector("div.channel-list").textContent).toContain("hello there");
    expect(panel(n).querySelector("div.insp-panel").getAttribute("id")).toBe("panel-channel");
    expect(panel(n).querySelector("dl.kv")).toBeNull();
    tabBtn(n, "Now").click();
    expect(seen).toEqual(["channel", "now"]);
    expect(panel(n).querySelector("dl.kv")).not.toBeNull();
  });

  test("a click works without an onTab callback", () => {
    const n = mkInsp(rec("a"));
    expect(() => tabBtn(n, "Tasks").click()).not.toThrow();
  });

  test("Channel tab: empty message text names the agent", () => {
    const n = mkInsp(rec("a"), { tab: "channel" });
    expect(n.textContent).toContain("No messages to or from this agent.");
  });

  test("Tasks tab: each task with its phase or origin, and a click goes to the board", () => {
    const tasks = [{ content: "T1", phase: "Backlog", status: "open" }, { content: "T2", origin: "plan", status: "in_progress" }];
    const n = mkInsp(rec("a", { tasks }), { tab: "tasks" });
    const items = all(panel(n), "button.feed-item");
    expect(items.map((i) => i.querySelector("span.feed-title").textContent)).toEqual(["T1", "T2"]);
    expect(items.map((i) => i.querySelector("span.feed-detail").textContent)).toEqual(["Backlog", "plan"]);
    items[0].click();
    expect(location.hash).toBe("#/agents?lens=board");
    expect(n.textContent).not.toContain("No tasks");
  });

  test("Tasks tab: an empty list explains where tasks come from", () => {
    const n = mkInsp(rec("a"), { tab: "tasks" });
    expect(n.textContent).toContain("No tasks");
    expect(n.textContent).toContain("Todos claimed by or assigned to this agent appear here.");
  });

  test("Files tab: shows the directory; with none it says so", () => {
    const n = mkInsp(rec("a", { cwd: "/w/dir", task: "see src/app.py:3", messages: [{ body: "edit /w/dir/lib/x.js" }] }), { tab: "files" });
    expect(panel(n).querySelector("div.files-panel")).not.toBeNull();
    expect(n.textContent).toContain("/w/dir");
    const none = mkInsp(rec("b", { cwd: "" }), { tab: "files" });
    expect(none.textContent).toContain("No directory is known for this agent.");
  });

  test("update repaints the header and the current panel from the new record", () => {
    const n = mkInsp(rec("a", { title: "Old", task: "first" }));
    expect(kv(n)["Latest task"].textContent).toBe("first");
    n.update(rec("a", { title: "New", task: "second", state: "idle" }));
    expect(n.querySelector("div.insp-head h2").textContent).toBe("New");
    expect(n.querySelector("div.insp-head").textContent).toContain("Ready");
    expect(kv(n)["Latest task"].textContent).toBe("second");
  });

  test("setTab switches to a known tab, ignores unknown ids and the current one", () => {
    const n = mkInsp(rec("a"));
    n.setTab("tasks");
    expect(n.textContent).toContain("No tasks");
    expect(all(n, "button.tab").map((b) => b.getAttribute("aria-selected"))[2]).toBe("true");
    n.setTab("nope");
    expect(n.textContent).toContain("No tasks");
    const before = panel(n).children[0];
    n.setTab("tasks");
    expect(panel(n).children[0]).toBe(before); // no repaint
  });

  test("the composer sits in the footer except on the terminal tab, and keeps a draft across live updates of the same state", () => {
    const n = mkInsp(rec("a", { state: "idle" }));
    const foot = () => n.querySelector("div.drawer-foot");
    const ta = () => foot().querySelector("textarea");
    expect(ta()).not.toBeNull();
    ta().value = "draft text";
    n.update(rec("a", { state: "idle", task: "changed" }));
    expect(ta().value).toBe("draft text");
    n.update(rec("a", { state: "working" }));
    expect(ta().value).not.toBe("draft text"); // a new composer for the new state
    n.setTab("terminal");
    expect(foot().querySelector("textarea")).toBeNull();
    n.setTab("now");
    expect(foot().querySelector("textarea")).not.toBeNull();
  });

  test("sending from the composer posts to the seat, toasts the outcome and refreshes the channel", async () => {
    api.post = async (p, b) => { postCalls.push([p, b]); return { delivered: true, message: { delivery_text: "seen" } }; };
    const n = mkInsp(rec("a", { name: "impl-1", state: "idle", project: "/proj", cwd: "/c" }));
    const ta = n.querySelector("div.drawer-foot textarea");
    ta.value = "  do it  ";
    n.querySelector("div.drawer-foot button.btn-primary").click();
    await flush();
    expect(postCalls).toEqual([["colony/impl-1/send", { text: "do it", project: "/proj" }]]);
    expect(body.textContent).toContain("Delivered to impl-1");
    expect(body.textContent).toContain("seen");
    expect(patched.calls.refresh).toEqual([["irc"]]);
  });

  test("an undelivered send says Queued; with no project the cwd stands in", async () => {
    api.post = async (p, b) => { postCalls.push([p, b]); return {}; };
    const n = mkInsp(rec("a", { name: "impl-2", state: "idle", project: null, cwd: "/c/w" }));
    n.querySelector("div.drawer-foot textarea").value = "hi";
    n.querySelector("div.drawer-foot button.btn-primary").click();
    await flush();
    expect(postCalls[0]).toEqual(["colony/impl-2/send", { text: "hi", project: "/c/w" }]);
    expect(body.textContent).toContain("Queued for impl-2");
  });

  test("a needs-input agent's composer offers Open terminal, which switches to the terminal tab and reports it", () => {
    const seen = [];
    const n = mkInsp(rec("a", { state: "input", deep_link: "http://h:1/p?x=1" }), { onTab: (t) => seen.push(t) });
    const open = all(n.querySelector("div.drawer-foot"), "button").find((b) => b.textContent === "Open terminal");
    open.click();
    expect(seen).toEqual(["terminal"]);
    expect(n.querySelector("iframe.pane-frame")).not.toBeNull();
    expect(n.querySelector("div.drawer-foot textarea")).toBeNull();
  });
});

describe("Inspector terminal tab", () => {
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const mkInsp = (a, o = {}) => mount(Inspector({ agent: a, ...o }));
  const term = (n) => n.querySelector("div.insp-terminal");
  const withLayers = (l) => { st = stateOf({ layers: { daemon: { state: "up" }, herdr: { state: "up" }, webui: { state: "up" }, ...l } }); };

  test("with the web UI up, a pane frame loads the herdr link in chrome-less mode with the page theme", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const n = mkInsp(rec("a", { title: "Seat A", deep_link: "http://127.0.0.1:9000/pane/7?x=1" }), { tab: "terminal" });
    const f = n.querySelector("iframe.pane-frame");
    const u = new URL(f.getAttribute("src"));
    expect(u.origin + u.pathname).toBe("http://127.0.0.1:9000/pane/7");
    expect([u.searchParams.get("x"), u.searchParams.get("chrome"), u.searchParams.get("theme")]).toEqual(["1", "pane", "dark"]);
    expect(f.getAttribute("title")).toBe("Terminal for Seat A");
    expect(f.getAttribute("loading")).toBe("lazy");
    expect(f.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-forms allow-popups allow-downloads");
    expect(f.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(f.getAttribute("allow")).toBe("clipboard-read; clipboard-write");
    expect(f.dataset.src).toBe(f.getAttribute("src"));
    expect(n.textContent).toContain("The terminal owns every key. Ctrl+Shift+\\ returns focus to the page.");
    expect(all(term(n), "button").map((b) => b.textContent)).toEqual(["Open in Colony", "Open terminal"]);
  });

  test("the theme comes from the document, else the system preference", () => {
    const themeOf = (n) => new URL(n.querySelector("iframe.pane-frame").getAttribute("src")).searchParams.get("theme");
    const deep = { deep_link: "http://h:1/p" };
    document.documentElement.setAttribute("data-theme", "light");
    expect(themeOf(mkInsp(rec("a", deep), { tab: "terminal" }))).toBe("light");
    document.documentElement.removeAttribute("data-theme");
    window.matchMedia = () => ({ matches: true });
    expect(themeOf(mkInsp(rec("b", deep), { tab: "terminal" }))).toBe("light");
    window.matchMedia = (q) => ({ matches: false, media: q });
    expect(themeOf(mkInsp(rec("c", deep), { tab: "terminal" }))).toBe("dark");
    document.documentElement.setAttribute("data-theme", "sepia");
    expect(themeOf(mkInsp(rec("d", deep), { tab: "terminal" }))).toBe("dark");
  });

  test("an agent without a web address gets a clear empty state and no frame", () => {
    const n = mkInsp(rec("a", { deep_link: "" }), { tab: "terminal" });
    expect(n.querySelector("iframe")).toBeNull();
    expect(n.textContent).toContain("No terminal link");
    expect(n.textContent).toContain("The agent runtime did not report a web address for this pane. Recheck in a moment.");
  });

  test("a stopped agent runtime shows the degraded state with working Start and Recheck", () => {
    withLayers({ herdr: { state: "down", reason: "no socket" } });
    const n = mkInsp(rec("a"), { tab: "terminal" });
    expect(n.textContent).toContain("The agent runtime isn't running");
    expect(n.textContent).toContain("no socket");
    expect(n.querySelector("iframe")).toBeNull();
    all(n, "button").find((b) => b.textContent === "Start runtime").click();
    all(n, "button").find((b) => b.textContent === "Recheck").click();
    expect([patched.calls.startHerdr, patched.calls.recheck]).toEqual([1, 1]);
  });

  test("a stopped terminal service offers to start it; starting posts, toasts, rechecks and repaints", async () => {
    withLayers({ webui: { state: "down" } });
    const n = mkInsp(rec("a", { deep_link: "http://h:1/p" }), { tab: "terminal" });
    expect(n.textContent).toContain("The terminal service isn't running.");
    all(n, "button").find((b) => b.textContent === "Start terminal service").click();
    await flush();
    expect(postCalls).toEqual([["herd/ensure", {}]]);
    expect(body.textContent).toContain("Terminal service started");
    expect(patched.calls.recheck).toBe(1);
    all(n, "button").find((b) => b.textContent === "Recheck").click();
    expect(patched.calls.recheck).toBe(2);
  });

  test("a failed start of the terminal service shows the error and still rechecks", async () => {
    withLayers({ webui: { state: "down" } });
    api.post = async () => { throw Object.assign(new Error("x"), { error: "ensure refused", why: "no herdr" }); };
    const n = mkInsp(rec("a", { deep_link: "http://h:1/p" }), { tab: "terminal" });
    all(n, "button").find((b) => b.textContent === "Start terminal service").click();
    await flush();
    expect(body.textContent).toContain("ensure refused");
    expect(body.textContent).not.toContain("Terminal service started");
    expect(patched.calls.recheck).toBe(1);
  });

  test("a runtime with no web UI shows the seat text read-only, polled from herd/capture", async () => {
    withLayers({ webui: { state: "unknown", none: true } });
    const gets = [];
    api.get = async (p, q) => { gets.push([p, q]); return { text: "line one\nline two  \n\n" }; };
    const n = mkInsp(rec("a", { pane_id: "pane-7" }), { tab: "terminal" });
    await flush();
    const pre = n.querySelector("pre.pane-capture");
    expect(pre.dataset.pane).toBe("pane-7");
    expect(pre.getAttribute("aria-label")).toBe("Terminal output (read only)");
    expect(pre.getAttribute("tabindex")).toBe("0");
    expect(gets).toEqual([["herd/capture", { pane: "pane-7", lines: 60 }]]);
    expect(pre.textContent).toBe("line one\nline two");
    expect(pre.dataset.error).toBe("false");
    expect(timers.intervals.map((t) => t.ms)).toEqual([2000]);
    expect(n.textContent).toContain("Read-only view of this seat. Use the composer to send a prompt.");
    expect(n.querySelector("iframe")).toBeNull();
  });

  test("a failing capture is shown as text with the error flag", async () => {
    withLayers({ webui: { state: "unknown", none: true } });
    api.get = async () => { throw Object.assign(new Error("x"), { why: "seat gone" }); };
    const n = mkInsp(rec("a", { pane_id: "pane-7" }), { tab: "terminal" });
    await flush();
    const pre = n.querySelector("pre.pane-capture");
    expect(pre.textContent).toBe("Could not read this terminal: seat gone");
    expect(pre.dataset.error).toBe("true");
  });

  test("a runtime with no web UI and an agent without a pane says there is no seat to read", () => {
    withLayers({ webui: { state: "unknown", none: true } });
    const n = mkInsp(rec("a", { pane_id: "" }), { tab: "terminal" });
    expect(n.textContent).toContain("No terminal");
    expect(n.textContent).toContain("This agent has no seat to read.");
    expect(n.querySelector("pre.pane-capture")).toBeNull();
  });

  test("the terminal is built once and kept: switching away hides it and back reuses the same frame", () => {
    const n = mkInsp(rec("a", { deep_link: "http://h:1/p" }), { tab: "terminal" });
    const frame = n.querySelector("iframe.pane-frame");
    const host = frame.parent.parent;
    expect(host.hidden).toBe(false);
    n.setTab("now");
    expect(host.hidden).toBe(true);
    expect(n.querySelector("div.insp-panel-host").hidden).toBe(false);
    n.setTab("terminal");
    expect(host.hidden).toBe(false);
    expect(n.querySelector("div.insp-panel-host").hidden).toBe(true);
    expect(n.querySelector("iframe.pane-frame")).toBe(frame);
    n.update(rec("a", { deep_link: "http://h:1/p", title: "Retitled" }));
    expect(n.querySelector("iframe.pane-frame")).toBe(frame);
  });

  test("a changed pane address replaces the frame", () => {
    const n = mkInsp(rec("a", { deep_link: "http://h:1/p1" }), { tab: "terminal" });
    const first = n.querySelector("iframe.pane-frame");
    n.update(rec("a", { deep_link: "http://h:1/p2" }));
    const second = n.querySelector("iframe.pane-frame");
    expect(second).not.toBe(first);
    expect(second.getAttribute("src")).toContain("/p2");
  });

  test("the seat view is kept for the same pane and rebuilt (old poll stopped) for another", async () => {
    withLayers({ webui: { state: "unknown", none: true } });
    api.get = async () => ({ text: "x" });
    const n = mkInsp(rec("a", { pane_id: "p1" }), { tab: "terminal" });
    await flush();
    const first = n.querySelector("pre.pane-capture");
    n.update(rec("a", { pane_id: "p1", title: "again" }));
    expect(n.querySelector("pre.pane-capture")).toBe(first);
    n.update(rec("a", { pane_id: "p2" }));
    const second = n.querySelector("pre.pane-capture");
    expect(second).not.toBe(first);
    expect(second.dataset.pane).toBe("p2");
  });

  test("the seat poll stops once its view has left the page", async () => {
    withLayers({ webui: { state: "unknown", none: true } });
    let calls = 0;
    api.get = async () => { calls += 1; return { text: "x" }; };
    const n = mkInsp(rec("a", { pane_id: "p1" }), { tab: "terminal" });
    await flush();
    const tick = timers.intervals[0].fn;
    const pre = n.querySelector("pre.pane-capture");
    await tick(); // attached: the poll sees the view on the page
    await flush();
    expect(calls).toBeGreaterThan(1);
    const before = calls;
    pre.remove();
    await tick();
    await flush();
    expect(calls).toBe(before);
    expect(typeof pre.stop).toBe("function");
  });
});

describe("openAgentInspector", () => {
  const mountHost = () => {
    body.replaceChildren();
    const wrap = document.createElement("div");
    const host = document.createElement("aside");
    host.setAttribute("id", "inspector");
    wrap.appendChild(host);
    body.appendChild(wrap);
    return host;
  };
  const hostText = () => document.getElementById("inspector").textContent;

  test("mounts an inspector in the drawer host and returns the same node while the same agent stays open", () => {
    mountHost();
    const a = rec("a", { title: "Alpha" });
    const node = openAgentInspector(a);
    expect(node.getAttribute("aria-label")).toBe("Alpha");
    expect(document.getElementById("inspector").children[0]).toBe(node);
    expect(openAgentInspector(a)).toBe(node);
    expect(patched.subs.length).toBe(1);
  });

  test("reopening the same agent with a tab switches to it", () => {
    mountHost();
    const a = rec("a");
    const node = openAgentInspector(a);
    openAgentInspector(a, { tab: "tasks" });
    expect(hostText()).toContain("No tasks");
    expect(openAgentInspector(a, { tab: "tasks" })).toBe(node);
  });

  test("another agent replaces it and the old store subscription is dropped", () => {
    mountHost();
    const first = openAgentInspector(rec("a", { title: "Alpha" }));
    const second = openAgentInspector(rec("b", { title: "Beta" }));
    expect(second).not.toBe(first);
    expect(patched.subs.length).toBe(1);
    expect(hostText()).toContain("Beta");
    expect(hostText()).not.toContain("Alpha");
  });

  test("live store updates repaint the open inspector from the fresh record", () => {
    mountHost();
    openAgentInspector(rec("a", { title: "Alpha", task: "one" }));
    const fresh = rec("a", { title: "Alpha 2", task: "two" });
    patched.subs[0]({ byKey: new Map([["a", fresh]]) });
    expect(hostText()).toContain("Alpha 2");
    expect(hostText()).toContain("two");
    patched.subs[0]({ byKey: new Map() }); // the agent vanished: keep showing the last record
    expect(hostText()).toContain("Alpha 2");
  });

  test("closing runs the caller's onClose once and detaches from the store", () => {
    mountHost();
    let closed = 0;
    const node = openAgentInspector(rec("a"), { onClose: () => { closed += 1; } });
    expect(closeAgentInspector()).toBe(true);
    expect(closed).toBe(1);
    expect(patched.subs.length).toBe(0);
    expect(closeAgentInspector()).toBe(false);
    expect(closed).toBe(1);
    const again = openAgentInspector(rec("a"));
    expect(again).not.toBe(node);
  });

  test("opening an agent without a close callback closes cleanly", () => {
    mountHost();
    openAgentInspector(rec("a"));
    expect(() => closeAgentInspector()).not.toThrow();
  });

  test("a tab callback passed at open time is called when the user changes tabs", () => {
    mountHost();
    const seen = [];
    const node = openAgentInspector(rec("a"), { onTab: (t) => seen.push(t) });
    all(node, "button.tab").find((b) => b.textContent === "Files").click();
    expect(seen).toEqual(["files"]);
  });
});
