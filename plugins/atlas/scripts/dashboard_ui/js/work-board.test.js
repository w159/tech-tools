import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { body, installDom, restoreDom } from "./operate-dom-stub.js";

installDom();
const first = (await import("./pages/work.js")).default;
restoreDom();

let seq = 0;
const fresh = async () => (await import("./pages/work.js?n=" + ++seq)).default;

// ---- selector support the shared stub lacks: comma lists, descendants, [attr] and [attr="v"] ----
function matchCompound(n, c) {
  if (!n.attrs) return false;
  let rest = c;
  const tm = /^[A-Za-z][\w-]*/.exec(rest);
  if (tm) { if (n.tag !== tm[0]) return false; rest = rest.slice(tm[0].length); }
  while (rest) {
    let m;
    if ((m = /^\.([\w-]+)/.exec(rest))) { if (!n.className.split(/\s+/).includes(m[1])) return false; }
    else if ((m = /^#([\w-]+)/.exec(rest))) { if (n.attrs.id !== m[1]) return false; }
    else if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) { if (!(m[1] in n.attrs)) return false; if (m[2] !== undefined && n.attrs[m[1]] !== m[2]) return false; }
    else return false;
    rest = rest.slice(m[0].length);
  }
  return true;
}
function matchChain(n, parts) {
  if (!matchCompound(n, parts[parts.length - 1])) return false;
  let at = n.parent;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    while (at && !matchCompound(at, parts[i])) at = at.parent;
    if (!at) return false;
    at = at.parent;
  }
  return true;
}
const chains = (sel) => String(sel).split(",").map((p) => p.trim().split(/\s+/));
let protoSaved;
const PKEYS = ["querySelectorAll", "matches", "closest"];
function patchProto() {
  const proto = Object.getPrototypeOf(document.createElement("div"));
  protoSaved = Object.fromEntries(PKEYS.map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)]));
  Object.defineProperties(proto, {
    querySelectorAll: { value(sel) { const cs = chains(sel); const out = []; const walk = (n) => n.children.forEach((c) => { if (c.attrs && cs.some((p) => matchChain(c, p))) out.push(c); walk(c); }); walk(this); return out; }, configurable: true, writable: true },
    matches: { value(sel) { return chains(sel).some((p) => matchChain(this, p)); }, configurable: true, writable: true },
    closest: { value(sel) { for (let n = this; n; n = n.parent) if (n.attrs && n.matches(sel)) return n; return null; }, configurable: true, writable: true },
  });
}
function unpatchProto() {
  const proto = Object.getPrototypeOf(document.createElement("div"));
  for (const k of PKEYS) { if (protoSaved[k]) Object.defineProperty(proto, k, protoSaved[k]); else delete proto[k]; }
}

let timers;
let saved;
let winListeners;
let docListeners;
function patchGlobals() {
  timers = { list: [], cleared: [] };
  saved = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, CSS: globalThis.CSS, location: globalThis.location, navigator: globalThis.navigator };
  globalThis.setTimeout = (fn, ms) => { timers.list.push({ fn, ms, id: timers.list.length + 1 }); return timers.list.length; };
  globalThis.clearTimeout = (id) => { timers.cleared.push(id); };
  globalThis.CSS = { escape: (s) => String(s) };
  winListeners = {};
  docListeners = { add: [], remove: [] };
  window.addEventListener = (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); };
  window.dispatchEvent = (e) => { (winListeners[e.type] || []).forEach((f) => f(e)); };
  document.addEventListener = (t, f) => { docListeners.add.push([t, f]); };
  document.removeEventListener = (t, f) => { docListeners.remove.push([t, f]); };
  document.querySelector = (s) => body.querySelector(s);
  document.querySelectorAll = (s) => body.querySelectorAll(s);
  document.activeElement = null;
  globalThis.navigator = {};
}
function unpatchGlobals() {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
}

const ISO = "2026-03-01T10:00:00Z";
const item = (id, content, status, over = {}) => ({ id, content, status, ...over });
const BOARD = () => ({
  phases: [
    { name: "Backlog", items: [item("t1", "Ship it", "open", { owner: "bob", updated: ISO }), item("t2", "Fix bug", "in_progress"), item("t3", "Done thing", "done"), item("t4", "Stuck", "blocked", { claimed_by: "amy" })] },
    { name: "Later", items: [] },
  ],
  counts: { open: 1, in_progress: 1, blocked: 1, done: 1 },
});

let calls;
let page;
let responses;
function mkCtx({ project = "/p", token = true, mode = "sse", board = BOARD(), post, store, prefs } = {}) {
  calls = { gets: [], posts: [] };
  responses = { board, post };
  return {
    project,
    params: {},
    store: store || { get: () => [] },
    prefs,
    api: {
      hasToken: token,
      mode,
      get: async (p, q) => { calls.gets.push([p, q]); const b = responses.board; if (b instanceof Error) throw b; return typeof b === "function" ? b(q) : b; },
      post: async (p, b) => { calls.posts.push([p, b]); const r = responses.post; if (r instanceof Error) throw r; return typeof r === "function" ? r(b) : r || { state: responses.board }; },
    },
  };
}
const mount = async (ctx) => {
  body.replaceChildren();
  const data = await page.load(ctx);
  const node = page.render(ctx, data);
  body.appendChild(node);
  return node;
};
const flush = async (n = 3) => { for (let i = 0; i < n; i += 1) await new Promise((r) => queueMicrotask(r)); await new Promise((r) => saved.setTimeout(r, 0)); };
const root = () => document.getElementById("work-root");
const all = (sel) => root().querySelectorAll(sel);
const one = (sel) => root().querySelector(sel);
const texts = (sel) => all(sel).map((n) => n.textContent);
const fire = (n, type, e) => { const ev = { preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...e }; (n.listeners[type] || []).forEach((f) => f(ev)); return ev; };
const btn = (label, within) => (within || root()).querySelectorAll("button").find((b) => b.textContent === label);
const cardOf = (text) => all("li.todo").find((li) => li.textContent.includes(text));
const runRefresh = async () => { timers.list.filter((t) => t.ms === 700).pop().fn(); await flush(); };
const toasts = () => body.querySelectorAll("div.toast").map((t) => t.textContent);

beforeEach(async () => {
  installDom();
  patchProto();
  patchGlobals();
  page = await fresh();
});
afterEach(() => {
  try { page.destroy(); } catch (_e) { /* a test may have destroyed it already */ }
  unpatchGlobals();
  unpatchProto();
  restoreDom();
});

