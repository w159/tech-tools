import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { body, installDom, restoreDom } from "./operate-dom-stub.js";
import { api } from "./api.js";

installDom();
const { agentsStore } = await import("./agents-store.js");
const mod = async () => (await import("./pages/agents.js?n=" + ++seq)).default;
let seq = 0;
const { headerSub, lensOf, LENS_COMPAT } = await import("./pages/agents.js");
restoreDom();

const NOW = Date.now();
const rec = (key, over = {}) => ({ key, name: key, title: "Title " + key, kind: "claude", state: "working", workspace: "ws", workspace_id: "w", pane_id: "pane-" + key, cwd: "/proj/" + key, project: "/proj", task: "", lastMsg: "", children: [], messages: [], tasks: [], since: NOW - 120000, sinceApprox: false, parent: null, colony: false, ...over });
const stateOf = (agents, over = {}) => {
  const counts = { input: 0, fail: 0, working: 0, idle: 0, done: 0, unknown: 0, total: agents.length };
  for (const a of agents) counts[a.state] += 1;
  return { loaded: true, agents, byKey: new Map(agents.map((a) => [a.key, a])), counts, down: null, layers: { daemon: { state: "up" }, herdr: { state: "up" }, webui: { state: "up" } }, generation: 1, ...over };
};
const buttons = (root, cls) => root.querySelectorAll("button" + (cls ? "." + cls : ""));
const btn = (root, label) => buttons(root).find((b) => b.textContent === label);
const tick = () => new Promise((r) => setTimeout(r, 15));

let page;
let ctx;
let nav;
let opened;
let store;
let subs;
let patched;
let savedApi;
let protoSaved;

function mkCtx({ channels = [], mode = "sse", project = "/p", params = {}, get } = {}) {
  nav = [];
  opened = [];
  return { project, params, navigate: (...a) => nav.push(a), openAgent: (...a) => opened.push(a), api: { mode, hasToken: true, post: async () => ({}), get: get || (async (p) => (p === "channels" ? { channels } : {})) } };
}

beforeEach(async () => {
  installDom();
  const proto = Object.getPrototypeOf(document.createElement("div"));
  protoSaved = { childNodes: Object.getOwnPropertyDescriptor(proto, "childNodes"), gbr: Object.getOwnPropertyDescriptor(proto, "getBoundingClientRect") };
  Object.defineProperty(proto, "childNodes", { get() { return this.children; }, configurable: true });
  Object.defineProperty(proto, "getBoundingClientRect", { value() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; }, configurable: true, writable: true });
  globalThis.innerHeight = 800;
  globalThis.innerWidth = 1440;
  globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
  savedApi = api.get;
  api.get = async () => { throw new Error("no hp"); };
  store = stateOf([]);
  subs = [];
  const calls = { refresh: [], startHerdr: 0, recheck: 0 };
  patched = { getState: agentsStore.getState, subscribe: agentsStore.subscribe, refresh: agentsStore.refresh, startHerdr: agentsStore.startHerdr, recheck: agentsStore.recheck, calls };
  agentsStore.getState = () => store;
  agentsStore.subscribe = (fn) => { subs.push(fn); fn(store); return () => { subs.splice(subs.indexOf(fn), 1); }; };
  agentsStore.refresh = async (names) => { calls.refresh.push(names); };
  agentsStore.startHerdr = async () => { calls.startHerdr += 1; };
  agentsStore.recheck = async () => { calls.recheck += 1; };
  page = await mod();
  ctx = mkCtx();
});
afterEach(() => {
  page.destroy();
  for (const k of ["getState", "subscribe", "refresh", "startHerdr", "recheck"]) agentsStore[k] = patched[k];
  api.get = savedApi;
  const proto = Object.getPrototypeOf(document.createElement("div"));
  for (const [k, d] of [["childNodes", protoSaved.childNodes], ["getBoundingClientRect", protoSaved.gbr]]) { if (d) Object.defineProperty(proto, k, d); else delete proto[k]; }
  delete globalThis.innerHeight;
  delete globalThis.innerWidth;
  delete globalThis.CustomEvent;
  restoreDom();
});

async function mount(c = ctx) {
  body.replaceChildren();
  await page.load(c);
  const node = page.render(c);
  body.appendChild(node);
  return node;
}
const clickView = async (node, label) => { btn(node, label).click(); await tick(); };

describe("agents page helpers", () => {
  test("lens ids: current ones pass, legacy ids alias, anything else is the roster", () => {
    expect(["roster", "supervise", "board"].map(lensOf)).toEqual(["roster", "supervise", "board"]);
    expect(LENS_COMPAT).toEqual({ fleet: "roster", colony: "roster", supervision: "supervise" });
    expect(["fleet", "colony", "supervision", "bogus", "", undefined, null].map(lensOf)).toEqual(["roster", "roster", "supervise", "roster", "roster", "roster", "roster"]);
  });

  test("header subtitle: loading, fleet counts in urgency order, colony fallback, nothing running", () => {
    expect(headerSub({ loaded: false, counts: { total: 3 } }, 2)).toBe("Loading agents");
    const counts = { total: 6, input: 1, fail: 0, working: 3, idle: 0, done: 2, unknown: 0 };
    expect(headerSub({ loaded: true, counts }, 4)).toBe("1 needs input, 3 working, 2 done");
    expect(headerSub({ loaded: true, counts: { total: 0 } }, 0)).toBe("No agents running");
    expect(headerSub({ loaded: true, counts: { total: 0 } }, 1)).toBe("1 colony member working");
    expect(headerSub({ loaded: true, counts: { total: 0 } }, 5)).toBe("5 colony members working");
  });
});

