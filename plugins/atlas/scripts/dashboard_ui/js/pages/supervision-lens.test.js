import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installRichDom, restoreRichDom, fire } from "../rich-dom.js";
import { agentsStore } from "../agents-store.js";
import { fetchFailures, clearFetchFail } from "../fetch-fail.js";

let dom, mountSupervisionLens, lenses, calls, savedAgents, timers;
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
beforeEach(async () => {
  dom = installRichDom();
  ({ mountSupervisionLens } = await import("./supervision-lens.js"));
  lenses = [];
  calls = [];
  timers = [];
  globalThis.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; }; // State() arms 600ms/8s timers; none may fire
  globalThis.clearTimeout = () => {};
  savedAgents = agentsStore.getState().agents;
  agentsStore.getState().agents = [];
});
afterEach(() => {
  lenses.forEach((l) => l.destroy());
  for (const f of fetchFailures()) clearFetchFail(f.endpoint);
  agentsStore.getState().agents = savedAgents;
  globalThis.setTimeout = realTimers.setTimeout;
  globalThis.clearTimeout = realTimers.clearTimeout;
  restoreRichDom();
});
const until = async (cond, what = "condition") => { const end = Date.now() + 2000; while (!cond()) { if (Date.now() > end) throw new Error("timed out: " + what); await new Promise((r) => realTimers.setTimeout(r, 1)); } };

const MAIN = { name: "app@main", project: "/w/app", branch: "main", members: [] };
const sub = (lead, over = {}) => ({ name: `app@main/${lead}`, parent: "app@main", project: "/w/app", branch: "main", lead, members: [], ...over });
// ctx.api.get answers "channels" with `chans` and "channels/<name>" with boards[name] (an Error rejects)
function mount({ chans, boards = {}, params = {}, project = "/w/app", chansErr } = {}) {
  const spies = { navigate: [], openAgent: [] };
  const ctx = {
    project, params,
    navigate: (...a) => spies.navigate.push(a),
    openAgent: (...a) => spies.openAgent.push(a),
    api: {
      get: async (path, q) => {
        calls.push([path, q]);
        if (path === "channels") { if (chansErr) throw chansErr; return { channels: chans }; }
        const b = boards[decodeURIComponent(path.slice("channels/".length))];
        if (b instanceof Error) throw b;
        return b || {};
      },
    },
  };
  const body = document.createElement("div");
  dom.body.appendChild(body);
  const lens = mountSupervisionLens(ctx, body);
  lenses.push(lens);
  return { ctx, body, lens, spies };
}
const BOARD = { board: { owners: [
  { owner: "boss", role: "lead", counts: {}, items: [{ status: "in_progress", content: "plan" }, { status: "open", content: "later" }] },
  { owner: "w1", role: "subagent", parent: "boss", items: [{ status: "done", content: "x" }, { status: "blocked", content: "y" }], last_note: { text: "stuck", ts: 1 } },
] } };
const sections = (body) => body.querySelectorAll("section.sup-lead");