describe("loading", () => {
  test("the first board is fetched for the sidebar project, then rendered with title and sub", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    expect(calls.gets).toEqual([["todos", { project: "/p" }]]);
    expect(one("h1").textContent).toBe("Work");
    expect(one("p.sub").textContent).toBe("Tasks by phase for this project.");
    expect(root().className).toBe("page");
    expect(page.id).toBe("work");
  });

  test("a failed first load shows the error state and Retry reloads the board", async () => {
    const ctx = mkCtx({ board: Object.assign(new Error("daemon down"), { error: "daemon down", why: "It is stopped", do: "Start it" }) });
    await mount(ctx);
    expect(one("h2.state-title").textContent).toBe("Daemon down");
    expect(root().textContent).toContain("It is stopped");
    expect(btn("Retry")).toBeDefined();
    responses.board = BOARD();
    btn("Retry").click();
    await flush();
    expect(texts("h2")).toContain("Backlog");
    expect(root().textContent).not.toContain("daemon down");
    expect(calls.gets.length).toBe(2);
  });

  test("a retry that fails again keeps the error state", async () => {
    const ctx = mkCtx({ board: Object.assign(new Error("x"), { error: "still down" }) });
    await mount(ctx);
    btn("Retry").click();
    await flush();
    expect(one("h2.state-title").textContent).toBe("Still down");
    expect(btn("Retry")).toBeDefined();
  });

  test("with no board loaded and no error the lens says the board is not loaded", async () => {
    const out = page.render(mkCtx());
    body.replaceChildren(out);
    expect(one("h2.state-title").textContent).toBe("Board not loaded");
  });

  test("load resolves to the board it fetched", async () => {
    const ctx = mkCtx();
    expect(await page.load(ctx)).toEqual(BOARD());
    page.destroy();
    page = await fresh();
    const failing = mkCtx({ board: new Error("x") });
    expect(await page.load(failing)).toBeNull();
  });

  test("loading registers pointer listeners and destroy removes the same ones", async () => {
    await mount(mkCtx());
    expect(docListeners.add.map((a) => a[0]).sort()).toEqual(["pointercancel", "pointerdown", "pointerup"]);
    page.destroy();
    expect(docListeners.remove.map((a) => a[0]).sort()).toEqual(["pointercancel", "pointerdown", "pointerup"]);
    for (const [t, f] of docListeners.remove) expect(docListeners.add.find((a) => a[0] === t)[1]).toBe(f);
  });

  test("load resets view state left over from an earlier visit", async () => {
    const ctx = mkCtx({ board: { phases: [{ name: "A", items: [item("x", "Old", "done")] }], counts: { done: 1 } } });
    await mount(ctx);
    btn("Archived").click();
    await flush();
    expect(btn("Archived").getAttribute("aria-pressed")).toBe("true");
    await mount(ctx);
    expect(btn("Archived").getAttribute("aria-pressed")).toBe("false");
    expect(calls.gets[calls.gets.length - 1][1].archived).toBeUndefined();
  });
});

describe("header and chips", () => {
  test("chips show the status counts; done is hidden by default; clicking toggles a status", async () => {
    await mount(mkCtx());
    const chips = all("div.page-actions button").filter((b) => b.getAttribute("aria-label"));
    expect(chips.map((b) => [b.textContent, b.getAttribute("aria-pressed"), b.getAttribute("aria-label"), b.className])).toEqual([
      ["open 1", "true", "Hide open tasks (1)", "btn btn-primary"],
      ["in progress 1", "true", "Hide in progress tasks (1)", "btn btn-primary"],
      ["blocked 1", "true", "Hide blocked tasks (1)", "btn btn-primary"],
      ["done 1", "false", "Show done tasks (1)", "btn"],
    ]);
    expect(texts("li.todo .todo-text-label")).toEqual(["Ship it", "Fix bug", "Stuck"]);
    btn("done 1").click();
    expect(texts("li.todo .todo-text-label")).toEqual(["Ship it", "Fix bug", "Done thing", "Stuck"]);
    expect(btn("done 1").getAttribute("aria-pressed")).toBe("true");
    btn("open 1").click();
    expect(texts("li.todo .todo-text-label")).toEqual(["Fix bug", "Done thing", "Stuck"]);
  });

  test("a status with no count has no chip", async () => {
    await mount(mkCtx({ board: { phases: [{ name: "A", items: [] }], counts: { open: 0 } } }));
    expect(all("div.page-actions button").filter((b) => b.getAttribute("aria-label")).map((b) => b.textContent)).toEqual(["open 0"]);
    await mount(mkCtx({ board: { phases: [{ name: "A", items: [] }] } }));
    expect(all("div.page-actions button").filter((b) => b.getAttribute("aria-label")).length).toBe(0);
  });

  test("Archived toggles to the archived list, fetching with archived=1 and back", async () => {
    const ctx = mkCtx({ board: (q) => (q.archived ? { phases: [{ name: "Old", items: [item("a1", "Gone", "done", { archived_reason: "stale", owner: "x" })] }], counts: {} } : BOARD()) });
    await mount(ctx);
    btn("Archived").click();
    await flush();
    expect(calls.gets[1]).toEqual(["todos", { project: "/p", archived: 1 }]);
    expect(one("p.sub").textContent).toBe("Archived tasks (stale or from ended sessions). Restore puts one back on the board.");
    expect(btn("Archived").getAttribute("aria-pressed")).toBe("true");
    expect(btn("Archived").className).toBe("btn btn-primary");
    expect(all("div.page-actions button").filter((b) => b.getAttribute("aria-label")).length).toBe(0);
    expect(texts("section.col h2")).toEqual(["Archived"]);
    expect(texts("section.col span.tag")).toEqual(["1", "stale", "x"]);
    expect(one("section.col").getAttribute("aria-label")).toBe("Archived");
    btn("Archived").click();
    await flush();
    expect(texts("section.col h2")).toEqual(["Backlog", "Later"]);
    expect(btn("Archived").getAttribute("aria-pressed")).toBe("false");
  });

  test("an archived list with no tasks says so; an empty archived board says nothing archived", async () => {
    const ctx = mkCtx({ board: (q) => (q.archived ? { phases: [{ name: "Old", items: [] }], counts: {} } : BOARD()) });
    await mount(ctx);
    btn("Archived").click();
    await flush();
    expect(texts("ul.col-body li")).toEqual(["Nothing archived."]);
    responses.board = (q) => (q.archived ? { phases: [], counts: {} } : BOARD());
    btn("Archived").click();
    await flush();
    btn("Archived").click();
    await flush();
    expect(root().textContent).toContain("Nothing archived");
    expect(root().textContent).toContain("Tasks that go stale are archived here and can be restored.");
    expect(one("form")).toBeNull();
  });

  test("if the archived list fails to load the toggle snaps back and an error is shown", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    responses.board = Object.assign(new Error("nope"), { error: "no archive" });
    btn("Archived").click();
    await flush();
    expect(btn("Archived").getAttribute("aria-pressed")).toBe("false");
    expect(toasts().join("|")).toContain("no archive");
    expect(texts("section.col h2")).toEqual(["Backlog", "Later"]);
  });

  test("in a single project archived cards do not name a project", async () => {
    const ctx = mkCtx({ board: (q) => (q.archived ? { phases: [{ name: "Old", items: [item("a1", "Gone", "done", { project: "/w/zed", archived_reason: "stale" })] }], counts: {} } : BOARD()) });
    await mount(ctx);
    btn("Archived").click();
    await flush();
    expect(texts("section.col span.tag")).toEqual(["1", "stale"]);
  });

  test("restoring an archived task posts a restore and toasts", async () => {
    const arch = { phases: [{ name: "Old", items: [item("a1", "Gone", "done")] }], counts: {} };
    const ctx = mkCtx({ board: (q) => (q.archived ? arch : BOARD()) });
    await mount(ctx);
    btn("Archived").click();
    await flush();
    btn("Restore").click();
    await flush();
    expect(calls.posts).toEqual([["todos", { project: "/p", op: "restore", id: "a1" }]]);
    expect(toasts().join("|")).toContain("Restored");
  });

  test("the all-projects view explains itself and loads every board", async () => {
    const ctx = mkCtx({ project: "all" });
    await mount(ctx);
    expect(calls.gets[0]).toEqual(["todos", { project: "all" }]);
    expect(one("p.sub").textContent).toBe("Every project's board, grouped by status. Each task is labelled with its project; pick a project in the sidebar to add, reorder or move tasks.");
    const noProject = mkCtx({ project: "" });
    await mount(noProject);
    expect(calls.gets[0]).toEqual(["todos", { project: "all" }]);
  });
});