describe("agents page shell", () => {
  test("title, subtitle, the three lenses with the current one checked, and the three view switches", async () => {
    store = stateOf([rec("a"), rec("b", { state: "input" })]);
    const node = await mount();
    expect(node.querySelector("h1").textContent).toBe("Agents");
    expect(node.querySelector("p.sub").textContent).toBe("1 needs input, 1 working");
    const lens = node.querySelectorAll("div.seg")[0];
    expect(buttons(lens).map((b) => [b.textContent, b.getAttribute("aria-checked")])).toEqual([["Roster", "true"], ["Supervise", "false"], ["Board", "false"]]);
    expect(lens.getAttribute("aria-label")).toBe("Agents lens");
    const views = node.querySelectorAll("div.seg")[1];
    expect(views.getAttribute("aria-label")).toBe("View");
    expect(buttons(views).map((b) => [b.textContent, b.getAttribute("aria-checked")])).toEqual([["Members", "true"], ["Cards", "false"], ["List", "false"]]);
    expect(btn(node, "New workspace")).toBeDefined();
    expect(node.className).toBe("page agents-page is-wide");
  });

  test("clicking a lens navigates to it", async () => {
    const node = await mount();
    btn(node, "Supervise").click();
    btn(node, "Board").click();
    btn(node, "Roster").click();
    expect(nav).toEqual([["agents", { lens: "supervise" }], ["agents", { lens: "board" }], ["agents", { lens: "roster" }]]);
  });

  test("non-roster lenses have no view switch and no New workspace button; only the roster is wide", async () => {
    ctx = mkCtx({ params: { lens: "supervise" } });
    const node = await mount();
    expect(node.querySelectorAll("div.seg").length).toBe(1);
    expect(btn(node, "New workspace")).toBeUndefined();
    expect(node.className).toBe("page agents-page");
    expect(btn(node, "Supervise").getAttribute("aria-checked")).toBe("true");
    expect(btn(node, "Roster").getAttribute("aria-checked")).toBe("false");
  });

  test("legacy lens ids land on their lens; unknown ids on the roster", async () => {
    ctx = mkCtx({ params: { lens: "supervision" } });
    let node = await mount();
    expect(btn(node, "Supervise").getAttribute("aria-checked")).toBe("true");
    page.destroy();
    ctx = mkCtx({ params: { lens: "nonsense" } });
    node = await mount();
    expect(btn(node, "Roster").getAttribute("aria-checked")).toBe("true");
  });

  test("the subtitle repaints when the store publishes a new generation, and ignores a repeated one", async () => {
    store = stateOf([rec("a")], { generation: 1 });
    const node = await mount();
    expect(node.querySelector("p.sub").textContent).toBe("1 working");
    store = stateOf([rec("a"), rec("b")], { generation: 1 });
    subs[0](store);
    expect(node.querySelector("p.sub").textContent).toBe("1 working");
    store = stateOf([rec("a"), rec("b")], { generation: 2 });
    subs[0](store);
    expect(node.querySelector("p.sub").textContent).toBe("2 working");
  });

  test("destroy unsubscribes from the store and is safe to repeat", async () => {
    await mount();
    expect(subs.length).toBe(1);
    page.destroy();
    expect(subs.length).toBe(0);
    page.destroy();
  });

  test("loading again tears down the previous mount's subscription", async () => {
    await mount();
    await mount();
    expect(subs.length).toBe(1);
  });

  test("page identity", () => {
    expect([page.id, page.title, page.icon, page.group]).toEqual(["agents", "Agents", "agents", "Operate"]);
  });
});

