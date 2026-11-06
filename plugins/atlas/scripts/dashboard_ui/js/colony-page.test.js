import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { body as docBody, installDom, restoreDom } from "./operate-dom-stub.js";

// pages/colony.js against the shared operate-dom stub. Globals are installed per test and restored; the module singletons
// it touches (api.post, rosterDeps, fetch-fail registry) are restored too.
installDom();
const colony = await import("./pages/colony.js");
const { api } = await import("./api.js");
const { fetchFailures, clearFetchFail } = await import("./fetch-fail.js");
restoreDom();
const { canSteer, sendBlock, projectOf, sendBody, killBody, colonyGroups, SNAP_STATE, terminalParams, livenessText, NO_PANE, MemberRow, allProjects, mountRoster, waveAll, rosterDeps } = colony;

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realNow = Date.now;
const NOW = 1_800_000_000_000;
let savedPost;
let rosters;
let nodeProto;
let savedRemoveChild;

beforeEach(() => {
  installDom();
  nodeProto = Object.getPrototypeOf(docBody);
  savedRemoveChild = Object.getOwnPropertyDescriptor(nodeProto, "removeChild");
  nodeProto.removeChild = function (c) { this.children = this.children.filter((x) => x !== c); c.parent = null; return c; };
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => {};
  Date.now = () => NOW;
  savedPost = api.post;
  rosters = [];
  delete rosterDeps.api; delete rosterDeps.confirm;
  // toast() falls back to document.body without a #toast-root, and trims that host's children: give it one
  const root = new docBody.constructor("div");
  root.attrs.id = "toast-root";
  docBody.appendChild(root);
});
afterEach(() => {
  rosters.forEach((r) => r.destroy());
  fetchFailures().forEach((f) => clearFetchFail(f.endpoint));
  api.post = savedPost;
  delete rosterDeps.api; delete rosterDeps.confirm;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  Date.now = realNow;
  if (savedRemoveChild) Object.defineProperty(nodeProto, "removeChild", savedRemoveChild); else delete nodeProto.removeChild;
  restoreDom();
});

const walk = (n, out = []) => { if (n) { out.push(n); (n.children || []).forEach((c) => walk(c, out)); } return out; };
const hasClass = (n, c) => (n.attrs && n.attrs.class ? n.attrs.class.split(/\s+/).includes(c) : false);
const byClass = (root, c) => walk(root).filter((n) => hasClass(n, c));
const byTag = (root, t) => walk(root).filter((n) => n.tag === t);
const one = (root, c) => { const r = byClass(root, c); if (r.length !== 1) throw new Error(`expected one .${c}, got ${r.length}`); return r[0]; };
const txt = (n) => n.textContent;
const fire = (n, ev, arg) => n.listeners[ev].forEach((f) => f(arg));
const btn = (root, label) => byTag(root, "button").find((b) => txt(b) === label);
const labels = (root) => byTag(root, "button").map(txt);
const settle = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
const flush = async () => { await settle(); await new Promise((r) => realSetTimeout(r, 0)); await settle(); };
const mkCtx = (over = {}) => {
  const nav = [];
  return { params: {}, project: "/p", navigate: (...a) => nav.push(a), nav, ...over };
};

// =================================================================== pure helpers
describe("pure helpers", () => {
  test("canSteer: running, idle and stuck only", () => {
    for (const s of ["running", "idle", "stuck"]) expect(canSteer({ state: s })).toBe(true);
    for (const s of ["finished", "dead", "parked", "working", undefined, ""]) expect(canSteer({ state: s })).toBe(false);
  });

  test("project resolution: the route's project, else the context's; POST bodies carry it", () => {
    expect(projectOf({ params: { project: "/r" }, project: "/c" })).toBe("/r");
    expect(projectOf({ params: {}, project: "/c" })).toBe("/c");
    expect(projectOf({ params: { project: "" }, project: "/c" })).toBe("/c");
    expect(sendBody({ params: {}, project: "/c" }, "t")).toEqual({ text: "t", project: "/c" });
    expect(killBody({ params: { project: "/r" }, project: "/c" })).toEqual({ project: "/r" });
  });

  test("sendBlock: finished mentions the exit code when there is one (0 included), dead is gone", () => {
    expect(sendBlock({ state: "finished" })).toBe("Finished: nothing to send to.");
    expect(sendBlock({ state: "finished", exit_code: null })).toBe("Finished: nothing to send to.");
    expect(sendBlock({ state: "finished", exit_code: 0 })).toBe("Finished (exit 0): nothing to send to.");
    expect(sendBlock({ state: "finished", exit_code: 137 })).toBe("Finished (exit 137): nothing to send to.");
    expect(sendBlock({ state: "dead" })).toBe("This member is gone: nothing to send to.");
  });

  test("sendBlock: the server's refusal reason wins for live members; otherwise steerable or headless may receive", () => {
    expect(sendBlock({ state: "running", deliver: { ok: false, reason: "why not" } })).toBe("why not");
    expect(sendBlock({ state: "running", steerable: true, deliver: { ok: false, reason: "nope" } })).toBe("nope");
    expect(sendBlock({ state: "running", steerable: true, deliver: { ok: true, reason: "ignored" } })).toBe("");
    expect(sendBlock({ state: "idle", steerable: true })).toBe("");
    expect(sendBlock({ state: "idle", headless: true })).toBe("");
    expect(sendBlock({ state: "idle" })).toBe("This member cannot receive messages.");
    expect(sendBlock({ state: "dead", steerable: true, deliver: { ok: false, reason: "r" } })).toBe("This member is gone: nothing to send to.");
  });

  test("colonyGroups groups by project (falling back to the snapshot's), names by last path segment, keeps order", () => {
    const snap = {
      project: "/snap/root",
      colonies: [{ id: "c1", project: "/a/one" }, { id: "c2" }, { id: "c3", project: "/a/one/" }, { id: "c4", project: "/b" }],
      seats: [{ name: "s1", colony: "c1" }, { name: "s2", colony: "c2" }, { name: "s3", colony: "c1" }, { name: "s4", colony: "none" }],
    };
    const g = colonyGroups(snap);
    expect(g.map((x) => [x.project, x.name])).toEqual([["/a/one", "one"], ["/snap/root", "root"], ["/a/one/", "one"], ["/b", "b"]]);
    expect(g[0].colonies[0].seats.map((s) => s.name)).toEqual(["s1", "s3"]);
    expect(g[1].colonies[0].seats.map((s) => s.name)).toEqual(["s2"]);
    expect(g[2].colonies[0].seats).toEqual([]);
    expect(colonyGroups(null)).toEqual([]);
    expect(colonyGroups({})).toEqual([]);
    expect(colonyGroups({ colonies: [{ id: "x" }] })).toEqual([{ project: "", name: "", colonies: [{ colony: { id: "x" }, seats: [] }] }]);
    expect(colonyGroups({ colonies: [{ id: "a", project: "/p" }, { id: "b", project: "/p" }], seats: [] })[0].colonies.length).toBe(2);
    expect(colonyGroups({ colonies: [{ id: "x", project: "/" }] })[0].name).toBe("/");
  });

  test("snapshot seat states map onto roster states; others pass through", () => {
    expect(SNAP_STATE).toEqual({ working: "running", blocked: "stuck", unknown: "running" });
  });

  test("terminalParams / livenessText / NO_PANE", () => {
    expect(terminalParams({ name: "w", colony: "c1" })).toEqual({ space: "c1", seat: "w" });
    expect(terminalParams({ name: "w" })).toEqual({ seat: "w" });
    expect(livenessText({ liveness: { text: "active" } })).toBe("active");
    expect(livenessText({ liveness: {} })).toBe("");
    expect(livenessText({})).toBe("");
    expect(NO_PANE).toContain("injected into the session on its next tool call");
  });
});