describe("phase columns", () => {
  test("each phase is a column with its done tally and an add form", async () => {
    await mount(mkCtx());
    const cols = all("section.col");
    expect(cols.map((c) => c.getAttribute("aria-label"))).toEqual(["Phase Backlog", "Phase Later"]);
    expect(texts("section.col span.tag").filter((t) => /done/.test(t))).toEqual(["1/4 done", "0/0 done"]);
    expect(all("ul.col-body").map((u) => u.getAttribute("aria-label"))).toEqual(["Backlog", "Later"]);
    expect(all("form.add-form").length).toBe(2);
    expect(one("input[data-add-phase=\"Backlog\"]").getAttribute("placeholder")).toBe("Add a task to Backlog");
    expect(all("input[data-add-phase]").map((i) => i.getAttribute("data-add-phase"))).toEqual(["Backlog", "Later"]);
    expect(all("form.add-form input").map((i) => i.getAttribute("aria-label"))).toEqual(["New task in Backlog", "Owner for new task", "New task in Later", "Owner for new task"]);
  });

  test("empty columns and fully filtered columns say why", async () => {
    await mount(mkCtx({ board: { phases: [{ name: "Empty", items: [] }, { name: "Hidden", items: [item("h1", "a", "done"), item("h2", "b", "done")] }], counts: { done: 2 } } }));
    expect(all("ul.col-body").map((u) => u.textContent)).toEqual(["Nothing in this phase yet.", "Everything here is hidden by the status filter (2 hidden)."]);
  });

  test("a phase with no items key still renders", async () => {
    await mount(mkCtx({ board: { phases: [{ name: "Bare" }], counts: {} } }));
    expect(texts("section.col h2")).toEqual(["Bare"]);
    expect(texts("section.col span.tag")).toEqual(["0/0 done"]);
  });

  test("adding a task posts the trimmed text with the optional owner for that phase", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    const form = all("form.add-form")[1];
    const [input, owner] = form.querySelectorAll("input");
    input.value = "  New thing ";
    owner.value = " zed ";
    fire(form, "submit");
    await flush();
    expect(calls.posts).toEqual([["todos", { project: "/p", op: "add", content: "New thing", phase: "Later", owner: "zed" }]]);
    expect(toasts().join("|")).toContain("Added");
    expect(timers.list.some((t) => t.ms === 1800)).toBe(true);
  });

  test("adding without an owner omits it; blank text posts nothing and refocuses", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    const form = all("form.add-form")[0];
    const [input, owner] = form.querySelectorAll("input");
    owner.value = "";
    let focused = 0;
    input.focus = () => { focused += 1; };
    input.value = "   ";
    const ev = fire(form, "submit");
    await flush();
    expect(ev.prevented).toBe(true);
    expect(focused).toBe(1);
    expect(calls.posts).toEqual([]);
    input.value = "Real";
    fire(form, "submit");
    await flush();
    expect(calls.posts).toEqual([["todos", { project: "/p", op: "add", content: "Real", phase: "Backlog" }]]);
  });

  test("after a successful add the phase's input is focused again", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    const proto = Object.getPrototypeOf(root());
    const savedFocus = proto.focus;
    const focused = [];
    proto.focus = function () { focused.push(this.attrs["data-add-phase"]); };
    try {
      const form = all("form.add-form")[1];
      const [input, owner] = form.querySelectorAll("input");
      input.value = "More";
      owner.value = "";
      fire(form, "submit");
      await flush();
    } finally {
      proto.focus = savedFocus;
    }
    expect(focused).toEqual(["Later"]);
  });

  test("a failed add does not move focus", async () => {
    const ctx = mkCtx({ post: Object.assign(new Error("x"), { error: "boom" }) });
    await mount(ctx);
    const proto = Object.getPrototypeOf(root());
    const savedFocus = proto.focus;
    let focused = 0;
    proto.focus = function () { focused += 1; };
    try {
      const form = all("form.add-form")[0];
      const [input, owner] = form.querySelectorAll("input");
      input.value = "More";
      owner.value = "";
      fire(form, "submit");
      await flush();
    } finally {
      proto.focus = savedFocus;
    }
    expect(focused).toBe(0);
  });

  test("the add button is labelled for its phase", async () => {
    await mount(mkCtx());
    expect(all("form.add-form button").map((b) => [b.getAttribute("type"), b.getAttribute("aria-label")])).toEqual([["submit", "Add task to Backlog"], ["submit", "Add task to Later"]]);
  });
});