describe("cards view", () => {
  test("loading state until the store has loaded", async () => {
    store = stateOf([], { loaded: false });
    const node = await mount();
    await clickView(node, "Cards");
    expect(node.querySelector("div.state-loading")).not.toBeNull();
    expect(node.querySelector("div.fleet-list-host")).toBeNull();
    expect(node.querySelector("p.sub").textContent).toBe("Loading agents");
  });

  test("herdr down shows the degraded state with working recheck and start buttons", async () => {
    store = stateOf([], { down: "herdr", layers: { daemon: { state: "up" }, herdr: { state: "down", reason: "socket gone" }, webui: { state: "up" } } });
    const node = await mount();
    await clickView(node, "Cards");
    expect(node.textContent).toContain("socket gone");
    expect(node.querySelector("div.filterbar")).toBeNull();
    expect(node.textContent).toContain("The agent runtime isn't running");
    btn(node, "Recheck").click();
    btn(node, "Start runtime").click();
    expect([patched.calls.recheck, patched.calls.startHerdr]).toEqual([1, 1]);
  });

  test("agents are grouped by project with a count; each group is a labelled section with one card per agent", async () => {
    store = stateOf([rec("a"), rec("b"), rec("c", { project: "/other" })]);
    ctx = mkCtx({ channels: [{ name: "proj@main", project: "/proj", members: [] }] });
    const node = await mount();
    await clickView(node, "Cards");
    const groups = node.querySelectorAll("section.fleet-group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["proj@main", "other"]);
    expect(groups[0].querySelector("h2").getAttribute("title")).toBe("/proj");
    expect(groups[0].querySelectorAll("span.num")[0].textContent).toBe("2");
    expect(groups[0].querySelectorAll("article.agent-card").map((c) => c.getAttribute("data-key"))).toEqual(["a", "b"]);
    expect(groups[1].querySelectorAll("article.agent-card").map((c) => c.getAttribute("data-key"))).toEqual(["c"]);
    expect(node.querySelectorAll("button").find((b) => b.textContent === "Members").getAttribute("aria-checked")).toBe("false");
    expect(btn(node, "Cards").getAttribute("aria-checked")).toBe("true");
  });

  test("channel info supplies the group label once channels have loaded, and the project falls back to the cwd", async () => {
    store = stateOf([rec("a", { project: null, cwd: "/work/sub/dir" })]);
    ctx = mkCtx({ channels: [{ name: "work@feat", project: "/work/", members: [{ name: "a" }] }] });
    const node = await mount();
    await clickView(node, "Cards");
    await tick();
    const g = node.querySelectorAll("section.fleet-group");
    expect(g.length).toBe(1);
    expect(g[0].getAttribute("aria-label")).toBe("work@feat");
    expect(g[0].querySelector("h2").getAttribute("title")).toBe("/work/");
    expect(g[0].textContent).toContain("work@feat");
  });

  test("an agent with neither project nor cwd is grouped under No project", async () => {
    store = stateOf([rec("a", { project: null, cwd: "" })]);
    const node = await mount();
    await clickView(node, "Cards");
    expect(node.querySelector("h2.fleet-group-head").textContent).toContain("No project");
  });

  test("filter chips list only states that have agents, with counts; clicking one narrows the list and clicking it again restores", async () => {
    store = stateOf([rec("a"), rec("b"), rec("c", { state: "input" })]);
    const node = await mount();
    await clickView(node, "Cards");
    const chips = () => node.querySelectorAll("button.chip");
    expect(chips().map((c) => c.textContent)).toEqual(["Needs input1", "Working2"]);
    expect(chips().map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    chips()[1].click();
    expect(chips().map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(node.querySelectorAll("article.agent-card").map((c) => c.getAttribute("data-key"))).toEqual(["a", "b"]);
    chips()[1].click();
    expect(node.querySelectorAll("article.agent-card").length).toBe(3);
    chips()[0].click();
    expect(node.querySelectorAll("article.agent-card").map((c) => c.getAttribute("data-key"))).toEqual(["c"]);
  });

  test("the search box filters by title, workspace, task and pane id, ignoring case and outer spaces", async () => {
    store = stateOf([rec("a", { title: "Alpha Lead", workspace: "one", task: "" }), rec("b", { title: "Beta", workspace: "Two", task: "fix parser" }), rec("c", { title: "Gamma", workspace: "three", pane_id: "px-77" })]);
    const node = await mount();
    await clickView(node, "Cards");
    const search = () => node.querySelector("input.search");
    expect(search().getAttribute("placeholder")).toBe("Filter agents");
    expect(search().getAttribute("aria-label")).toBe("Filter agents");
    const type = (v) => { const el = search(); el.value = v; (el.listeners.input || []).forEach((f) => f({ target: el })); };
    const keys = () => node.querySelectorAll("article.agent-card").map((c) => c.getAttribute("data-key"));
    type("  ALPHA ");
    expect(keys()).toEqual(["a"]);
    type("two");
    expect(keys()).toEqual(["b"]);
    type("parser");
    expect(keys()).toEqual(["b"]);
    type("PX-77");
    expect(keys()).toEqual(["c"]);
    type("");
    expect(keys()).toEqual(["a", "b", "c"]);
  });

  test("no match shows an empty state whose Clear filter button resets the filter and the search", async () => {
    store = stateOf([rec("a"), rec("b", { state: "input" })]);
    const node = await mount();
    await clickView(node, "Cards");
    const chip = node.querySelectorAll("button.chip")[1];
    chip.click();
    const el = node.querySelector("input.search");
    el.value = "zzz";
    el.listeners.input.forEach((f) => f({ target: el }));
    expect(node.textContent).toContain("No agents match");
    expect(node.textContent).toContain("Clear the filter to see all 2.");
    btn(node, "Clear filter").click();
    expect(node.querySelectorAll("article.agent-card").length).toBe(2);
    expect(node.querySelector("input.search").value).toBe("");
    expect(node.querySelectorAll("button.chip").map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
  });

  test("a selected chip stays visible even when its state has no agents any more", async () => {
    store = stateOf([rec("a"), rec("b", { state: "input" })]);
    const node = await mount();
    await clickView(node, "Cards");
    node.querySelectorAll("button.chip")[0].click(); // needs input
    store = stateOf([rec("a")], { generation: 2 });
    subs[0](store);
    expect(node.querySelectorAll("button.chip").map((c) => c.textContent)).toEqual(["Needs input0", "Working1"]);
  });

  test("an empty fleet offers Launch agent, which fires the launch event", async () => {
    store = stateOf([]);
    const node = await mount();
    await clickView(node, "Cards");
    expect(node.textContent).toContain("No agents running");
    expect(node.textContent).toContain("Agents appear here when you start one in a terminal or launch one from Atlas.");
    const fired = [];
    document.dispatchEvent = (e) => fired.push(e.type);
    btn(node, "Launch agent").click();
    expect(fired).toEqual(["atlas:launch"]);
  });

  test("a down web UI adds a note but keeps the list", async () => {
    store = stateOf([rec("a")], { layers: { daemon: { state: "up" }, herdr: { state: "up" }, webui: { state: "down" } } });
    const node = await mount();
    await clickView(node, "Cards");
    expect(node.textContent).toContain("The terminal service isn't running. The agent list is live; terminals need it.");
    expect(node.querySelectorAll("article.agent-card").length).toBe(1);
    store = stateOf([rec("a")]);
    const n2 = await mount();
    await clickView(n2, "Cards");
    expect(n2.textContent).not.toContain("terminal service");
  });

  test("clicking a card opens that agent; the selected agent from the URL is marked", async () => {
    store = stateOf([rec("a"), rec("b")]);
    ctx = mkCtx({ params: { agent: "b" } });
    const node = await mount();
    await clickView(node, "Cards");
    const cards = node.querySelectorAll("article.agent-card");
    expect(cards.map((c) => c.getAttribute("data-selected"))).toEqual([null, "true"]);
    cards[0].listeners.click[0]({});
    expect(opened.length).toBe(1);
    expect(opened[0][0].key).toBe("a");
    expect(opened[0][1]).toEqual({ tab: undefined });
  });

  test("Enter on a card opens it; Shift+Enter opens its terminal tab", async () => {
    store = stateOf([rec("a")]);
    const node = await mount();
    await clickView(node, "Cards");
    const card = node.querySelector("article.agent-card");
    card.listeners.keydown[0]({ target: card, key: "Enter", shiftKey: true, preventDefault() {} });
    card.listeners.keydown[0]({ target: card, key: "Enter", shiftKey: false, preventDefault() {} });
    expect(opened.map((o) => o[1].tab)).toEqual(["terminal", undefined]);
  });

  test("a card names its parent and opens it from the chip", async () => {
    const parent = rec("p", { title: "Parent" });
    store = stateOf([parent, rec("c", { parent: "p" })]);
    const node = await mount();
    await clickView(node, "Cards");
    const chip = node.querySelectorAll("button.chip-link").find((b) => b.textContent === "under Parent");
    expect(chip).toBeDefined();
    chip.listeners.click[0]({ stopPropagation() {} });
    expect(opened.length).toBe(1);
    expect(opened[0][0].key).toBe("p");
  });

  test("a lead's card offers Supervise, which opens the supervise lens on its subchannel", async () => {
    store = stateOf([rec("lead", { name: "lead" }), rec("plain")]);
    ctx = mkCtx({ channels: [{ name: "proj@main/lead", parent: "proj@main", project: "/proj", lead: "lead", members: [{ name: "lead" }] }] });
    const node = await mount();
    await clickView(node, "Cards");
    await tick();
    const chips = node.querySelectorAll("button.chip-link").filter((b) => b.textContent === "Supervise");
    expect(chips.length).toBe(1);
    chips[0].listeners.click[0]({ stopPropagation() {} });
    expect(nav).toEqual([["agents", { lens: "supervise", channel: "proj@main/lead" }]]);
  });

  test("a parent with subagents offers Supervise without naming a channel", async () => {
    store = stateOf([rec("p", { children: [{ key: "k", state: "idle", title: "kid" }] })]);
    const node = await mount();
    await clickView(node, "Cards");
    const chip = node.querySelectorAll("button.chip-link").find((b) => b.textContent === "Supervise");
    chip.listeners.click[0]({ stopPropagation() {} });
    expect(nav).toEqual([["agents", { lens: "supervise", channel: undefined }]]);
  });

  test("channel info and projects loaded from the API are requested for the current project, once per 20 seconds", async () => {
    const gets = [];
    store = stateOf([rec("a")]);
    ctx = mkCtx({ project: "/pp", get: async (p, q) => { gets.push([p, q]); return { channels: [] }; } });
    const node = await mount();
    await clickView(node, "Cards");
    btn(node, "Cards").click();
    await tick();
    expect(gets.filter((g) => g[0] === "channels")).toEqual([["channels", { project: "/pp" }]]);
  });

  test("a failed channel load still renders the fleet, grouped by folder", async () => {
    store = stateOf([rec("a")]);
    ctx = mkCtx({ get: async () => { throw new Error("channels down"); } });
    const node = await mount();
    await clickView(node, "Cards");
    await tick();
    expect(node.querySelector("section.fleet-group").getAttribute("aria-label")).toBe("proj");
  });

  test("a store update while cards are showing redraws them", async () => {
    store = stateOf([rec("a")]);
    const node = await mount();
    await clickView(node, "Cards");
    expect(node.querySelectorAll("article.agent-card").length).toBe(1);
    store = stateOf([rec("a"), rec("b")], { generation: 2 });
    subs[0](store);
    expect(node.querySelectorAll("article.agent-card").length).toBe(2);
  });

  test("changed channel membership redraws the fleet with the new channel chip", async () => {
    let channels = [];
    store = stateOf([rec("a")]);
    ctx = mkCtx({ get: async () => ({ channels }) });
    const node = await mount();
    await clickView(node, "Cards");
    await tick();
    expect(node.textContent).not.toContain("proj@main");
    channels = [{ name: "proj@main", project: "/proj", members: [{ name: "a" }] }];
    page.destroy();
    page = await mod(); // a fresh page: the 20 second channel cache starts empty
    const n2 = await mount();
    await clickView(n2, "Cards");
    await tick();
    expect(n2.querySelector("section.fleet-group").getAttribute("aria-label")).toBe("proj@main");
  });
});

describe("list view", () => {
  const rows = (node) => node.querySelectorAll("tr.agent-tr").map((r) => r.getAttribute("data-key"));

  test("rows sort by urgency first; header buttons sort by a column and toggle direction", async () => {
    store = stateOf([
      rec("w1", { title: "Zed", state: "working", task: "b task", since: NOW - 1000 }),
      rec("n1", { title: "Amy", state: "input", task: "a task", since: NOW - 9000 }),
      rec("i1", { title: "Mid", state: "idle", task: "c task", since: NOW - 5000, children: [{}, {}] }),
    ]);
    const node = await mount();
    await clickView(node, "List");
    expect(rows(node)).toEqual(["n1", "w1", "i1"]);
    const th = (label) => node.querySelectorAll("button.th-btn").find((b) => b.textContent.startsWith(label));
    th("Agent").click();
    expect(rows(node)).toEqual(["n1", "i1", "w1"]);
    th("Agent").click();
    expect(rows(node)).toEqual(["w1", "i1", "n1"]);
    th("Now").click();
    expect(rows(node)).toEqual(["n1", "w1", "i1"]);
    th("In state").click();
    expect(rows(node)).toEqual(["w1", "i1", "n1"]);
    th("Subagents").click();
    expect(rows(node)).toEqual(["n1", "w1", "i1"]);
    th("Subagents").click();
    expect(rows(node)).toEqual(["i1", "n1", "w1"]);
    th("State").click();
    expect(rows(node)).toEqual(["n1", "w1", "i1"]);
  });

  test("sorting by project uses the group label; by channel uses the channel's full name", async () => {
    store = stateOf([rec("a", { project: "/zz" }), rec("b", { project: "/aa" }), rec("c", { project: "/mm" })]);
    ctx = mkCtx({ channels: [{ name: "c@x", project: "/mm", members: [{ name: "c" }] }, { name: "b@x", project: "/aa", members: [{ name: "b" }] }, { name: "a@x", project: "/zz", members: [{ name: "a" }] }] });
    const node = await mount();
    await clickView(node, "List");
    await tick();
    const th = (label) => node.querySelectorAll("button.th-btn").find((b) => b.textContent.startsWith(label));
    th("Project").click();
    expect(rows(node)).toEqual(["a", "b", "c"]); // a@x, b@x, c@x
    th("Project").click();
    expect(rows(node)).toEqual(["c", "b", "a"]);
    th("Channel").click();
    expect(rows(node)).toEqual(["a", "b", "c"]);
    th("Channel").click();
    expect(rows(node)).toEqual(["c", "b", "a"]);
  });

  test("sorting by channel puts agents with no channel last", async () => {
    store = stateOf([rec("orphan", { project: "/o" }), rec("b", { project: "/b" }), rec("a", { project: "/a" })]);
    ctx = mkCtx({ channels: [{ name: "b@x", project: "/b", members: [{ name: "b" }] }, { name: "a@x", project: "/a", members: [{ name: "a" }] }] });
    const node = await mount();
    await clickView(node, "List");
    await tick();
    node.querySelectorAll("button.th-btn").find((b) => b.textContent.startsWith("Channel")).click();
    expect(rows(node)).toEqual(["a", "b", "orphan"]);
  });

  test("a larger list sorts by subagent count and by channel, both ways, whatever the store order", async () => {
    const keys = ["d", "b", "e", "a", "c"];
    const kids = { d: 3, b: 1, e: 4, a: 0, c: 2 };
    store = stateOf(keys.map((k) => rec(k, { project: "/p" + k, children: Array.from({ length: kids[k] }, () => ({})) })));
    ctx = mkCtx({ channels: keys.map((k) => ({ name: "x@" + k, project: "/p" + k, members: [{ name: k }] })) });
    const node = await mount();
    await clickView(node, "List");
    await tick();
    const th = (label) => node.querySelectorAll("button.th-btn").find((b) => b.textContent.startsWith(label));
    th("Subagents").click();
    expect(rows(node)).toEqual(["a", "b", "c", "d", "e"]);
    th("Subagents").click();
    expect(rows(node)).toEqual(["e", "d", "c", "b", "a"]);
    th("Channel").click();
    expect(rows(node)).toEqual(["a", "b", "c", "d", "e"]);
    th("Channel").click();
    expect(rows(node)).toEqual(["e", "d", "c", "b", "a"]);
    th("Project").click();
    expect(rows(node)).toEqual(["a", "b", "c", "d", "e"]);
    th("Agent").click();
    th("Agent").click();
    expect(rows(node)).toEqual(["e", "d", "c", "b", "a"]); // titles are "Title <key>"
  });

  test("the sorted column carries aria-sort", async () => {
    store = stateOf([rec("a"), rec("b")]);
    const node = await mount();
    await clickView(node, "List");
    const sortOf = () => node.querySelectorAll("th").map((t) => t.getAttribute("aria-sort"));
    expect(sortOf()[0]).toBe("ascending");
    node.querySelectorAll("button.th-btn")[1].click();
    expect(sortOf().slice(0, 2)).toEqual(["none", "ascending"]);
    node.querySelectorAll("button.th-btn")[1].click();
    expect(sortOf().slice(0, 2)).toEqual(["none", "descending"]);
  });

  test("row open and the selected row", async () => {
    store = stateOf([rec("a"), rec("b")]);
    ctx = mkCtx({ params: { agent: "a" } });
    const node = await mount();
    await clickView(node, "List");
    const trs = node.querySelectorAll("tr.agent-tr");
    expect(trs.map((t) => t.getAttribute("data-selected"))).toEqual(["true", null]);
    trs[1].listeners.click[0]({});
    expect(opened[0][0].key).toBe("b");
    trs[1].listeners.keydown[0]({ target: trs[1], key: "Enter", shiftKey: true, preventDefault() {} });
    expect(opened[1][1]).toEqual({ tab: "terminal" });
  });

  test("project and channel cells show the group label and channel alias", async () => {
    store = stateOf([rec("a")]);
    ctx = mkCtx({ channels: [{ name: "proj@main", project: "/proj", members: [{ name: "a" }] }] });
    const node = await mount();
    await clickView(node, "List");
    await tick();
    const tr = node.querySelector("tr.agent-tr");
    expect(tr.querySelector("td.td-project").textContent).toBe("proj@main");
    expect(tr.querySelector("td.td-chan").textContent).toBe("proj@main");
  });

  test("filters apply to the list too", async () => {
    store = stateOf([rec("a"), rec("b", { state: "idle" })]);
    const node = await mount();
    await clickView(node, "List");
    node.querySelectorAll("button.chip")[1].click(); // Ready
    expect(rows(node)).toEqual(["b"]);
  });
});

describe("members view and lens switching", () => {
  test("members is the default view: the roster is mounted, not the fleet", async () => {
    const node = await mount();
    await tick();
    expect(node.querySelector("div.fleet-list-host")).toBeNull();
    expect(node.querySelector("div.agents-body")).not.toBeNull();
    expect(node.querySelector("div.colony-bar")).not.toBeNull();
  });

  test("switching from cards back to members unmounts the fleet and remounts the roster", async () => {
    store = stateOf([rec("a")]);
    const node = await mount();
    await clickView(node, "Cards");
    expect(node.querySelector("div.fleet-list-host")).not.toBeNull();
    await clickView(node, "Members");
    expect(node.querySelector("div.fleet-list-host")).toBeNull();
    expect(node.querySelector("div.colony-bar")).not.toBeNull();
  });

  test("the roster's working count feeds the subtitle when the fleet is empty", async () => {
    ctx = mkCtx({ get: async (p) => (p === "colony" ? { project: "/p", channel: null, members: [{ name: "lead", kind: "lead", state: "running", steerable: true }, { name: "w-1", kind: "worker", state: "running", steerable: true }, { name: "w-2", kind: "worker", state: "idle", steerable: true }] } : { channels: [] }) });
    const node = await mount();
    await tick();
    expect(node.querySelector("p.sub").textContent).toBe("2 colony members working");
  });

  test("the supervise lens mounts and is torn down on switch", async () => {
    ctx = mkCtx({ params: { lens: "supervise" }, get: async (p) => (p === "channels" ? { channels: [] } : {}) });
    const node = await mount();
    await tick();
    expect(node.textContent).toContain("No lead is supervising subagents");
    page.destroy();
  });

  test("the board lens mounts the work page, its title demoted to a section heading", async () => {
    ctx = mkCtx({ params: { lens: "board" }, get: async () => ({ phases: [{ name: "Backlog", items: [{ id: "t1", content: "Ship the thing", status: "open" }] }], counts: {} }) });
    ctx.api.hasToken = true;
    const node = await mount();
    await tick();
    await tick();
    expect(node.textContent).toContain("Ship the thing");
    expect(node.querySelectorAll("h1").length).toBe(1); // the page's own heading only
  });

  test("a board that fails to load shows an error state with Retry", async () => {
    ctx = mkCtx({ params: { lens: "board" }, get: async () => { throw Object.assign(new Error("daemon down"), { error: "daemon down" }); } });
    const node = await mount();
    await tick();
    await tick();
    expect(node.textContent).toContain("daemon down");
  });

  test("a board that loads but throws while rendering shows the same error state, not a blank page", async () => {
    const data = { phases: [] };
    Object.defineProperty(data, "counts", { get() { throw Object.assign(new Error("render blew up"), { error: "render blew up" }); } });
    ctx = mkCtx({ params: { lens: "board" }, get: async () => data });
    const node = await mount();
    await tick();
    await tick();
    expect(node.textContent).toContain("render blew up");
    expect(node.querySelector("#work-root")).toBeNull();
  });
});

describe("live events", () => {
  test("herd events refresh the roster; others do not; poll ticks refresh while in poll mode", async () => {
    const gets = [];
    ctx = mkCtx({ get: async (p) => { gets.push(p); return p === "colony" ? { members: [] } : { channels: [] }; } });
    await mount();
    await tick();
    const colony = () => gets.filter((p) => p === "colony").length;
    const before = colony();
    page.onEvent("todos", ctx, {});
    await tick();
    expect(colony()).toBe(before);
    page.onEvent("herd", ctx, {});
    await tick();
    expect(colony()).toBe(before + 1);
    page.onEvent("tick", ctx, {});
    await tick();
    expect(colony()).toBe(before + 1); // sse mode: ticks are not a poll fallback
    ctx.api.mode = "poll";
    page.onEvent("tick", ctx, {});
    await tick();
    expect(colony()).toBe(before + 2);
  });

  test("the supervise lens refreshes on irc, todos and herd events and on poll ticks only", async () => {
    const gets = [];
    ctx = mkCtx({ params: { lens: "supervise" }, get: async (p) => { gets.push(p); return { channels: [] }; } });
    await mount();
    await tick();
    const n = () => gets.length;
    let base = n();
    for (const name of ["irc", "todos", "herd"]) {
      page.onEvent(name, ctx, {});
      await tick();
      expect(n()).toBe(base + 1);
      base = n();
    }
    page.onEvent("health", ctx, {});
    page.onEvent("tick", ctx, {});
    await tick();
    expect(n()).toBe(base);
    ctx.api.mode = "poll";
    page.onEvent("tick", ctx, {});
    await tick();
    expect(n()).toBe(base + 1);
  });

  test("with the board lens up, events go to the work page instead", async () => {
    ctx = mkCtx({ params: { lens: "board" }, get: async () => ({ phases: [], counts: {} }) });
    await mount();
    await tick();
    await tick();
    expect(() => page.onEvent("todos", ctx, {})).not.toThrow();
    await tick();
  });
});

describe("agent actions menu", () => {
  const press = (n) => (n.listeners.click || []).forEach((f) => f({ preventDefault() {}, stopPropagation() {} }));
  const openMenu = async (a, c = ctx) => {
    store = stateOf([a]);
    const node = await mount(c);
    await clickView(node, "Cards");
    press(node.querySelector("button.row-menu"));
    const items = () => body.querySelectorAll("button.menu-item");
    return { node, items, item: (label) => items().find((b) => b.textContent === label) };
  };

  test("Open terminal, Message and Send prompt open the agent on the right tab; Assign task goes to the board lens", async () => {
    const a = rec("a");
    const m = await openMenu(a);
    expect(m.items().map((b) => b.textContent)).toEqual(["Open terminal", "Message", "Send prompt", "Assign task", "Stop"]);
    const [term, msg, prompt, assign] = m.items();
    term.click();
    msg.click();
    prompt.click();
    expect(opened).toEqual([[a, { tab: "terminal" }], [a, { tab: "channel" }], [a, { tab: "channel" }]]);
    expect(nav).toEqual([]);
    assign.click();
    expect(nav).toEqual([["agents", { lens: "board" }]]);
  });

  test("Stop asks first, then kills the seat by name in its project and refreshes the herd", async () => {
    const posts = [];
    const savedPost = api.post;
    api.post = async (p, b) => { posts.push([p, b]); return {}; };
    try {
      const m = await openMenu(rec("a", { name: "worker/1", title: "Fix it", project: "/proj" }));
      m.item("Stop").click();
      await tick();
      expect(posts).toEqual([]);
      expect(body.textContent).toContain("Kill worker/1?");
      btn(body, "Cancel").click();
      await tick();
      expect(posts).toEqual([]);
      expect(patched.calls.refresh).toEqual([]);
      press(m.node.querySelector("button.row-menu"));
      m.item("Stop").click();
      await tick();
      btn(body, "Kill").click();
      await tick();
      expect(posts).toEqual([["colony/worker%2F1/kill", { project: "/proj" }]]);
      expect(patched.calls.refresh).toEqual([["herd"]]);
    } finally {
      api.post = savedPost;
    }
  });

  test("a seat with no name is killed by its title, in the page's project when it has none of its own", async () => {
    const posts = [];
    const savedPost = api.post;
    api.post = async (p, b) => { posts.push([p, b]); return {}; };
    try {
      const m = await openMenu(rec("a", { name: "", title: "Solo", project: null }), mkCtx({ project: "/pg" }));
      m.item("Stop").click();
      await tick();
      expect(body.textContent).toContain("Kill Solo?");
      btn(body, "Kill").click();
      await tick();
      expect(posts).toEqual([["colony/Solo/kill", { project: "/pg" }]]);
    } finally {
      api.post = savedPost;
    }
  });

  test("a failed kill does not refresh the herd", async () => {
    const savedPost = api.post;
    api.post = async () => { throw new Error("nope"); };
    try {
      const m = await openMenu(rec("a", { project: "/proj" }));
      m.item("Stop").click();
      await tick();
      btn(body, "Kill").click();
      await tick();
      expect(patched.calls.refresh).toEqual([]);
    } finally {
      api.post = savedPost;
    }
  });
});

describe("project grouping and the channel cache", () => {
  const groupLabels = (node) => node.querySelectorAll("section.fleet-group").map((s) => s.getAttribute("aria-label"));
  let realNow;
  let now;
  beforeEach(() => { realNow = Date.now; now = 5_000_000; Date.now = () => now; });
  afterEach(() => { Date.now = realNow; });

  test("an agent without a registered project joins the channel project its directory sits in", async () => {
    const channels = [{ name: "proj@main", project: "/proj/", members: [] }, { name: "other@main", project: "/proj2", members: [] }];
    store = stateOf([
      rec("in", { project: null, cwd: "/proj/deep/dir" }),
      rec("near", { project: null, cwd: "/proj2/x" }),
      rec("same", { project: null, cwd: "/proj2" }),
      rec("prefix", { project: null, cwd: "/projx/y" }),
    ]);
    ctx = mkCtx({ channels });
    const node = await mount();
    await clickView(node, "Cards");
    await tick();
    expect(groupLabels(node).sort()).toEqual(["other@main", "proj@main", "y"]);
    const section = (label) => node.querySelectorAll("section.fleet-group").find((s) => s.getAttribute("aria-label") === label);
    expect(section("proj@main").querySelectorAll("article.agent-card").length).toBe(1);
    expect(section("other@main").querySelectorAll("article.agent-card").length).toBe(2);
    expect(section("y").querySelectorAll("article.agent-card").length).toBe(1);
  });

  test("a channel without a project never claims an agent; no channel and no directory is the No project group", async () => {
    store = stateOf([rec("a", { project: null, cwd: "/x/y" }), rec("b", { project: null, cwd: "" })]);
    ctx = mkCtx({ channels: [{ name: "loose", members: [] }] });
    const node = await mount();
    await clickView(node, "Cards");
    await tick();
    const heads = node.querySelectorAll("h2.fleet-group-head").map((h2) => h2.textContent);
    expect(heads.sort()).toEqual(["No project1", "y1"]);
  });

  test("a registered project wins over the channel the directory is in", async () => {
    store = stateOf([rec("a", { project: "/reg", cwd: "/proj/a" })]);
    ctx = mkCtx({ channels: [{ name: "proj@main", project: "/proj", members: [] }] });
    const node = await mount();
    await clickView(node, "Cards");
    await tick();
    expect(groupLabels(node)).toEqual(["reg"]);
  });

  test("channels are re-read after 20 seconds and not before", async () => {
    let n = 0;
    store = stateOf([rec("a")]);
    ctx = mkCtx({ get: async (p) => { if (p === "channels") n += 1; return { channels: [] }; } });
    const node = await mount();
    await clickView(node, "Cards");
    await tick();
    expect(n).toBe(1);
    now += 19_999;
    subs[0](stateOf([rec("a")], { generation: 2 }));
    await tick();
    expect(n).toBe(1);
    now += 1;
    subs[0](stateOf([rec("a")], { generation: 3 }));
    await tick();
    expect(n).toBe(2);
    now += 20_000;
    subs[0](stateOf([rec("a")], { generation: 4 }));
    await tick();
    expect(n).toBe(3);
  });

  test("a change of only a member's pane redraws the cards with the new channel chip", async () => {
    let channels = [{ name: "proj@main", project: "/proj", members: [{ name: "zz", pane_id: "elsewhere" }] }];
    store = stateOf([rec("a")]);
    ctx = mkCtx({ get: async () => ({ channels }) });
    const node = await mount();
    await clickView(node, "Cards");
    await tick();
    const before = node.querySelector("article.agent-card").textContent;
    channels = [{ name: "proj@main", project: "/proj", members: [{ name: "zz", pane_id: "a" }] }];
    now += 20_000;
    subs[0](stateOf([rec("a")], { generation: 2 }));
    await tick();
    expect(node.querySelector("article.agent-card").textContent).not.toBe(before);
    expect(node.querySelector("article.agent-card").textContent).toContain("proj@main");
  });

  test("a channel load that lands after the view moved to Members or the page was destroyed leaves the page alone", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    store = stateOf([rec("a")]);
    ctx = mkCtx({ get: async () => { await gate; return { channels: [{ name: "proj@main", project: "/proj", members: [{ name: "a" }] }] }; } });
    const node = await mount();
    await clickView(node, "Cards");
    await clickView(node, "Members");
    release();
    await tick();
    expect(node.querySelectorAll("section.fleet-group").length).toBe(0);
    expect(node.querySelectorAll("div.fleet-list-host").length).toBe(0);
  });

  test("a channel load that lands after the page was destroyed does not redraw it", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    store = stateOf([rec("a")]);
    ctx = mkCtx({ get: async () => { await gate; return { channels: [{ name: "proj@main", project: "/proj", members: [{ name: "a" }] }] }; } });
    const node = await mount();
    await clickView(node, "Cards");
    expect(groupLabels(node)).toEqual(["proj"]);
    page.destroy();
    release();
    await tick();
    expect(groupLabels(node)).toEqual(["proj"]);
  });

  test("a channel load that lands while another lens is up leaves it alone", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    store = stateOf([rec("a")]);
    ctx = mkCtx({ get: async (p) => { if (p === "channels") { await gate; return { channels: [{ name: "proj@main", project: "/proj", members: [{ name: "a" }] }] }; } return { channels: [] }; } });
    const node = await mount();
    await clickView(node, "Cards");
    btn(node, "Supervise").click();
    ctx.params.lens = "supervise";
    const sup = await mount(mkCtx({ params: { lens: "supervise" }, get: async () => ({ channels: [] }) }));
    release();
    await tick();
    expect(sup.querySelectorAll("section.fleet-group").length).toBe(0);
  });
});

describe("herdr-projects chips and store updates", () => {
  let realNow;
  let now;
  let hpSeq = 0;
  beforeEach(() => { realNow = Date.now; now = 9_000_000 + 100_000 * ++hpSeq; Date.now = () => now; });
  afterEach(() => { Date.now = realNow; });
  // the module caches the last answer, so each test has its own agent directory
  const hpData = (cwd) => ({ projects: [{ slug: "hp-proj", threads: [{ id: "t" + hpSeq, cwd, status: "open", branch: "br" }] }] });

  test("thread info arriving after the first draw adds the chip to the cards", async () => {
    api.get = async (p) => { if (p === "projects/hp") return hpData("/hp/p1"); throw new Error("x"); };
    store = stateOf([rec("a", { cwd: "/hp/p1" })]);
    const node = await mount();
    await clickView(node, "Cards");
    await tick();
    expect(node.querySelectorAll("span.hp-chip").length).toBe(1);
  });

  test("thread info arriving after the page was destroyed or moved to Members draws nothing", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    api.get = async (p) => { if (p === "projects/hp") { await gate; return hpData("/hp/n1"); } throw new Error("x"); };
    store = stateOf([rec("a", { cwd: "/hp/n1" })]);
    const node = await mount();
    await clickView(node, "Cards");
    page.destroy();
    release();
    await tick();
    expect(node.querySelectorAll("span.hp-chip").length).toBe(0);
  });

  test("thread info arriving while the Members view is up does not paint the cards over it", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    api.get = async (p) => { if (p === "projects/hp") { await gate; return hpData("/hp/n2"); } throw new Error("x"); };
    store = stateOf([rec("a", { cwd: "/hp/n2" })]);
    const node = await mount();
    await clickView(node, "Cards");
    await clickView(node, "Members");
    release();
    await tick();
    expect(node.querySelectorAll("article.agent-card").length).toBe(0);
  });

  test("while the roster is not up (board lens), store updates leave the body alone; with members up they do not draw the fleet", async () => {
    store = stateOf([rec("a")]);
    const node = await mount();
    expect(node.querySelectorAll("article.agent-card").length).toBe(0);
    subs[0](stateOf([rec("a"), rec("b")], { generation: 2 }));
    expect(node.querySelectorAll("article.agent-card").length).toBe(0);
    expect(node.querySelectorAll("div.fleet-list-host").length).toBe(0);
  });

  test("a store update on the supervise lens repaints the head without drawing the fleet", async () => {
    store = stateOf([rec("a")]);
    ctx = mkCtx({ params: { lens: "supervise" }, get: async () => ({ channels: [] }) });
    const node = await mount();
    await tick();
    store = stateOf([rec("a"), rec("b", { state: "input" })], { generation: 2 });
    subs[0](store);
    expect(node.querySelector("p.sub").textContent).toBe("1 needs input, 1 working");
    expect(node.querySelectorAll("article.agent-card").length).toBe(0);
    expect(node.querySelectorAll("div.fleet-list-host").length).toBe(0);
  });

  test("an update with the same generation is ignored", async () => {
    store = stateOf([rec("a")]);
    const node = await mount();
    await clickView(node, "Cards");
    store = stateOf([rec("a"), rec("b")], { generation: 1 });
    subs[0](store);
    expect(node.querySelectorAll("article.agent-card").length).toBe(1);
    store = stateOf([rec("a"), rec("b")], { generation: 2 });
    subs[0](store);
    expect(node.querySelectorAll("article.agent-card").length).toBe(2);
  });
});