// =================================================================== MemberRow
describe("MemberRow", () => {
  const member = (over = {}) => ({ name: "impl-1", kind: "worker", state: "running", steerable: true, tasks: [], ...over });
  const row = (m, ctx = mkCtx(), refresh = () => {}) => MemberRow(m, ctx, refresh);

  test("row attributes: kind, state and selection by seat or agent param (name or pane id)", () => {
    const li = row(member({ pane_id: "w1-p2" }));
    expect(li.tag).toBe("li");
    expect(li.attrs.class).toBe("colony-row");
    expect(li.attrs["data-kind"]).toBe("worker");
    expect(li.attrs["data-state"]).toBe("running");
    expect(li.attrs["data-selected"]).toBeUndefined();
    expect(row(member(), mkCtx({ params: { seat: "impl-1" } })).attrs["data-selected"]).toBe("true");
    expect(row(member(), mkCtx({ params: { agent: "impl-1" } })).attrs["data-selected"]).toBe("true");
    expect(row(member({ pane_id: "w1-p2" }), mkCtx({ params: { agent: "w1-p2" } })).attrs["data-selected"]).toBe("true");
    expect(row(member(), mkCtx({ params: { seat: "other" } })).attrs["data-selected"]).toBeUndefined();
    expect(row(member({ pane_id: undefined }), mkCtx({ params: { seat: "zzz" } })).attrs["data-selected"]).toBeUndefined();
    expect(row(member({ pane_id: undefined, name: "" }), mkCtx({ params: {} })).attrs["data-selected"]).toBeUndefined();
  });

  test("header: address or name, kind chip, state badge, chips for no pane / steerable / channel", () => {
    const li = row(member({ address: "impl-1@lead", headless: true, steerable: true, channel: "demo@main" }));
    const top = one(li, "colony-top");
    expect(txt(byTag(top, "strong")[0])).toBe("impl-1@lead");
    expect(byTag(top, "strong")[0].attrs.title).toBe("impl-1");
    const chips = byClass(top, "chip-lite");
    expect(chips.map(txt)).toEqual(["worker", "no terminal pane", "steerable", "demo@main"]);
    expect(chips[1].attrs.title).toBe(NO_PANE);
    expect(chips[2].attrs.title).toBe("Prompts reach it live");
    expect(chips[3].attrs.title).toBe("Channel");
    expect(chips[3].attrs.class).toBe("chip-lite mono");
    const badge = one(top, "badge");
    expect(txt(badge)).toBe("running");
    expect(badge.attrs["data-state"]).toBe("working");
    const plain = row(member({ steerable: false }));
    expect(byClass(one(plain, "colony-top"), "chip-lite").map(txt)).toEqual(["worker"]);
    expect(txt(byTag(one(plain, "colony-top"), "strong")[0])).toBe("impl-1");
  });

  test("state badges: stuck needs input, finished is done, dead failed, parked (by state or flag) reads parked and idle", () => {
    const st = (m) => { const b = one(one(row(m), "colony-top"), "badge"); return [txt(b), b.attrs["data-state"]]; };
    expect(st(member({ state: "stuck" }))).toEqual(["stuck", "input"]);
    expect(st(member({ state: "idle" }))).toEqual(["idle", "idle"]);
    expect(st(member({ state: "finished" }))).toEqual(["finished", "done"]);
    expect(st(member({ state: "dead" }))).toEqual(["dead", "fail"]);
    expect(st(member({ state: "parked" }))).toEqual(["parked", "idle"]);
    expect(st(member({ state: "running", parked: true }))).toEqual(["parked", "idle"]);
    expect(st(member({ state: "running", parked: false }))).toEqual(["running", "working"]);
  });

  test("Open terminal deep-links to the member's seat", () => {
    const ctx = mkCtx();
    const li = row(member({ colony: "run1" }), ctx);
    const open = btn(li, "Open terminal");
    expect(open.attrs["aria-label"]).toBe("Open terminal for impl-1");
    open.click();
    expect(ctx.nav).toEqual([["terminal", { space: "run1", seat: "impl-1" }]]);
  });

  test("a steerable worker gets Pause, Cancel and Stop; the lead gets none of them", () => {
    const li = row(member());
    expect(labels(one(li, "colony-top"))).toEqual(["Open terminal", "Pause", "Cancel", "Stop"]);
    expect(btn(li, "Pause").attrs["aria-label"]).toBe("Pause impl-1");
    expect(btn(li, "Cancel").attrs["aria-label"]).toBe("Cancel impl-1");
    expect(btn(li, "Cancel").attrs.class).toContain("btn-danger");
    expect(btn(li, "Stop").attrs["aria-label"]).toBe("Stop impl-1");
    expect(btn(li, "Stop").attrs.class).toContain("btn-danger");
    expect(labels(one(row(member({ kind: "lead" })), "colony-top"))).toEqual(["Open terminal"]);
    expect(labels(one(row(member({ state: "finished" })), "colony-top"))).toEqual(["Open terminal"]);
    expect(labels(one(row(member({ state: "parked" })), "colony-top"))).toEqual(["Open terminal"]);
  });

  test("a paused worker offers Resume instead of Pause; a canceled one offers Resume and no Cancel", () => {
    const paused = row(member({ paused: true }));
    expect(labels(one(paused, "colony-top"))).toEqual(["Open terminal", "Resume", "Cancel", "Stop"]);
    expect(btn(paused, "Resume").attrs["aria-label"]).toBe("Resume impl-1");
    const canceled = row(member({ canceled: true }));
    expect(labels(one(canceled, "colony-top"))).toEqual(["Open terminal", "Resume", "Stop"]);
  });

  test("Pause, Resume, Cancel and Stop post to the colony routes with the project, then refresh", async () => {
    const posts = [];
    rosterDeps.api = { post: async (p, b) => { posts.push([p, b]); } };
    rosterDeps.confirm = async () => true;
    let refreshed = 0;
    const ctx = mkCtx({ params: { project: "/route" } });
    const li = row(member(), ctx, () => refreshed++);
    for (const l of ["Pause", "Cancel", "Stop"]) { btn(li, l).click(); await flush(); }
    const resumeRow = row(member({ paused: true }), ctx, () => refreshed++);
    btn(resumeRow, "Resume").click(); await flush();
    expect(posts).toEqual([
      ["colony/impl-1/pause", { project: "/route" }],
      ["colony/impl-1/cancel", { project: "/route" }],
      ["colony/impl-1/kill", { project: "/route" }],
      ["colony/impl-1/resume", { project: "/route" }],
    ]);
    expect(refreshed).toBe(4);
  });

  test("a declined confirmation posts nothing", async () => {
    const posts = [];
    rosterDeps.api = { post: async (p, b) => { posts.push([p, b]); } };
    rosterDeps.confirm = async () => false;
    const li = row(member());
    btn(li, "Stop").click(); await flush();
    btn(li, "Cancel").click(); await flush();
    expect(posts).toEqual([]);
  });

  test("meta line: liveness, last activity / last seen, exit code (0 too), ended, log path", () => {
    const m = member({ liveness: { text: "active, 12s ago", active: true, source: "transcript" }, last_active: NOW / 1000 - 3600, exit_code: 0, ended_at: NOW / 1000 - 7200, log_path: "/tmp/x.log" });
    const meta = one(row(m), "colony-meta");
    const spans = byTag(meta, "span");
    expect(spans.map(txt)).toEqual(["active, 12s ago", "last active 1h ago", "exit 0", "ended 2h ago", "log /tmp/x.log"]);
    expect(spans[0].attrs["data-active"]).toBe("true");
    expect(spans[0].attrs.title).toBe("From its newest transcript, not from a terminal pane");
    expect(spans[1].attrs.title).toBe("Last activity: a note, a todo update or its join");
    expect(spans[4].attrs.title).toBe("/tmp/x.log");
    expect(spans[4].attrs.class).toBe("mono truncate");
    expect(byClass(meta, "colony-live")[0].attrs["data-active"]).toBe("true");
    const inactive = one(row(member({ liveness: { text: "idle 7 min", active: false, source: "log" } })), "colony-live");
    expect(inactive.attrs["data-active"]).toBe("false");
    const parkedMeta = one(row(member({ state: "parked", last_active: NOW / 1000 - 60 })), "colony-meta");
    expect(txt(byTag(parkedMeta, "span")[0])).toBe("last seen 1m ago");
    const parkedFlag = one(row(member({ parked: true, last_active: NOW / 1000 - 60 })), "colony-meta");
    expect(txt(byTag(parkedFlag, "span")[0])).toBe("last seen 1m ago");
    expect(byTag(one(row(member()), "colony-meta"), "span").length).toBe(0);
    expect(byTag(one(row(member({ exit_code: null })), "colony-meta"), "span").length).toBe(0);
  });

  test("tasks: none, open ones listed (max 8) with overflow, completed counted, nothing-open note", () => {
    expect(txt(one(row(member({ tasks: [] })), "colony-notasks"))).toBe("No tasks assigned");
    expect(byClass(row(member({ tasks: [] })), "mb-items").length).toBe(0);
    const mixed = [{ status: "in_progress", title: "a" }, { status: "completed", title: "b" }, { status: "done", title: "c" }, { status: "pending", title: "d" }];
    const li = row(mixed.length ? member({ tasks: mixed }) : null);
    const items = byTag(one(li, "mb-items"), "li");
    expect(items.map((i) => [i.attrs["data-status"], txt(i.children[0]), txt(i.children[1])])).toEqual([["in_progress", "in_progress", "a"], ["pending", "pending", "d"]]);
    expect(items[0].children[1].attrs.title).toBe("a");
    expect(one(li, "mb-items").attrs["aria-label"]).toBe("impl-1 tasks");
    expect(txt(one(li, "colony-notasks"))).toBe("2 completed");
    const many = Array.from({ length: 11 }, (_, i) => ({ status: "pending", title: "t" + i }));
    const big = row(member({ tasks: [...many, { status: "done", title: "z" }] }));
    expect(byTag(one(big, "mb-items"), "li").length).toBe(8);
    expect(txt(one(big, "colony-notasks"))).toBe("+3 more open · 1 completed");
    const done = row(member({ tasks: [{ status: "done", title: "z" }] }));
    expect(byClass(done, "mb-items").length).toBe(0);
    expect(txt(one(done, "colony-notasks"))).toBe("1 completed · nothing open");
    const exactly8 = row(member({ tasks: many.slice(0, 8) }));
    expect(txt(one(exactly8, "colony-notasks"))).toBe("");
  });

  test("note: placeholder when absent, text and age when present (no age at ts 0)", () => {
    const none = one(row(member()), "mb-note");
    expect(txt(none)).toBe("No notes yet");
    expect(none.attrs.class).toBe("mb-note dim");
    const note = one(row(member({ last_note: { text: "halfway", ts: NOW / 1000 - 120 } })), "mb-note");
    expect(note.attrs.title).toBe("halfway");
    expect(note.attrs.class).toBe("mb-note");
    expect(note.children.map(txt)).toEqual(["Note", "halfway", "2m ago"]);
    expect(one(row(member({ last_note: { text: "x", ts: 0 } })), "mb-note").children.length).toBe(2);
  });

  test("send box: enabled with a name placeholder, disabled with the reason when blocked, and the reason is explained below", () => {
    const ok = row(member());
    const box = one(ok, "colony-send-text");
    expect(box.attrs["aria-label"]).toBe("Message impl-1");
    expect(box.attrs.placeholder).toBe("Message impl-1");
    expect(box.attrs.type).toBe("text");
    expect(!!box.disabled).toBe(false);
    expect(!!btn(ok, "Send").disabled).toBe(false);
    expect(byClass(ok, "colony-send-why").length).toBe(0);
    const blocked = row(member({ state: "dead" }));
    const off = one(blocked, "colony-send-text");
    expect(off.disabled).toBe(true);
    expect(off.attrs.placeholder).toBe("This member is gone: nothing to send to.");
    expect(btn(blocked, "Send").disabled).toBe(true);
    expect(txt(one(blocked, "colony-send-why"))).toBe("This member is gone: nothing to send to.");
    const reasonOnly = row(member({ deliver: { ok: true, reason: "heads up" } }));
    expect(txt(one(reasonOnly, "colony-send-why"))).toBe("heads up");
    expect(!!one(reasonOnly, "colony-send-text").disabled).toBe(false);
  });

  test("drafts survive a rebuild of the row", () => {
    const first = one(row(member({ name: "draft-keeper" })), "colony-send-text");
    expect(first.value).toBe("");
    first.value = "half typed";
    fire(first, "input");
    const again = one(row(member({ name: "draft-keeper" })), "colony-send-text");
    expect(again.value).toBe("half typed");
    expect(one(row(member({ name: "someone-else" })), "colony-send-text").value).toBe("");
    again.value = "";
    fire(again, "input");
    expect(one(row(member({ name: "draft-keeper" })), "colony-send-text").value).toBe("");
  });

  test("last sent message: body, age, and delivery text or status", () => {
    expect(byClass(row(member()), "colony-sent").length).toBe(0);
    const s = one(row(member({ last_sent: { body: "do it", ts: new Date(NOW - 120_000).toISOString(), status: "queued", delivery_text: "queued for next tool call" } })), "colony-sent");
    expect(s.attrs["data-status"]).toBe("queued");
    expect(s.attrs.title).toBe("do it");
    expect(s.children.map(txt)).toEqual(["You sent", "do it", "2m ago", "queued for next tool call"]);
    const bare = one(row(member({ last_sent: { body: "b", ts: new Date(NOW - 5000).toISOString(), status: "delivered" } })), "colony-sent");
    expect(txt(one(bare, "colony-sent-st"))).toBe("delivered");
  });
});