describe("task cards", () => {
  test("a card shows its text, status, owner or unassigned, age and the sr-only hint", async () => {
    await mount(mkCtx());
    const c = cardOf("Ship it");
    expect(c.getAttribute("data-status")).toBe("open");
    expect(c.getAttribute("draggable")).toBe("true");
    expect(c.querySelector("button.todo-text").getAttribute("data-focus-key")).toBe("edit-t1");
    expect(c.querySelector("span.sr-only").textContent).toBe(", open, press to edit");
    expect(c.querySelector("div.todo-meta span.tag").textContent).toBe("bob");
    expect(c.querySelector("div.todo-meta").textContent).toMatch(/ago/);
    expect(cardOf("Fix bug").querySelector("span.dim").textContent).toBe("unassigned");
    expect(cardOf("Fix bug").querySelector("div.todo-meta").textContent).not.toMatch(/ago/);
    expect(cardOf("Stuck").querySelector("div.todo-meta span.tag").textContent).toBe("amy");
    expect(cardOf("Fix bug").querySelector("span.sr-only").textContent).toBe(", in progress, press to edit");
    expect(c.querySelector("span.drag-handle")).not.toBeNull();
  });

  test("the status select lists all four statuses with the current one chosen", async () => {
    await mount(mkCtx());
    const sel = cardOf("Fix bug").querySelector("select");
    expect(sel.getAttribute("data-focus-key")).toBe("st-t2");
    expect(sel.querySelectorAll("option").map((o) => [o.value, o.textContent, Boolean(o.selected)])).toEqual([["open", "open", false], ["in_progress", "in progress", true], ["blocked", "blocked", false], ["done", "done", false]]);
    expect(cardOf("Fix bug").querySelector("label span.sr-only").textContent).toBe("Status of Fix bug");
  });

  test("changing the status posts that op for that task", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    fire(cardOf("Fix bug").querySelector("select"), "change", { target: { value: "blocked" } });
    await flush();
    expect(calls.posts).toEqual([["todos", { project: "/p", op: "status", id: "t2", status: "blocked" }]]);
  });

  test("Start appears for open tasks only, marks the task launching, posts start and toasts", async () => {
    const ctx = mkCtx({ post: (b) => ({ state: BOARD(), launch: { target: "sess:1" } }) });
    await mount(ctx);
    btn("done 1").click();
    expect(btn("Start", cardOf("Fix bug"))).toBeUndefined();
    expect(btn("Start", cardOf("Done thing"))).toBeUndefined();
    expect(btn("Start", cardOf("Stuck"))).toBeUndefined();
    const start = btn("Start", cardOf("Ship it"));
    expect(start.getAttribute("title")).toBe("Start a background tmux session for this task");
    start.click();
    await flush();
    expect(calls.posts).toEqual([["todos", { project: "/p", op: "start", id: "t1" }]]);
    expect(toasts().join("|")).toContain("Session started");
    expect(cardOf("Ship it").querySelector("div.todo-launch code").textContent).toBe("sess:1");
  });

  test("while a start is in flight the button reads Starting and is disabled", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const board = { phases: [{ name: "A", items: [item("p1", "Pend", "open")] }], counts: { open: 1 } };
    const ctx = mkCtx({ board, post: async () => { await gate; return { state: board }; } });
    await mount(ctx);
    expect(btn("Start", cardOf("Pend")).disabled).toBeFalsy();
    btn("Start", cardOf("Pend")).click();
    await flush();
    const b = btn("Starting…", cardOf("Pend"));
    expect(b.disabled).toBe(true);
    release();
    await flush();
    expect(btn("Start", cardOf("Pend")).disabled).toBeFalsy();
  });

  test("Claim (me) appears only for unowned tasks and posts a human claim", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    expect(btn("Claim (me)", cardOf("Ship it"))).toBeUndefined();
    expect(btn("Claim (me)", cardOf("Stuck"))).toBeUndefined();
    btn("Claim (me)", cardOf("Fix bug")).click();
    await flush();
    expect(calls.posts).toEqual([["todos", { project: "/p", op: "claim", id: "t2", owner: "human" }]]);
    expect(toasts().join("|")).toContain("Claimed");
  });

  test("Remove asks first and removes only on confirm", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    btn("Remove", cardOf("Fix bug")).click();
    await flush();
    expect(body.textContent).toContain("Remove this task?");
    expect(body.textContent).toContain("Fix bug");
    expect(body.querySelectorAll("div.modal-actions button").map((b) => [b.textContent, b.className])).toEqual([["Cancel", "btn"], ["Remove", "btn btn-danger"]]);
    btn("Cancel", body).click();
    await flush();
    expect(calls.posts).toEqual([]);
    btn("Remove", cardOf("Fix bug")).click();
    await flush();
    const modalButtons = body.querySelectorAll("div.modal-actions button");
    modalButtons.find((b) => b.textContent === "Remove").click();
    await flush();
    expect(calls.posts).toEqual([["todos", { project: "/p", op: "remove", id: "t2" }]]);
    expect(toasts().join("|")).toContain("Removed");
  });

  test("move up and down reorder within the phase; the ends are disabled", async () => {
    const ctx = mkCtx({ board: { phases: [{ name: "A", items: [item("a", "One", "open"), item("b", "Two", "open"), item("c", "Three", "open")] }], counts: { open: 3 } } });
    await mount(ctx);
    const up = (t) => cardOf(t).querySelectorAll("button").find((b) => b.getAttribute("aria-label") === "Move up");
    const down = (t) => cardOf(t).querySelectorAll("button").find((b) => b.getAttribute("aria-label") === "Move down");
    expect([up("One").disabled, down("One").disabled, up("Two").disabled, down("Two").disabled, up("Three").disabled, down("Three").disabled].map(Boolean)).toEqual([true, false, false, false, false, true]);
    up("Two").click();
    await flush();
    down("Two").click();
    await flush();
    up("One").click();
    down("Three").click();
    await flush();
    expect(calls.posts.map((p) => p[1])).toEqual([{ project: "/p", op: "reorder", phase: "A", ids: ["b", "a", "c"] }, { project: "/p", op: "reorder", phase: "A", ids: ["a", "c", "b"] }]);
  });

  test("reorder uses the position in the whole phase even when done tasks are hidden", async () => {
    const ctx = mkCtx({ board: { phases: [{ name: "A", items: [item("a", "One", "open"), item("d", "Gone", "done"), item("b", "Two", "open")] }], counts: { open: 2, done: 1 } } });
    await mount(ctx);
    cardOf("Two").querySelectorAll("button").find((b) => b.getAttribute("aria-label") === "Move up").click();
    await flush();
    expect(calls.posts[0][1].ids).toEqual(["a", "b", "d"]);
  });

  test("Edit swaps the card for an edit form; Cancel and Escape put the card back", async () => {
    await mount(mkCtx());
    btn("Edit", cardOf("Fix bug")).click();
    expect(one("form.edit-form")).not.toBeNull();
    expect(one("form.edit-form textarea").value).toBe("Fix bug");
    btn("Cancel").click();
    expect(one("form.edit-form")).toBeNull();
    cardOf("Fix bug").querySelector("button.todo-text").click();
    expect(one("form.edit-form")).not.toBeNull();
    const ev = fire(one("form.edit-form"), "keydown", { key: "Enter" });
    expect(ev.stopped).toBeUndefined();
    expect(one("form.edit-form")).not.toBeNull();
    const esc = fire(one("form.edit-form"), "keydown", { key: "Escape" });
    expect(esc.stopped).toBe(true);
    expect(one("form.edit-form")).toBeNull();
  });
});

describe("launch results", () => {
  test("a started session shows its target, a live dot and a copy-attach button", async () => {
    const board = { phases: [{ name: "A", items: [item("a", "Run", "in_progress", { launch: { target: "sess:9", ok: true }, live: true }), item("b", "Idle", "in_progress", { launch: { target: "sess:8", attach: "attach me" } })] }], counts: { in_progress: 2 } };
    await mount(mkCtx({ board }));
    const a = cardOf("Run").querySelector("div.todo-launch");
    expect(a.getAttribute("role")).toBe("status");
    expect(a.querySelector("code").textContent).toBe("sess:9");
    expect(a.querySelector("span.live-dot").getAttribute("data-live")).toBe("true");
    expect(a.querySelector("span.live-dot").getAttribute("title")).toBe("Session is running");
    expect(a.querySelector("button").getAttribute("title")).toBe("tmux attach -t sess:9");
    const b = cardOf("Idle").querySelector("div.todo-launch");
    expect(b.querySelector("span.live-dot").getAttribute("data-live")).toBe("false");
    expect(b.querySelector("span.live-dot").getAttribute("title")).toBe("Session is not running");
    expect(b.querySelector("button").getAttribute("title")).toBe("attach me");
  });

  test("a task's launch without a target or marked failed is not shown as a session", async () => {
    const board = { phases: [{ name: "A", items: [item("a", "NoTarget", "open", { launch: { ok: true } }), item("b", "Failed", "open", { launch: { target: "x", ok: false } })] }], counts: { open: 2 } };
    await mount(mkCtx({ board }));
    expect(one("div.todo-launch")).toBeNull();
  });

  test("Copy attach command copies to the clipboard and says Copied; without a clipboard it shows the text", async () => {
    const board = { phases: [{ name: "A", items: [item("a", "Run", "in_progress", { launch: { target: "sess:9" } })] }], counts: { in_progress: 1 } };
    await mount(mkCtx({ board }));
    const copied = [];
    globalThis.navigator = { clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } };
    btn("Copy attach command").click();
    await flush();
    expect(copied).toEqual(["tmux attach -t sess:9"]);
    expect(toasts().join("|")).toContain("Copied");
    expect(timers.list.some((t) => t.ms === 1500)).toBe(true);
    globalThis.navigator = {};
    btn("Copy attach command").click();
    expect(toasts().join("|")).toContain("tmux attach -t sess:9");
    expect(timers.list.filter((t) => t.ms === 9000).length).toBe(1);
  });

  test("a clipboard that refuses falls back to showing the text", async () => {
    const board = { phases: [{ name: "A", items: [item("a", "Run", "in_progress", { launch: { target: "s" } })] }], counts: { in_progress: 1 } };
    await mount(mkCtx({ board }));
    globalThis.navigator = { clipboard: { writeText: () => Promise.reject(new Error("denied")) } };
    btn("Copy attach command").click();
    await flush();
    expect(toasts().join("|")).toContain("tmux attach -t s");
    expect(timers.list.filter((t) => t.ms === 9000).length).toBe(1);
  });

  test("a launch that fails shows the reason and a copyable command", async () => {
    const ctx = mkCtx({ post: Object.assign(new Error("x"), { error: "launch_failed", data: { reason: "no tmux", command: "tmux new -s x" } }) });
    await mount(ctx);
    btn("Start", cardOf("Ship it")).click();
    await flush();
    const f = cardOf("Ship it").querySelector("div.todo-launch");
    expect(f.className).toBe("todo-launch is-fail");
    expect(f.querySelector("span").textContent).toBe("Launch failed: no tmux");
    expect(f.querySelector("code").textContent).toBe("tmux new -s x");
    expect(toasts().join("|")).toContain("launch_failed");
    const copied = [];
    globalThis.navigator = { clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } };
    btn("Copy command").click();
    expect(copied).toEqual(["tmux new -s x"]);
  });

  test("a launch failure with no detail still says it failed and offers no command", async () => {
    const ctx = mkCtx({ post: Object.assign(new Error("x"), { error: "launch_failed", why: "because" }) });
    await mount(ctx);
    btn("Start", cardOf("Ship it")).click();
    await flush();
    const f = cardOf("Ship it").querySelector("div.todo-launch");
    expect(f.querySelector("span").textContent).toBe("Launch failed: because");
    expect(f.querySelector("code")).toBeNull();
    expect(btn("Copy command")).toBeUndefined();
    const bare = mkCtx({ post: Object.assign(new Error("x"), { error: "launch_failed" }) });
    await mount(bare);
    btn("Start", cardOf("Ship it")).click();
    await flush();
    expect(cardOf("Ship it").querySelector("div.todo-launch span").textContent).toBe("Launch failed");
  });
});