describe("supervision lens", () => {
  test("shows a loading skeleton first, then asks for the channel list in the active project", async () => {
    const { body } = mount({ chans: [MAIN] });
    expect(body.querySelector(".state-loading").getAttribute("aria-busy")).toBe("true");
    expect(body.querySelector(".state-loading-label")).not.toBeNull();
    await until(() => !body.querySelector(".state-loading"));
    expect(calls[0]).toEqual(["channels", { project: "/w/app" }]);
  });
  test("with no lead subchannels it explains and offers to open Channel", async () => {
    const { body, spies } = mount({ chans: [MAIN] });
    await until(() => body.querySelector(".state-empty"));
    expect(body.querySelector("h2").textContent).toBe("No lead is supervising subagents");
    expect(body.querySelector(".state-body").textContent).toContain("atlas_todo.py channel-open");
    body.querySelector(".state-actions button").click();
    expect(spies.navigate).toEqual([["channels"]]);
    expect(calls).toHaveLength(1);
  });
  test("a response without a channel list counts as no leads", async () => {
    const { body } = mount({ chans: undefined });
    await until(() => body.querySelector(".state-empty"));
  });
  test("one tree per lead subchannel, each with its own board fetched with limit 1", async () => {
    const a = sub("boss");
    const b = sub("zed");
    const { body } = mount({ chans: [MAIN, a, b], boards: { [a.name]: BOARD } });
    await until(() => sections(body).length === 2);
    expect(calls.map((c) => c[0])).toEqual(["channels", "channels/" + encodeURIComponent(a.name), "channels/" + encodeURIComponent(b.name)]);
    expect(calls[1][1]).toEqual({ limit: 1, project: "/w/app" });
    expect(sections(body).map((s) => s.getAttribute("aria-label"))).toEqual(["Lead boss", "Lead zed"]);
  });
  test("the project 'all' is sent as no project to the board read but verbatim to the list", async () => {
    const a = sub("boss");
    mount({ chans: [a], project: "all", boards: { [a.name]: BOARD } });
    await until(() => calls.length === 2);
    expect(calls[0][1]).toEqual({ project: "all" });
    expect(calls[1][1]).toEqual({ limit: 1, project: undefined });
  });
  test("the head names the lead, its parent channel, subagent count and summed todos", async () => {
    const a = sub("boss", { members: [{ name: "boss", kind: "lead" }, { name: "w1" }] });
    const { body } = mount({ chans: [a], boards: { [a.name]: BOARD } });
    await until(() => sections(body).length === 1);
    const s = sections(body)[0];
    expect(s.querySelector("h2").textContent).toBe("Lead boss");
    expect(s.querySelector("h2").getAttribute("title")).toBe(a.name);
    expect(s.querySelector(".sup-head .dim").textContent).toBe("app@main · 1 subagent · 1 active, 1 open, 1 blocked, 1 done");
  });
  test("plural subagents, and 'no todos' when the board is empty or missing", async () => {
    const a = sub("boss", { members: [{ name: "boss", kind: "lead" }, { name: "w1" }, { name: "w2" }] });
    const { body } = mount({ chans: [a] });
    await until(() => sections(body).length === 1);
    expect(sections(body)[0].querySelector(".sup-head .dim").textContent).toBe("app@main · 2 subagents · no todos");
  });
  test("a lead with no members says it has not dispatched anyone", async () => {
    const { body } = mount({ chans: [sub("boss")] });
    await until(() => sections(body).length === 1);
    expect(sections(body)[0].querySelector(".chan-empty").textContent).toBe("This lead has not dispatched any subagents yet.");
    expect(sections(body)[0].querySelector(".mb-list")).toBeNull();
  });
  test("members render as a nested board: lead first, subagents indented", async () => {
    const a = sub("boss", { members: [{ name: "w1" }, { name: "boss", kind: "lead" }] });
    const { body } = mount({ chans: [a], boards: { [a.name]: BOARD } });
    await until(() => sections(body).length === 1);
    const rows = body.querySelectorAll(".mb-row");
    expect(rows.map((r) => r.querySelector(".mb-name").textContent)).toEqual(["boss", "w1"]);
    expect(rows.map((r) => r.getAttribute("data-nested"))).toEqual([null, "true"]);
    expect(rows[0].querySelector(".mb-now").textContent).toBe("Nowplan");
    expect(rows[1].querySelector(".mb-note").textContent).toContain("stuck");
  });
  test("the Channel button and a row's Message button navigate to that channel", async () => {
    const a = sub("boss", { members: [{ name: "boss", kind: "lead" }] });
    const { body, spies } = mount({ chans: [a], boards: { [a.name]: BOARD } });
    await until(() => sections(body).length === 1);
    body.querySelector(".sup-head button").click();
    expect(spies.navigate.at(-1)).toEqual(["channels", { channel: a.name, tab: "board" }]);
    body.querySelector(".mb-row button").click();
    expect(spies.navigate.at(-1)).toEqual(["channels", { channel: a.name }]);
  });
  test("Open appears for a member with a live agent and opens it", async () => {
    const rec = { name: "boss", key: "k1", state: "working" };
    agentsStore.getState().agents = [rec];
    const a = sub("boss", { members: [{ name: "boss", kind: "lead" }, { name: "w1" }] });
    const { body, spies } = mount({ chans: [a], boards: { [a.name]: BOARD } });
    await until(() => sections(body).length === 1);
    const opens = body.querySelectorAll("button[aria-label^='Open ']");
    expect(opens.map((b) => b.getAttribute("aria-label"))).toEqual(["Open boss"]);
    opens[0].click();
    expect(spies.openAgent).toEqual([[rec]]);
  });
  test("the lead named in the route is marked and listed first", async () => {
    const a = sub("alpha");
    const b = sub("beta");
    const { body } = mount({ chans: [a, b], params: { channel: b.name } });
    await until(() => sections(body).length === 2);
    expect(sections(body).map((s) => s.getAttribute("aria-label"))).toEqual(["Lead beta", "Lead alpha"]);
    expect(sections(body).map((s) => s.getAttribute("data-on"))).toEqual(["true", null]);
  });
  test("without a route channel the listed order is kept and nothing is marked", async () => {
    const { body } = mount({ chans: [sub("alpha"), sub("beta")] });
    await until(() => sections(body).length === 2);
    expect(sections(body).map((s) => s.getAttribute("aria-label"))).toEqual(["Lead alpha", "Lead beta"]);
    expect(sections(body).every((s) => s.getAttribute("data-on") === null)).toBe(true);
  });
  test("a failed channel list shows an error with Retry, which refetches", async () => {
    const { body, ctx } = mount({ chansErr: Object.assign(new Error("x"), { error: "daemon_down", why: "not running" }) });
    await until(() => body.querySelector(".state-error"));
    expect(body.querySelector("h2").textContent).toBe("Daemon down");
    expect(body.querySelector(".state-body").textContent).toBe("not running");
    ctx.api.get = async (path, q) => { calls.push([path, q]); return { channels: [] }; };
    body.querySelector(".state-actions button").click();
    await until(() => body.querySelector(".state-empty"));
  });
  test("a lead whose board cannot be read still renders (zero todos) and the failure is reported, then cleared on recovery", async () => {
    const a = sub("boss", { members: [{ name: "boss", kind: "lead" }] });
    const { body, lens } = mount({ chans: [a], boards: { [a.name]: new Error("boom") } });
    await until(() => sections(body).length === 1);
    expect(sections(body)[0].querySelector(".sup-head .dim").textContent).toContain("no todos");
    expect(fetchFailures().map((f) => [f.page, f.endpoint])).toEqual([["supervision", "channels/" + a.name]]);
    expect(document.querySelector(".fetch-fail-banner")).not.toBeNull();
    // second refresh succeeds
  });
  test("a recovered board read clears the stale-data banner", async () => {
    const a = sub("boss", { members: [{ name: "boss", kind: "lead" }] });
    const boards = { [a.name]: new Error("boom") };
    const { body, lens } = mount({ chans: [a], boards });
    await until(() => fetchFailures().length === 1);
    boards[a.name] = BOARD;
    await lens.refresh();
    await until(() => fetchFailures().length === 0);
    expect(document.querySelector(".fetch-fail-banner")).toBeNull();
    expect(body.querySelector(".sup-head .dim").textContent).toContain("1 active");
  });
  test("overlapping refreshes are collapsed: a second call while one is in flight does nothing", async () => {
    let release;
    const a = sub("boss");
    const { lens, ctx } = mount({ chans: [a] });
    await until(() => calls.length >= 2);
    ctx.api.get = (path, q) => { calls.push([path, q]); return new Promise((r) => { release = r; }); };
    const first = lens.refresh();
    const n = calls.length;
    await lens.refresh();
    expect(calls.length).toBe(n);
    release({ channels: [] });
    await first;
  });
  test("repaint redraws only once data has arrived; destroy stops all further work", async () => {
    const a = sub("boss");
    const { body, lens, ctx } = mount({ chans: [a] });
    lens.repaint();
    expect(body.querySelector(".state-loading")).not.toBeNull();
    await until(() => sections(body).length === 1);
    ctx.params.channel = a.name;
    lens.repaint();
    expect(sections(body)[0].getAttribute("data-on")).toBe("true");
    lens.destroy();
    const n = calls.length;
    await lens.refresh();
    lens.repaint();
    expect(calls.length).toBe(n);
    ctx.params.channel = "other";
    lens.repaint();
    expect(sections(body)[0].getAttribute("data-on")).toBe("true");
  });
  test("a destroyed lens that gets a late response does not paint", async () => {
    let release;
    const { body, lens, ctx } = mount({ chans: [] });
    await until(() => body.querySelector(".state-empty"));
    ctx.api.get = () => { ctx.api.get = async () => ({}); return new Promise((r) => { release = r; }); };
    let p;
    await until(() => { p = lens.refresh(); return release; });
    lens.destroy();
    body.textContent = "";
    release({ channels: [sub("boss")] });
    await p;
    expect(body.textContent).toBe("");
  });
});