// =================================================================== sending
describe("sending a message", () => {
  const member = (name) => ({ name, kind: "worker", state: "running", steerable: true, tasks: [] });
  const setup = (name, refresh = () => {}, ctxOver = {}) => {
    const li = MemberRow(member(name), mkCtx(ctxOver), refresh);
    return { li, box: one(li, "colony-send-text"), send: btn(li, "Send") };
  };

  test("a blank message sends nothing", async () => {
    const posts = [];
    api.post = async (p, b) => { posts.push([p, b]); return {}; };
    const { box, send } = setup("blank-1");
    box.value = "   ";
    send.click(); await flush();
    expect(posts).toEqual([]);
  });

  test("Send posts the trimmed text with the project, clears the box and draft, toasts and refreshes", async () => {
    const posts = [];
    api.post = async (p, b) => { posts.push([p, b]); return { message: { delivery_text: "delivered at 12:00:00" } }; };
    let refreshed = 0;
    const { box, send } = setup("send-1", () => refreshed++, { params: { project: "/route" } });
    box.value = "  do the thing  ";
    fire(box, "input");
    send.click(); await flush();
    expect(posts).toEqual([["colony/send-1/send", { text: "do the thing", project: "/route" }]]);
    expect(box.value).toBe("");
    expect(refreshed).toBe(1);
    expect(txt(one(docBody, "toast"))).toContain("delivered at 12:00:00");
    expect(one(MemberRow(member("send-1"), mkCtx(), () => {}), "colony-send-text").value).toBe("");
    expect(!!send.disabled).toBe(false);
  });

  test("the toast says Delivered or Queued when the server sends no delivery text", async () => {
    api.post = async () => ({ delivered: true });
    const a = setup("toast-a");
    a.box.value = "x"; a.send.click(); await flush();
    expect(txt(one(docBody, "toast"))).toContain("Delivered to toast-a");
    api.post = async () => ({});
    const b = setup("toast-b");
    b.box.value = "x"; b.send.click(); await flush();
    expect(txt(byClass(docBody, "toast")[1])).toContain("Queued for toast-b");
  });

  test("Enter in the box sends; other keys do not", async () => {
    const posts = [];
    api.post = async (p, b) => { posts.push(b.text); return {}; };
    const { box } = setup("enter-1");
    box.value = "go";
    let prevented = 0;
    fire(box, "keydown", { key: "a", preventDefault: () => prevented++ });
    await flush();
    expect(posts).toEqual([]);
    fire(box, "keydown", { key: "Enter", preventDefault: () => prevented++ });
    await flush();
    expect(posts).toEqual(["go"]);
    expect(prevented).toBe(1);
  });

  test("a failed send keeps the draft, shows an error toast, does not refresh and re-enables Send", async () => {
    api.post = async () => { throw Object.assign(new Error("x"), { error: "member_dead", why: "it exited" }); };
    let refreshed = 0;
    const { box, send } = setup("fail-1", () => refreshed++);
    box.value = "keep";
    fire(box, "input");
    send.click(); await flush();
    expect(box.value).toBe("keep");
    expect(refreshed).toBe(0);
    expect(!!send.disabled).toBe(false);
    const t = one(docBody, "toast");
    expect(txt(t)).toContain("member_dead");
    expect(one(MemberRow(member("fail-1"), mkCtx(), () => {}), "colony-send-text").value).toBe("keep");
    box.value = ""; fire(box, "input");
  });

  test("a failure with no message falls back to 'Could not send to <name>'", async () => {
    api.post = async () => { throw {}; };
    const { box, send } = setup("fallback-1");
    box.value = "x";
    send.click(); await flush();
    expect(txt(one(docBody, "toast"))).toContain("Could not send to fallback-1");
    box.value = ""; fire(box, "input");
  });

  test("Send is disabled while the request is in flight", async () => {
    let release;
    api.post = () => new Promise((r) => { release = r; });
    const { box, send } = setup("busy-1");
    box.value = "x";
    send.click();
    await settle();
    expect(send.disabled).toBe(true);
    release({});
    await flush();
    expect(!!send.disabled).toBe(false);
  });
});