describe("saving an edit", () => {
  const edit = async (text, opts = {}) => {
    const ctx = mkCtx(opts);
    await mount(ctx);
    btn("Edit", cardOf(text)).click();
    const form = one("form.edit-form");
    form.querySelector("select").value = "Backlog";
    return { ctx, form, content: form.querySelector("textarea"), owner: form.querySelector("input[type=text]") || form.querySelectorAll("input")[0], phase: form.querySelector("select"), launch: form.querySelectorAll("input").find((i) => i.getAttribute("type") === "checkbox") };
  };

  test("the form offers text, phase, owner and a start-session box that is on", async () => {
    const f = await edit("Ship it");
    expect(f.content.getAttribute("aria-label")).toBe("Task text");
    expect(f.owner.value).toBe("bob");
    expect(f.owner.getAttribute("aria-label")).toBe("Owner");
    expect(f.phase.querySelectorAll("option").map((o) => [o.textContent, Boolean(o.selected)])).toEqual([["Backlog", true], ["Later", false]]);
    expect(f.launch.checked).toBe(true);
    expect(f.form.textContent).toContain("Start a session now (when an owner is set)");
  });

  test("changing the text posts an update and toasts Saved", async () => {
    const f = await edit("Fix bug");
    f.content.value = "  Fix the bug ";
    const ev = fire(f.form, "submit");
    expect(ev.prevented).toBe(true);
    await flush();
    expect(calls.posts).toEqual([["todos", { project: "/p", op: "update", id: "t2", content: "Fix the bug" }]]);
    expect("phase" in calls.posts[0][1]).toBe(false);
    expect(toasts().join("|")).toContain("Saved");
    expect(timers.list.some((t) => t.ms === 1800)).toBe(true);
    expect(one("form.edit-form")).toBeNull();
  });

  test("moving to another phase posts the new phase", async () => {
    const f = await edit("Fix bug");
    f.phase.value = "Later";
    fire(f.form, "submit");
    await flush();
    expect(calls.posts[0][1]).toEqual({ project: "/p", op: "update", id: "t2", phase: "Later" });
  });

  test("a new owner posts an assign that starts a session when the box is ticked, and not otherwise", async () => {
    const f = await edit("Fix bug");
    f.owner.value = " zed ";
    fire(f.form, "submit");
    await flush();
    expect(calls.posts).toEqual([["todos", { project: "/p", op: "assign", id: "t2", owner: "zed", launch: true }]]);
    expect(toasts().join("|")).toContain("Saved");
    const g = await edit("Fix bug");
    g.owner.value = "zed";
    g.launch.checked = false;
    fire(g.form, "submit");
    await flush();
    expect(calls.posts).toEqual([["todos", { project: "/p", op: "assign", id: "t2", owner: "zed" }]]);
  });

  test("clearing the owner unassigns without launching", async () => {
    const f = await edit("Ship it");
    f.owner.value = "  ";
    fire(f.form, "submit");
    await flush();
    expect(calls.posts).toEqual([["todos", { project: "/p", op: "assign", id: "t1", owner: "" }]]);
  });

  test("text and owner both changed: update first, then assign", async () => {
    const f = await edit("Ship it");
    f.content.value = "Ship it now";
    f.owner.value = "amy";
    fire(f.form, "submit");
    await flush();
    expect(calls.posts.map((p) => p[1].op)).toEqual(["update", "assign"]);
  });

  test("a failed update does not go on to assign", async () => {
    const f = await edit("Ship it", { post: Object.assign(new Error("x"), { error: "boom" }) });
    f.content.value = "Changed";
    f.owner.value = "amy";
    fire(f.form, "submit");
    await flush();
    expect(calls.posts.map((p) => p[1].op)).toEqual(["update"]);
    expect(toasts().join("|")).toContain("boom");
  });

  test("saving with nothing changed just closes the form", async () => {
    const f = await edit("Ship it");
    fire(f.form, "submit");
    await flush();
    expect(calls.posts).toEqual([]);
    expect(one("form.edit-form")).toBeNull();
    expect(toasts().join("|")).not.toContain("Saved");
  });

  test("blank text stays in the form and posts nothing", async () => {
    const f = await edit("Ship it");
    let focused = 0;
    f.content.focus = () => { focused += 1; };
    f.content.value = "   ";
    fire(f.form, "submit");
    await flush();
    expect(calls.posts).toEqual([]);
    expect(one("form.edit-form")).not.toBeNull();
    expect(focused).toBe(1);
  });
});