describe("page contract", () => {
  test("load returns nothing and leaves the chosen view alone when a link names an agent", async () => {
    await mount();
    expect(await page.load(mkCtx({ params: { agent: "x" } }))).toBeNull();
    const node = page.render(ctx);
    expect(btn(node, "Members").getAttribute("aria-checked")).toBe("true");
    await clickView(node, "List");
    expect(await page.load(mkCtx({ params: { seat: "s" } }))).toBeNull();
    expect(btn(page.render(ctx), "List").getAttribute("aria-checked")).toBe("true");
  });

  test("with the board lens up, events and their result are the work page's own", async () => {
    const work = (await import("./pages/work.js")).default;
    const saved = work.onEvent;
    const seen = [];
    work.onEvent = (...a) => { seen.push(a); return "handled"; };
    try {
      ctx = mkCtx({ params: { lens: "board" }, get: async () => ({ phases: [], counts: {} }) });
      await mount();
      await tick();
      await tick();
      const data = { k: 1 };
      expect(page.onEvent("herd", ctx, data)).toBe("handled");
      expect(seen).toEqual([["herd", ctx, data]]);
    } finally {
      work.onEvent = saved;
    }
  });

  test("New workspace opens the prompt with the page's project as the directory, or none for all projects", async () => {
    const dir = () => body.querySelectorAll("input").map((i) => i.value);
    let node = await mount(mkCtx({ project: "/work/proj" }));
    btn(node, "New workspace").click();
    expect(body.textContent).toContain("New workspace");
    expect(dir()).toContain("/work/proj");
    page.destroy();
    node = await mount(mkCtx({ project: "all" }));
    btn(node, "New workspace").click();
    expect(dir()).not.toContain("all");
    expect(dir()).toContain("");
  });

  test("agents still loading show the loading state, not the toolbar", async () => {
    store = stateOf([], { loaded: false });
    const node = await mount();
    await clickView(node, "Cards");
    expect(node.querySelector("input.search")).toBeNull();
    expect(node.querySelector("section.fleet-group")).toBeNull();
  });
});