// =================================================================== all projects
describe("allProjects", () => {
  const snap = {
    colonies: [{ id: "c1", project: "/p/one", name: "crew", title: "Review", source: { label: "from claude" } }, { id: "c2", project: "/p/one", finished: true, task: "old task" }],
    seats: [
      { name: "lead-1", colony: "c1", role: "lead", state: "working", lead: true, address: "lead-1@c1" },
      { name: "impl-1", colony: "c1", role_title: "Implementer", role: "implementer", state: "blocked" },
      { name: "idle-1", colony: "c1", state: "idle" },
      { name: "done-1", colony: "c2", state: "finished" },
    ],
  };

  test("nothing running -> an empty state whose button opens the terminal", () => {
    const ctx = mkCtx();
    const st = allProjects({ colonies: [] }, ctx, () => {});
    expect(st.attrs.class).toContain("state-empty");
    expect(txt(st)).toContain("No live colonies in any project");
    expect(txt(st)).toContain("Start one from your agent and it appears here with its members.");
    btn(st, "Open terminal").click();
    expect(ctx.nav).toEqual([["terminal"]]);
    expect(allProjects(null, ctx, () => {}).attrs.class).toContain("state-empty");
  });

  test("groups per project with a card per colony: name, finished tag, title or task, source line", () => {
    const root = allProjects(snap, mkCtx(), () => {});
    expect(root.attrs.class).toBe("colony-all-projects");
    const group = one(root, "colony-group");
    expect(txt(byTag(group, "h2")[0])).toBe("one");
    expect(byTag(group, "h2")[0].attrs.title).toBe("/p/one");
    const cards = byClass(root, "colony-card");
    expect(cards.map((c) => c.attrs.class)).toEqual(["colony-card", "colony-card is-finished"]);
    const tops = cards.map((c) => c.children[0]);
    expect(txt(byTag(tops[0], "strong")[0])).toBe("crew");
    expect(byTag(tops[0], "strong")[0].attrs.title).toBe("c1");
    expect(byClass(tops[0], "tw-fin").length).toBe(0);
    expect(txt(byClass(tops[0], "dim")[0])).toBe("Review");
    expect(txt(byTag(tops[1], "strong")[0])).toBe("c2");
    expect(txt(one(tops[1], "tw-fin"))).toBe("finished");
    expect(txt(byClass(tops[1], "dim")[0])).toBe("old task");
    expect(txt(one(cards[0], "colony-source"))).toBe("from claude");
    expect(byClass(cards[1], "colony-source").length).toBe(0);
  });

  test("a seat row shows its address, role, state badge and terminal link with the project", () => {
    const ctx = mkCtx();
    const root = allProjects(snap, ctx, () => {});
    const card = byClass(root, "colony-card")[0];
    const seatRows = card.children.filter((c) => hasClass(c, "colony-top")).slice(1);
    expect(seatRows.length).toBe(3);
    const [lead, impl, idle] = seatRows;
    expect(txt(byClass(lead, "truncate")[0])).toBe("lead-1@c1");
    expect(byClass(lead, "truncate")[0].attrs.title).toBe("lead-1");
    expect(txt(one(lead, "chip-lite"))).toBe("lead");
    expect(txt(one(impl, "chip-lite"))).toBe("Implementer");
    expect(txt(one(idle, "chip-lite"))).toBe("worker");
    expect([lead, impl, idle].map((r) => { const b = one(r, "badge"); return [txt(b), b.attrs["data-state"]]; })).toEqual([["working", "working"], ["blocked", "input"], ["idle", "idle"]]);
    btn(impl, "Open terminal").click();
    expect(btn(impl, "Open terminal").attrs["aria-label"]).toBe("Open terminal for impl-1");
    expect(ctx.nav).toEqual([["terminal", { space: "c1", seat: "impl-1", project: "/p/one" }]]);
    btn(card.children[0], "Open terminal").click();
    expect(btn(card.children[0], "Open terminal").attrs["aria-label"]).toBe("Open terminal for crew");
    expect(ctx.nav[1]).toEqual(["terminal", { space: "c1", project: "/p/one" }]);
  });

  test("seat controls: the lead gets none; workers map snapshot states onto steerability and act on the seat's own project", async () => {
    const posts = [];
    rosterDeps.api = { post: async (p, b) => { posts.push([p, b]); } };
    rosterDeps.confirm = async () => true;
    let refreshed = 0;
    const root = allProjects(snap, mkCtx({ params: { project: "ignored" } }), () => refreshed++);
    const card = byClass(root, "colony-card")[0];
    const [lead, impl, idle] = card.children.filter((c) => hasClass(c, "colony-top")).slice(1);
    expect(labels(lead)).toEqual(["Open terminal"]);
    expect(labels(impl)).toEqual(["Open terminal", "Pause", "Cancel", "Stop"]);
    expect(labels(idle)).toEqual(["Open terminal", "Pause", "Cancel", "Stop"]);
    btn(impl, "Stop").click(); await flush();
    btn(impl, "Pause").click(); await flush();
    expect(posts).toEqual([["colony/impl-1/kill", { project: "/p/one" }], ["colony/impl-1/pause", { project: "/p/one" }]]);
    expect(refreshed).toBe(2);
    const finishedCard = byClass(root, "colony-card")[1];
    expect(labels(finishedCard.children.filter((c) => hasClass(c, "colony-top"))[1])).toEqual(["Open terminal"]);
    const paused = allProjects({ colonies: [{ id: "c", project: "/q" }], seats: [{ name: "w", colony: "c", state: "working", paused: true }, { name: "x", colony: "c", state: "unknown", canceled: true }] }, mkCtx(), () => {});
    const rows = byClass(paused, "colony-card")[0].children.filter((c) => hasClass(c, "colony-top")).slice(1);
    expect(labels(rows[0])).toEqual(["Open terminal", "Resume", "Cancel", "Stop"]);
    expect(labels(rows[1])).toEqual(["Open terminal", "Resume", "Stop"]);
    expect(txt(one(rows[1], "badge"))).toBe("unknown");
  });
});