describe("mutation outcomes", () => {
  test("a successful post adopts the returned board without another fetch", async () => {
    const after = { phases: [{ name: "Backlog", items: [item("n1", "Brand new", "open")] }], counts: { open: 1 } };
    const ctx = mkCtx({ post: () => ({ state: after }) });
    await mount(ctx);
    btn("Claim (me)", cardOf("Fix bug")).click();
    await flush();
    expect(calls.gets.length).toBe(1);
    expect(texts("li.todo .todo-text-label")).toEqual(["Brand new"]);
    expect(one("div.todo-launch")).toBeNull();
  });

  test("a reply without a board triggers a fresh fetch", async () => {
    const ctx = mkCtx({ post: () => ({}) });
    await mount(ctx);
    btn("Claim (me)", cardOf("Fix bug")).click();
    await flush();
    expect(calls.gets.length).toBe(2);
    const noPhases = mkCtx({ post: () => ({ state: {} }) });
    await mount(noPhases);
    btn("Claim (me)", cardOf("Fix bug")).click();
    await flush();
    expect(calls.gets.length).toBe(2);
  });

  test("a failure toasts the error, refetches and repaints", async () => {
    const ctx = mkCtx({ post: Object.assign(new Error("x"), { error: "conflict", why: "Changed elsewhere" }) });
    await mount(ctx);
    btn("Claim (me)", cardOf("Fix bug")).click();
    await flush();
    expect(toasts().join("|")).toContain("conflict");
    expect(toasts().join("|")).toContain("Changed elsewhere");
    expect(one("div.todo-launch")).toBeNull();
    expect(calls.gets.length).toBe(2);
    const plain = mkCtx({ post: new Error("") });
    await mount(plain);
    btn("Claim (me)", cardOf("Fix bug")).click();
    await flush();
    expect(toasts().join("|")).toContain("Could not update the task");
  });

  test("a refetch that also fails after a failed post is swallowed", async () => {
    const ctx = mkCtx({ post: Object.assign(new Error("x"), { error: "conflict" }) });
    await mount(ctx);
    responses.board = new Error("down");
    btn("Claim (me)", cardOf("Fix bug")).click();
    await flush();
    expect(texts("li.todo .todo-text-label").length).toBeGreaterThan(0);
  });

  test("a 401 or bad token disables editing with a banner until reload", async () => {
    for (const err of [Object.assign(new Error("x"), { status: 401 }), Object.assign(new Error("x"), { error: "bad_token" })]) {
      const ctx = mkCtx({ post: err });
      await mount(ctx);
      expect(one("div.work-banner")).toBeNull();
      btn("Claim (me)", cardOf("Fix bug")).click();
      await flush();
      const banner = one("div.work-banner");
      expect(banner.getAttribute("role")).toBe("alert");
      expect(banner.querySelector("span").textContent).toBe("The dashboard rejected this page's API token, so edits are disabled.");
      expect(all(".board button").every((b) => b.disabled)).toBe(true);
      expect(all("[draggable]").every((n) => n.getAttribute("draggable") === "false")).toBe(true);
    }
  });

  test("other failures leave editing on", async () => {
    const ctx = mkCtx({ post: Object.assign(new Error("x"), { status: 500, error: "server" }) });
    await mount(ctx);
    btn("Claim (me)", cardOf("Fix bug")).click();
    await flush();
    expect(one("div.work-banner")).toBeNull();
  });

  test("with no API token the board is read only and says so; Reload page reloads", async () => {
    const ctx = mkCtx({ token: false });
    await mount(ctx);
    expect(one("div.work-banner span").textContent).toBe("This page has no API token, so edits are disabled.");
    expect(all(".board button, .board select, .board input, .board textarea").every((n) => n.disabled)).toBe(true);
    expect(all("[draggable]").every((n) => n.getAttribute("draggable") === "false")).toBe(true);
    let reloaded = 0;
    globalThis.location = { reload: () => { reloaded += 1; } };
    btn("Reload page").click();
    expect(reloaded).toBe(1);
  });

  test("with a token and no failure nothing is disabled", async () => {
    await mount(mkCtx());
    expect(all(".board button").some((b) => b.disabled)).toBe(true); // the first Move up only
    expect(all(".board select").every((s) => !s.disabled)).toBe(true);
    expect(cardOf("Ship it").getAttribute("draggable")).toBe("true");
  });

  test("the empty-board form is disabled when locked", async () => {
    await mount(mkCtx({ token: false, board: { phases: [], counts: {} } }));
    expect(all(".empty button, .empty input").every((n) => n.disabled)).toBe(true);
  });
});

describe("empty board", () => {
  test("the first task goes into Backlog", async () => {
    const ctx = mkCtx({ board: { phases: [], counts: {} } });
    await mount(ctx);
    expect(root().textContent).toContain("No tasks yet");
    expect(root().textContent).toContain("Add the first task to start a board. Agents add their own as they plan; everything lands here under its phase.");
    const form = one("form");
    const input = form.querySelector("input");
    expect(input.getAttribute("aria-label")).toBe("First task");
    input.value = "  First ";
    const ev = fire(form, "submit");
    await flush();
    expect(ev.prevented).toBe(true);
    expect(calls.posts).toEqual([["todos", { project: "/p", op: "add", content: "First", phase: "Backlog" }]]);
    input.value = "   ";
    fire(form, "submit");
    await flush();
    expect(calls.posts.length).toBe(1);
  });
});

describe("all projects view", () => {
  const MERGED = () => ({
    phases: [
      { name: "A", items: [item("a1", "Alpha", "open", { project: "/work/alpha", phase: "A" }), item("a2", "Beta", "done", { project: "/work/beta" })] },
      { name: "B", items: [item("b1", "Gamma", "in_progress", { project: "/work/gamma/" }), item("b2", "Delta", "blocked")] },
    ],
    counts: { open: 1, in_progress: 1, blocked: 1, done: 1 },
  });

  test("tasks are grouped into status columns, all statuses shown, each labelled with its project", async () => {
    await mount(mkCtx({ project: "all", board: MERGED() }));
    expect(all("section.col").map((c) => c.getAttribute("aria-label"))).toEqual(["Status open", "Status in progress", "Status blocked"]);
    btn("done 1").click();
    expect(all("section.col").map((c) => c.getAttribute("aria-label"))).toEqual(["Status open", "Status in progress", "Status blocked", "Status done"]);
    expect(texts("section.col h2")).toEqual(["open", "in progress", "blocked", "done"]);
    expect(texts("section.col span.tag").filter((t) => /^\d+$/.test(t))).toEqual(["1", "1", "1", "1"]);
    expect(cardOf("Alpha").querySelector("span.tag[data-project]").textContent).toBe("alpha");
    expect(cardOf("Alpha").querySelector("span.tag[data-project]").getAttribute("title")).toBe("/work/alpha");
    expect(cardOf("Gamma").querySelector("span.tag[data-project]").textContent).toBe("gamma");
    expect(cardOf("Delta").querySelector("div.todo-meta span.tag").textContent).toBe("unknown");
    expect(cardOf("Beta").querySelector("span.tag[data-project]").textContent).toBe("beta");
  });

  test("the merged view has no add forms, drag handles or reorder buttons, and cards are not draggable", async () => {
    await mount(mkCtx({ project: "all", board: MERGED() }));
    expect(all("form.add-form").length).toBe(0);
    expect(all("span.drag-handle").length).toBe(0);
    expect(cardOf("Alpha").getAttribute("draggable")).toBe("false");
    expect(cardOf("Alpha").querySelectorAll("button").map((b) => b.getAttribute("aria-label")).filter(Boolean)).toEqual([]);
  });

  test("an empty status column explains itself; the chip filter does not apply", async () => {
    await mount(mkCtx({ project: "all", board: { phases: [{ name: "A", items: [item("a1", "Alpha", "open", { project: "/x/y" })] }], counts: { open: 1, done: 0 } } }));
    expect(all("ul.col-body").map((u) => u.textContent.includes("No tasks with this status."))).toEqual([false, true, true]);
    await mount(mkCtx({ project: "all", board: MERGED() }));
    expect(texts("li.todo .todo-text-label").sort()).toEqual(["Alpha", "Delta", "Gamma"]);
    btn("done 1").click();
    expect(texts("li.todo .todo-text-label").sort()).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
  });

  test("writes aim at the task's own project", async () => {
    const ctx = mkCtx({ project: "all", board: MERGED(), store: { get: () => [{ root: "/pref" }] }, prefs: { default_project: "/pref" } });
    await mount(ctx);
    fire(cardOf("Alpha").querySelector("select"), "change", { target: { value: "done" } });
    await flush();
    btn("Start", cardOf("Alpha")).click();
    await flush();
    btn("Claim (me)", cardOf("Alpha")).click();
    await flush();
    expect(calls.posts.map((p) => p[1])).toEqual([
      { project: "/work/alpha", op: "status", id: "a1", status: "done" },
      { project: "/work/alpha", op: "start", id: "a1" },
      { project: "/work/alpha", op: "claim", id: "a1", owner: "human" },
    ]);
  });

  test("a task without a project falls back to the default project, then the busiest", async () => {
    const proj = (prefs, projects) => mkCtx({ project: "all", board: MERGED(), store: { get: (k) => (k === "projects" ? projects : []) }, prefs });
    const run = async (ctx) => {
      await mount(ctx);
      btn("Claim (me)", cardOf("Delta")).click();
      await flush();
      return calls.posts[0][1].project;
    };
    const projects = [{ root: "/a", todos: { open: 1 } }, { root: "/b", todos: { open: 5 } }, { root: "/c" }, null, { todos: { open: 99 } }];
    expect(await run(proj({ default_project: "/a" }, projects))).toBe("/a");
    expect(await run(proj({ default_project: "/missing" }, projects))).toBe("/b");
    expect(await run(proj({ default_project: "all" }, projects))).toBe("/b");
    expect(await run(proj(undefined, projects))).toBe("/b");
    expect(await run(proj(undefined, []))).toBeUndefined();
    const three = [{ root: "/x", todos: { open: 5 } }, { root: "/y", todos: { open: 1 } }, { root: "/z", todos: { open: 3 } }];
    expect(await run(proj(undefined, three))).toBe("/x");
    expect(await run(proj(undefined, [{ root: "/q" }, { root: "/r", todos: { open: 1 } }]))).toBe("/r");
  });

  test("a merged post refetches all boards instead of adopting the reply", async () => {
    const ctx = mkCtx({ project: "all", board: MERGED(), post: () => ({ state: { phases: [{ name: "X", items: [] }], counts: {} } }) });
    await mount(ctx);
    btn("Claim (me)", cardOf("Delta")).click();
    await flush();
    expect(calls.gets.length).toBe(2);
    expect(calls.gets[1]).toEqual(["todos", { project: "all" }]);
  });

  test("archived results are refetched too, even in a single project", async () => {
    const ctx = mkCtx({ board: (q) => (q.archived ? { phases: [{ name: "Old", items: [item("a1", "Gone", "done")] }], counts: {} } : BOARD()), post: () => ({ state: BOARD() }) });
    await mount(ctx);
    btn("Archived").click();
    await flush();
    btn("Restore").click();
    await flush();
    expect(calls.gets.length).toBe(3);
    expect(calls.gets[2][1].archived).toBe(1);
  });

  test("archived cards in the merged view carry the project label", async () => {
    const ctx = mkCtx({ project: "all", board: (q) => (q.archived ? { phases: [{ name: "Old", items: [item("a1", "Gone", "done", { project: "/w/zed" })] }], counts: {} } : MERGED()) });
    await mount(ctx);
    btn("Archived").click();
    await flush();
    expect(texts("section.col span.tag")).toEqual(["1", "zed"]);
    btn("Restore").click();
    await flush();
    expect(calls.posts[0][1]).toEqual({ project: "/w/zed", op: "restore", id: "a1" });
  });
});