// =================================================================== mountRoster
describe("mountRoster", () => {
  const MEMBERS = {
    channel: { name: "demo@main", lead: "lead-1", members: 2 },
    project: "/p",
    members: [
      { name: "lead-1", kind: "lead", state: "running", steerable: true },
      { name: "w-1", kind: "worker", state: "running", steerable: true },
      { name: "w-2", kind: "worker", state: "finished", exit_code: 0 },
      { name: "w-3", kind: "worker", state: "idle", steerable: true },
    ],
  };
  const ctxFor = (over = {}) => {
    const gets = [];
    const posts = [];
    const c = mkCtx({
      gets, posts,
      api: { get: async (p, q) => { gets.push([p, q]); if (over.get) return over.get(p, q); return p === "colony" ? MEMBERS : { colonies: [], seats: [] }; }, post: async () => ({}) },
      ...over.ctx,
    });
    return c;
  };
  const mount = async (over = {}, opts) => {
    const ctx = ctxFor(over);
    const host = new docBody.constructor("div");
    docBody.appendChild(host);
    const r = mountRoster(ctx, host, opts);
    rosters.push(r);
    await flush();
    return { ctx, host, r };
  };

  test("the toolbar: Show all panes, Pause/Resume/Cancel for all workers, Open terminal", async () => {
    const { host, ctx } = await mount();
    const bar = one(host, "colony-bar");
    const toggle = byTag(bar, "input")[0];
    expect(toggle.attrs.type).toBe("checkbox");
    expect(toggle.attrs.id).toBe("colony-all");
    expect(txt(one(bar, "colony-all"))).toContain("Show all panes");
    expect(one(bar, "colony-all").attrs.for).toBe("colony-all");
    expect(labels(bar)).toEqual(["Pause", "Resume", "Cancel", "Open terminal"]);
    expect(btn(bar, "Pause").attrs["aria-label"]).toBe("pause all workers");
    expect(btn(bar, "Cancel").attrs["aria-label"]).toBe("cancel all workers");
    expect(btn(bar, "Cancel").attrs.class).toContain("btn-danger");
    expect(btn(bar, "Pause").attrs.class).not.toContain("btn-danger");
    btn(bar, "Open terminal").click();
    expect(ctx.nav).toEqual([["terminal"]]);
  });

  test("loads the colony for the project, clearing any earlier fetch failure", async () => {
    const { ctx, host } = await mount();
    expect(ctx.gets).toEqual([["colony", { project: "/p", all: "" }]]);
    expect(fetchFailures()).toEqual([]);
    expect(byClass(host, "colony-row").length).toBe(4);
  });

  test("Show all panes refetches with all=1 and unticking drops it", async () => {
    const { ctx, host } = await mount();
    const toggle = byTag(host, "input")[0];
    toggle.checked = true; fire(toggle, "change", { target: toggle }); await flush();
    expect(ctx.gets[ctx.gets.length - 1]).toEqual(["colony", { project: "/p", all: "1" }]);
    toggle.checked = false; fire(toggle, "change", { target: toggle }); await flush();
    expect(ctx.gets[ctx.gets.length - 1]).toEqual(["colony", { project: "/p", all: "" }]);
  });

  test("renders the channel summary, the lead apart and the workers in a list", async () => {
    const { host } = await mount();
    const chan = one(host, "colony-chan");
    expect(txt(chan)).toBe("Current channel demo@main · lead lead-1 · 2 workers · project /p");
    expect(txt(one(host, "colony-intro"))).toContain("The colony is the lead agent plus the workers it dispatched");
    expect(txt(one(host, "colony-intro"))).toContain("running = working, idle = waiting for input");
    const lead = one(host, "colony-lead");
    expect(lead.attrs["aria-label"]).toBe("Lead");
    expect(byClass(lead, "colony-row").length).toBe(1);
    expect(txt(byTag(lead, "strong")[0])).toBe("lead-1");
    const workers = byTag(host, "ul").find((u) => u.attrs["aria-label"] === "Workers");
    expect(byClass(workers, "colony-row").map((r) => txt(byTag(r, "strong")[0]))).toEqual(["w-1", "w-2", "w-3"]);
  });

  test("a single worker reads '1 worker'; no channel says nobody can be messaged; no lead is called out", async () => {
    const one1 = { channel: { name: "d@m", lead: "L", members: 1 }, project: "/p", members: [{ name: "w", kind: "worker", state: "idle", steerable: true }] };
    const { host } = await mount({ get: () => one1 });
    expect(txt(one(host, "colony-chan"))).toBe("Current channel d@m · lead L · 1 worker · project /p");
    expect(byClass(host, "colony-lead").length).toBe(0);
    expect(txt(byClass(host, "dim").find((n) => /No lead is attached/.test(txt(n))))).toBe("No lead is attached to this project.");
    const noChan = await mount({ get: () => ({ members: [{ name: "w", kind: "worker", state: "idle", steerable: true }] }) });
    expect(byClass(noChan.host, "colony-chan").length).toBe(0);
    expect(txt(noChan.host)).toContain("No lead has opened a channel in this project yet, so nobody can be messaged here.");
  });

  test("no members -> intro plus an empty state that opens the terminal", async () => {
    const { host, ctx } = await mount({ get: () => ({ channel: { name: "d@m", lead: "L", members: 0 }, project: "/p", members: [] }) });
    const st = one(host, "state");
    expect(st.attrs.class).toContain("state-empty");
    expect(txt(st)).toContain("No colony members yet");
    expect(txt(st)).toContain("Turn on Show all panes to see every pane.");
    expect(byClass(host, "colony-intro").length).toBe(1);
    btn(st, "Open terminal").click();
    expect(ctx.nav).toEqual([["terminal"]]);
    const missing = await mount({ get: () => ({}) });
    expect(txt(one(missing.host, "state"))).toContain("No colony members yet");
  });

  test("shows a loading state first, then an error state with Retry when the fetch fails (and reports it)", async () => {
    const never = new Promise(() => {});
    const early = await mount({ get: () => never });
    expect(one(early.host, "state").attrs.class).toBe("state state-loading");
    let fail = true;
    const { host, ctx } = await mount({ get: () => { if (fail) throw new Error("colony down"); return MEMBERS; } });
    const st = one(host, "state");
    expect(st.attrs.class).toContain("state-error");
    expect(txt(st)).toContain("colony down");
    expect(fetchFailures().map((f) => [f.page, f.endpoint])).toEqual([["colony", "colony"]]);
    fail = false;
    btn(st, "Retry") ? btn(st, "Retry").click() : byTag(st, "button").find((b) => /retry/i.test(txt(b))).click();
    await flush();
    expect(byClass(host, "colony-row").length).toBe(4);
    expect(fetchFailures()).toEqual([]);
    expect(ctx.gets.length).toBe(2);
  });

  test("unchanged data does not rebuild rows; changed data does", async () => {
    let data = MEMBERS;
    const { host, r } = await mount({ get: () => data });
    const first = byClass(host, "colony-row")[0];
    await r.refresh();
    expect(byClass(host, "colony-row")[0]).toBe(first);
    data = { ...MEMBERS, members: [...MEMBERS.members, { name: "w-9", kind: "worker", state: "idle", steerable: true }] };
    await r.refresh();
    expect(byClass(host, "colony-row").length).toBe(5);
    expect(byClass(host, "colony-row")[0]).not.toBe(first);
  });

  test("onMembers receives the roster on change; it is not called for an empty/failed load", async () => {
    const seen = [];
    await mount({}, { onMembers: (m) => seen.push(m.map((x) => x.name)) });
    expect(seen).toEqual([["lead-1", "w-1", "w-2", "w-3"]]);
    const none = [];
    await mount({ get: () => ({ members: undefined }) }, { onMembers: (m) => none.push(m) });
    expect(none).toEqual([[]]);
    const failed = [];
    await mount({ get: () => { throw new Error("x"); } }, { onMembers: (m) => failed.push(m) });
    expect(failed).toEqual([]);
  });

  test("a refresh does not repaint while a send box has focus (the draft is left alone)", async () => {
    let data = MEMBERS;
    const { host, r } = await mount({ get: () => data });
    const first = byClass(host, "colony-row")[0];
    const realQuery = document.querySelector;
    document.querySelector = (sel) => (sel === ".colony-send-text:focus" ? {} : null);
    data = { ...MEMBERS, members: MEMBERS.members.slice(0, 2) };
    await r.refresh();
    expect(byClass(host, "colony-row")[0]).toBe(first);
    expect(byClass(host, "colony-row").length).toBe(4);
    document.querySelector = realQuery;
    data = { ...MEMBERS, members: MEMBERS.members.slice(0, 3) };
    await r.refresh();
    expect(byClass(host, "colony-row").length).toBe(3);
  });

  test("with no project selected the roster shows every live colony from the terminal snapshot", async () => {
    const snap = { colonies: [{ id: "c1", project: "/p/one" }], seats: [{ name: "w", colony: "c1", state: "working" }] };
    const { ctx, host, r } = await mount({ ctx: { project: "all" }, get: (p) => (p === "term/snapshot" ? snap : {}) });
    expect(ctx.gets).toEqual([["term/snapshot", { all: "1" }]]);
    expect(byClass(host, "colony-all-projects").length).toBe(1);
    expect(byClass(host, "colony-card").length).toBe(1);
    const card = byClass(host, "colony-card")[0];
    await r.refresh();
    expect(byClass(host, "colony-card")[0]).toBe(card);
    const empty = await mount({ ctx: { project: "" }, get: () => ({ colonies: [] }) });
    expect(txt(one(empty.host, "state"))).toContain("No live colonies in any project");
    const noProj = await mount({ ctx: { project: undefined }, get: () => ({ colonies: [] }) });
    expect(noProj.ctx.gets[0][0]).toBe("term/snapshot");
  });

  test("a failing snapshot in all-projects mode shows the error state; recovery repaints", async () => {
    let fail = true;
    const { host, r } = await mount({ ctx: { project: "all" }, get: () => { if (fail) throw new Error("snap down"); return { colonies: [{ id: "c1", project: "/p" }], seats: [] }; } });
    expect(txt(one(host, "state"))).toContain("snap down");
    await r.refresh();
    expect(byClass(host, "state-error").length).toBe(1);
    fail = false;
    await r.refresh();
    expect(byClass(host, "state-error").length).toBe(0);
    expect(byClass(host, "colony-card").length).toBe(1);
  });

  test("destroy stops later refreshes from touching the page", async () => {
    let data = MEMBERS;
    const { host, r, ctx } = await mount({ get: () => data });
    const calls = ctx.gets.length;
    r.destroy();
    data = { ...MEMBERS, members: [] };
    await r.refresh();
    expect(ctx.gets.length).toBe(calls);
    expect(byClass(host, "colony-row").length).toBe(4);
  });

  test("destroy during a fetch discards its answer", async () => {
    let release;
    const gate = new Promise((res) => { release = res; });
    const { host, r } = await mount({ get: async () => { await gate; return MEMBERS; } });
    r.destroy();
    release(); await flush();
    expect(byClass(host, "colony-row").length).toBe(0);
  });

  test("header Pause all / Cancel all act on every steerable worker, never the lead or finished ones", async () => {
    const posts = [];
    rosterDeps.api = { post: async (p, b) => { posts.push([p, b]); } };
    const asked = [];
    rosterDeps.confirm = async (o) => { asked.push(o.title); return true; };
    const { host } = await mount({ ctx: { params: { project: "/route" } } });
    btn(one(host, "colony-bar"), "Pause").click(); await flush();
    expect(posts).toEqual([["colony/w-1/pause", { project: "/route" }], ["colony/w-3/pause", { project: "/route" }]]);
    posts.length = 0;
    btn(one(host, "colony-bar"), "Cancel").click(); await flush();
    expect(asked).toEqual(["Cancel w-1?", "Cancel w-3?"]);
    expect(posts.map((p) => p[0])).toEqual(["colony/w-1/cancel", "colony/w-3/cancel"]);
    posts.length = 0;
    btn(one(host, "colony-bar"), "Resume").click(); await flush();
    expect(posts.map((p) => p[0])).toEqual(["colony/w-1/resume", "colony/w-3/resume"]);
  });
});