describe("dragging", () => {
  const drag = (card, task) => fire(card, "dragstart", { dataTransfer: { setData(k, v) { task.dt = [k, v]; }, set effectAllowed(v) { task.effect = v; } } });

  test("dragging marks the card, and dropping on another card of the phase reorders", async () => {
    const ctx = mkCtx({ board: { phases: [{ name: "A", items: [item("a", "One", "open"), item("b", "Two", "open"), item("c", "Three", "open")] }], counts: { open: 3 } } });
    await mount(ctx);
    const info = {};
    drag(cardOf("Three"), info);
    expect(cardOf("Three").dataset.dragging).toBe("true");
    expect(info.dt).toEqual(["text/plain", "c"]);
    expect(info.effect).toBe("move");
    const over = fire(cardOf("One"), "dragover");
    expect(over.prevented).toBe(true);
    expect(cardOf("One").dataset.over).toBe("true");
    const drop = fire(cardOf("One"), "drop");
    expect(drop.prevented).toBe(true);
    await flush();
    expect(calls.posts[0][1]).toEqual({ project: "/p", op: "reorder", phase: "A", ids: ["c", "a", "b"] });
  });

  test("dragging over itself or with nothing dragged does nothing", async () => {
    await mount(mkCtx());
    const card = cardOf("Fix bug");
    expect(fire(card, "dragover").prevented).toBeUndefined();
    drag(card, {});
    expect(fire(card, "dragover").prevented).toBeUndefined();
    expect(card.dataset.over).toBeUndefined();
  });

  test("drag end clears the marks; leaving removes the highlight", async () => {
    await mount(mkCtx());
    const a = cardOf("Fix bug");
    const b = cardOf("Ship it");
    drag(a, {});
    fire(b, "dragover");
    b.attrs["data-over"] = "true";
    fire(b, "dragleave");
    expect(b.attrs["data-over"]).toBeUndefined();
    a.attrs["data-over"] = "true";
    fire(a, "dragend");
    expect(a.dataset.dragging).toBeUndefined();
    expect(a.attrs["data-over"]).toBeUndefined();
    expect(fire(b, "dragover").prevented).toBeUndefined();
  });

  test("dropping on a card of another phase moves the dragged task there", async () => {
    const ctx = mkCtx({ board: { phases: [{ name: "A", items: [item("a", "One", "open")] }, { name: "B", items: [item("b", "Two", "open")] }], counts: { open: 2 } } });
    await mount(ctx);
    drag(cardOf("One"), {});
    fire(cardOf("Two"), "drop");
    await flush();
    expect(calls.posts[0][1]).toEqual({ project: "/p", op: "move", id: "a", phase: "B" });
  });

  test("dropping on the empty body of another phase moves it; on its own phase or on a card it does not", async () => {
    const ctx = mkCtx({ board: { phases: [{ name: "A", items: [item("a", "One", "open")] }, { name: "B", items: [] }], counts: { open: 1 } } });
    await mount(ctx);
    const bodies = all("ul.col-body");
    expect(fire(bodies[1], "dragover").prevented).toBeUndefined();
    drag(cardOf("One"), {});
    expect(fire(bodies[1], "dragover").prevented).toBe(true);
    fire(bodies[0], "drop", { target: { closest: () => null } });
    await flush();
    expect(calls.posts).toEqual([]);
    fire(bodies[1], "drop", { target: { closest: () => ({}) } });
    await flush();
    expect(calls.posts).toEqual([]);
    const ev = fire(bodies[1], "drop", { target: { closest: () => null } });
    await flush();
    expect(ev.prevented).toBe(true);
    expect(calls.posts[0][1]).toEqual({ project: "/p", op: "move", id: "a", phase: "B" });
  });

  test("a drop with nothing being dragged is ignored", async () => {
    await mount(mkCtx());
    fire(all("ul.col-body")[1], "drop", { target: { closest: () => null } });
    await flush();
    expect(calls.posts).toEqual([]);
    fire(cardOf("Ship it"), "drop");
    await flush();
    expect(calls.posts).toEqual([]);
  });

  test("a drag of a task that has since vanished does nothing", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    drag(cardOf("Fix bug"), {});
    responses.board = { phases: [{ name: "Backlog", items: [item("t1", "Only", "open")] }], counts: { open: 1 } };
    const survivor = cardOf("Ship it");
    btn("Claim (me)", cardOf("Fix bug")).click();
    await flush();
    calls.posts.length = 0;
    fire(survivor, "drop");
    await flush();
    expect(calls.posts).toEqual([]);
  });
});