describe("waveAll", () => {
  test("returns how many workers it acted on and skips the lead and non-steerable members", async () => {
    const posts = [];
    rosterDeps.api = { post: async (p, b) => { posts.push([p, b]); } };
    const members = [{ name: "l", kind: "lead", state: "running" }, { name: "a", kind: "worker", state: "stuck" }, { name: "b", kind: "worker", state: "dead" }, { name: "c", kind: "worker", state: "parked" }];
    expect(await waveAll(mkCtx({ project: "/pp" }), "pause", members)).toBe(1);
    expect(posts).toEqual([["colony/a/pause", { project: "/pp" }]]);
    expect(await waveAll(mkCtx(), "pause", undefined)).toBe(0);
    expect(await waveAll(mkCtx(), "pause", [])).toBe(0);
  });

  test("acts on workers one after another, in roster order", async () => {
    const order = [];
    rosterDeps.api = { post: async (p) => { order.push(p + ":start"); await Promise.resolve(); order.push(p + ":end"); } };
    await waveAll(mkCtx(), "resume", [{ name: "a", kind: "worker", state: "idle" }, { name: "b", kind: "worker", state: "idle" }]);
    expect(order).toEqual(["colony/a/resume:start", "colony/a/resume:end", "colony/b/resume:start", "colony/b/resume:end"]);
  });
});