describe("live refresh", () => {
  const timerOf = (ms) => timers.list.filter((t) => t.ms === ms);

  test("only todos events, or ticks in poll mode, schedule a refresh", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    page.onEvent("herd", ctx);
    page.onEvent("tick", ctx);
    expect(timerOf(700).length).toBe(0);
    page.onEvent("todos", ctx);
    expect(timerOf(700).length).toBe(1);
    ctx.api.mode = "poll";
    page.onEvent("tick", ctx);
    expect(timerOf(700).length).toBe(2);
    expect(timers.cleared.length).toBe(2);
  });

  test("a refresh with nothing real changed leaves the DOM alone; a change repaints", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    const before = root();
    page.onEvent("todos", ctx);
    await runRefresh();
    expect(root()).toBe(before);
    responses.board = { ...BOARD(), generated_at: "later", phases: [{ name: "Backlog", items: [item("t9", "Fresh", "open")] }] };
    page.onEvent("todos", ctx);
    await runRefresh();
    expect(root()).not.toBe(before);
    expect(texts("li.todo .todo-text-label")).toEqual(["Fresh"]);
  });

  test("volatile fields alone do not count as a change", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    const before = root();
    const b = BOARD();
    b.updated = "x";
    b.now = 5;
    b.phases[0].items[0].age_seconds = 99;
    b.phases[0].items[0].updated = "2030-01-01T00:00:00Z";
    b.generated_at = "g";
    b.idle_seconds = 3;
    b.last_ok = 1;
    responses.board = b;
    page.onEvent("todos", ctx);
    await runRefresh();
    expect(root()).toBe(before);
  });

  test("a failed refresh keeps the rows and shows a stale banner with the last good time; Retry recovers", async () => {
    const ctx = mkCtx();
    const realNow = Date.now;
    Date.now = () => 1_800_000_000_000;
    await mount(ctx);
    Date.now = realNow;
    responses.board = new Error("offline");
    page.onEvent("todos", ctx);
    await runRefresh();
    const banner = one("div.work-stale");
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.querySelector("span").textContent).toBe("Could not refresh the board. Showing the last good state from " + new Date(1_800_000_000_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + ".");
    expect(texts("li.todo .todo-text-label").length).toBe(3);
    responses.board = BOARD();
    btn("Retry", banner).click();
    await flush();
    expect(one("div.work-stale")).toBeNull();
  });

  test("Retry that fails again keeps the banner", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    responses.board = new Error("offline");
    page.onEvent("todos", ctx);
    await runRefresh();
    btn("Retry", one("div.work-stale")).click();
    await flush();
    expect(one("div.work-stale")).not.toBeNull();
  });

  test("recovery on the next event clears the banner even when the board is unchanged", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    responses.board = new Error("offline");
    page.onEvent("todos", ctx);
    await runRefresh();
    expect(one("div.work-stale")).not.toBeNull();
    responses.board = BOARD();
    page.onEvent("todos", ctx);
    await runRefresh();
    expect(one("div.work-stale")).toBeNull();
  });

  test("the first event arms one repaint listener; destroy cancels the pending refresh", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    page.onEvent("todos", ctx);
    page.onEvent("todos", ctx);
    expect((winListeners["work-repaint"] || []).length).toBe(1);
    const before = timers.cleared.length;
    page.destroy();
    expect(timers.cleared.length).toBe(before + 1);
    expect(page.render(ctx).querySelector("h2.state-title").textContent).toBe("Board not loaded");
  });

  test("while the user is editing, a changed board is held back and applied once they are done", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    btn("Edit", cardOf("Fix bug")).click();
    responses.board = { ...BOARD(), phases: [{ name: "Backlog", items: [item("t2", "Fix bug", "open"), item("t7", "Other", "open")] }] };
    page.onEvent("todos", ctx);
    await runRefresh();
    expect(one("form.edit-form")).not.toBeNull();
    expect(texts("li.todo .todo-text-label")).not.toContain("Other");
    btn("Cancel").click();
    expect(texts("li.todo .todo-text-label")).toContain("Other");
  });

  test("a held-back repaint runs when focus leaves the board or the pointer is released", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    page.onEvent("todos", ctx);
    document.activeElement = { tagName: "INPUT", closest: (s) => (s === "#work-root" ? {} : null) };
    responses.board = { ...BOARD(), phases: [{ name: "Backlog", items: [item("t7", "Other", "open")] }] };
    await runRefresh();
    expect(texts("li.todo .todo-text-label")).not.toContain("Other");
    document.activeElement = null;
    fire(root(), "focusout");
    timers.list.filter((t) => t.ms === 0).forEach((t) => t.fn());
    expect(texts("li.todo .todo-text-label")).toEqual(["Other"]);
  });

  test("pointer down holds repaints back and pointer up releases them", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    const down = docListeners.add.find((a) => a[0] === "pointerdown")[1];
    const up = docListeners.add.find((a) => a[0] === "pointerup")[1];
    const cancel = docListeners.add.find((a) => a[0] === "pointercancel")[1];
    expect(cancel).toBe(up);
    page.onEvent("todos", ctx);
    down();
    responses.board = { ...BOARD(), phases: [{ name: "Backlog", items: [item("t7", "Other", "open")] }] };
    await runRefresh();
    expect(texts("li.todo .todo-text-label")).not.toContain("Other");
    up();
    timers.list.filter((t) => t.ms === 0).forEach((t) => t.fn());
    expect(texts("li.todo .todo-text-label")).toEqual(["Other"]);
  });

  test("pointer up with nothing pending schedules nothing; a pointer that stays down blocks the repaint timer", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    const up = docListeners.add.find((a) => a[0] === "pointerup")[1];
    btn("done 1").click(); // a paint
    up();
    expect(timers.list.filter((t) => t.ms === 0).length).toBe(0);
  });

  test("a failed refresh while busy is shown once the user is done", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    btn("Edit", cardOf("Fix bug")).click();
    responses.board = new Error("offline");
    page.onEvent("todos", ctx);
    await runRefresh();
    expect(one("div.work-stale")).toBeNull();
    btn("Cancel").click();
    expect(one("div.work-stale")).not.toBeNull();
  });

  test("a failed refresh while the user is typing waits, then shows the banner when focus leaves", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    document.activeElement = { tagName: "TEXTAREA", closest: (s) => (s === "#work-root" ? {} : null) };
    responses.board = new Error("offline");
    page.onEvent("todos", ctx);
    await runRefresh();
    expect(one("div.work-stale")).toBeNull();
    document.activeElement = null;
    fire(root(), "focusout");
    timers.list.filter((t) => t.ms === 0).forEach((t) => t.fn());
    expect(one("div.work-stale")).not.toBeNull();
  });

  test("the repaint signal only repaints when something was held back and the user is idle", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    page.onEvent("todos", ctx);
    const before = root();
    window.dispatchEvent({ type: "work-repaint" });
    expect(root()).toBe(before);
    document.activeElement = { tagName: "INPUT", closest: (s) => (s === "#work-root" ? {} : null) };
    responses.board = { ...BOARD(), phases: [{ name: "Backlog", items: [item("t7", "Other", "open")] }] };
    await runRefresh(); // held back: stale
    window.dispatchEvent({ type: "work-repaint" });
    expect(texts("li.todo .todo-text-label")).not.toContain("Other");
    document.activeElement = null;
    window.dispatchEvent({ type: "work-repaint" });
    expect(texts("li.todo .todo-text-label")).toEqual(["Other"]);
  });

  test("a repaint keeps focus on the same control and each column's scroll", async () => {
    const ctx = mkCtx();
    await mount(ctx);
    all("ul.col-body")[0].scrollTop = 120;
    const sel = cardOf("Fix bug").querySelector("select");
    let focusedKey = null;
    document.activeElement = { dataset: { focusKey: "st-t2" } };
    const proto = Object.getPrototypeOf(sel);
    const savedFocus = proto.focus;
    proto.focus = function () { focusedKey = this.attrs["data-focus-key"]; };
    try {
      btn("done 1").click();
    } finally {
      proto.focus = savedFocus;
    }
    expect(focusedKey).toBe("st-t2");
    expect(all("ul.col-body")[0].scrollTop).toBe(120);
    expect(all("ul.col-body")[1].scrollTop).toBe(0);
  });
});
