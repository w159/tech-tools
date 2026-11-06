import { test, expect, afterEach } from "bun:test";

class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...c) { this.children = []; c.forEach((x) => this.appendChild(x)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener() {}
}
globalThis.Node = N;
globalThis.window = { self: {}, top: {}, addEventListener() {}, __ATLAS_BASE__: "" };
globalThis.location = { protocol: "http:", host: "x", href: "http://x/" };
globalThis.sessionStorage = { getItem: () => null, setItem() {} };
globalThis.document = { createElement: (t) => new N(t), createTextNode: (t) => ({ text: t }), querySelector: () => null, addEventListener() {}, hidden: false };
const { colonyRows, MachineColonies } = await import("./machine-colonies.js");
const { api } = await import("./api.js");
const { lastSnap } = await import("./pages/terminal.js");

const walk = (n, out = []) => { if (n && n.children) { out.push(n); n.children.forEach((c) => walk(c, out)); } return out; };
const text = (n) => walk(n).flatMap((x) => x.children.map((c) => c.text)).filter(Boolean).join("|");
const SNAP = {
  host: "mac", project: "/p/tech-tools",
  colonies: [{ id: "run1", project: "/p/tech-tools" }, { id: "run2", project: "/p/other" }, { id: "run3" }],
  seats: [
    { colony: "run1", state: "working" }, { colony: "run1", state: "finished" },
    { colony: "run2", state: "blocked" }, { colony: "run3", state: "finished" },
  ],
};
const mount = async (snap) => { api.get = async () => snap; const el = MachineColonies({ getProject: () => "all", poll: false }); await new Promise((r) => setTimeout(r, 5)); return el; };

test("rows come from the snapshot: id, project, state dot, seat count, terminal link", async () => {
  expect(colonyRows(SNAP)).toEqual([
    { id: "run1", name: "run1", title: "", project: "tech-tools", finished: false, state: "working", seats: 2 },
    { id: "run2", name: "run2", title: "", project: "other", finished: false, state: "blocked", seats: 1 },
    { id: "run3", name: "run3", title: "", project: "tech-tools", finished: false, state: "idle", seats: 1 },
  ]);
  const el = await mount(SNAP);
  const rows = walk(el).filter((x) => (x.attrs.class || "").includes("rail-colony"));
  expect(rows.map((r) => r.attrs.href)).toEqual(["#/terminal?space=run1", "#/terminal?space=run2", "#/terminal?space=run3"]);
  expect(walk(el).filter((x) => x.attrs["data-state"]).map((x) => x.attrs["data-state"])).toEqual(["working", "blocked", "idle"]);
  expect(text(el)).toContain("This machine|mac");
});

test("no herdr workspace rows", async () => {
  const el = await mount({ ...SNAP, workspaces: [{ id: "atlas-selffix" }, { id: "tech-tools" }] });
  expect(text(el)).not.toContain("atlas-selffix");
  expect(walk(el).filter((x) => (x.attrs.class || "").includes("tree-ws")).length).toBe(0);
});

test("empty state", async () => {
  const el = await mount({ host: "mac", colonies: [], seats: [] });
  expect(text(el)).toContain("No colonies running");
});

test("rows show the human name and title, keep the id in the link", async () => {
  const el = await mount({ host: "mac", project: "/p", colonies: [{ id: "t8e7324", name: "tui-review", title: "Review the TUI" }], seats: [] });
  const row = walk(el).find((x) => (x.attrs.class || "").includes("rail-colony"));
  expect(row.attrs.href).toBe("#/terminal?space=t8e7324");
  expect(text(row)).toContain("tui-review");
  expect(walk(row).some((x) => x.attrs.title === "Review the TUI")).toBe(true);
  expect(text(row)).not.toContain("t8e7324");
});

test("finished colonies are dimmed and tagged in the rail", async () => {
  const snap = { host: "m", colonies: [{ id: "done", finished: true }], seats: [{ colony: "done", state: "finished" }] };
  const el = await mount(snap);
  const row = walk(el).find((x) => (x.attrs.class || "").includes("rail-colony"));
  expect(row.attrs.class).toContain("is-finished");
  expect(text(row)).toContain("finished");
});

// ---- contracts: colonyRows edge cases, refresh query, error state, polling ----
const realGet = api.get, realSetInterval = globalThis.setInterval, realClearInterval = globalThis.clearInterval;
afterEach(() => {
  api.get = realGet; globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval;
  document.hidden = false; lastSnap.key = ""; lastSnap.snap = null;
});
const cls = (n, c) => (n.attrs.class || "").split(" ").includes(c);
const settle = () => new Promise((r) => setTimeout(r, 5));

test("colonyRows tolerates a missing or empty snapshot", () => {
  expect(colonyRows(null)).toEqual([]);
  expect(colonyRows(undefined)).toEqual([]);
  expect(colonyRows({})).toEqual([]);
  expect(colonyRows({ colonies: [{ id: "a" }] })).toEqual([{ id: "a", name: "a", title: "", project: "", finished: false, state: "idle", seats: 0 }]);
});

test("colonyRows: working outranks blocked, blocked outranks idle, seats count only the colony's own", () => {
  const rows = colonyRows({
    colonies: [{ id: "a" }, { id: "b" }, { id: "c" }],
    seats: [{ colony: "a", state: "blocked" }, { colony: "a", state: "working" }, { colony: "a", state: "blocked" }, { colony: "b", state: "blocked" }, { colony: "b", state: "idle" }, { colony: "c", state: "idle" }, { colony: "zzz", state: "working" }],
  });
  expect(rows.map((r) => [r.id, r.state, r.seats])).toEqual([["a", "working", 3], ["b", "blocked", 2], ["c", "idle", 1]]);
});

test("colonyRows: project is the last path segment of the colony's own project, else the snapshot's, ignoring trailing slashes", () => {
  const rows = colonyRows({ project: "/snap/root/", colonies: [{ id: "a", project: "/x/y/proj/" }, { id: "b" }, { id: "c", project: "bare" }, { id: "d", project: "/" }], seats: [] });
  expect(rows.map((r) => r.project)).toEqual(["proj", "root", "bare", "/"]);
  expect(colonyRows({ colonies: [{ id: "e" }] })[0].project).toBe("");
});

test("colonyRows: name falls back to the id, title and finished are carried through", () => {
  const [a, b] = colonyRows({ colonies: [{ id: "t1", name: "review", title: "Review it", finished: true }, { id: "t2", finished: 0 }], seats: [] });
  expect(a).toMatchObject({ name: "review", title: "Review it", finished: true });
  expect(b).toMatchObject({ name: "t2", title: "", finished: false });
});

test("a rendered row exposes its accessible label, tooltip, project tag and seat count", async () => {
  const snap = { host: "mac", project: "/p/tech-tools", colonies: [{ id: "run1", name: "crew", title: "T" }, { id: "run2" }], seats: [{ colony: "run1", state: "working" }, { colony: "run1", state: "idle" }] };
  const el = await mount(snap);
  const [r1, r2] = walk(el).filter((x) => cls(x, "rail-colony"));
  expect(r1.attrs["aria-label"]).toBe("crew, tech-tools, working, 2 seats");
  expect(r1.attrs["data-colony"]).toBe("run1");
  expect(r1.tag).toBe("a");
  expect(cls(r1, "tree-row")).toBe(true);
  expect(cls(r1, "is-finished")).toBe(false);
  expect(r1.children.map((c) => c.attrs.class)).toEqual(["tree-dot", "tree-label truncate", "tree-age dim truncate", "tree-count num dim"]);
  expect(r1.children[0].attrs["aria-hidden"]).toBe("true");
  expect(r1.children[1].attrs.title).toBe("T");
  expect(r2.children[1].attrs.title).toBe("run2");
  expect(text(r1.children[2])).toBe("tech-tools");
  expect(text(r1.children[3])).toBe("2");
  expect(text(r2.children[3])).toBe("0");
  expect(r2.attrs["aria-label"]).toBe("run2, tech-tools, idle, 0 seats");
});

test("the root is a labelled group with the host tag, and the placeholder note replaces rows when empty", async () => {
  const el = await mount({ host: "box", colonies: [], seats: [] });
  expect(el.attrs.class).toBe("rail-tree machine-colonies");
  expect(el.attrs.role).toBe("group");
  expect(el.attrs["aria-label"]).toBe("This machine");
  const host = el.children[0];
  expect(host.attrs.class).toBe("tree-row tree-host");
  expect(host.children.map((c) => [c.attrs.class, text(c)])).toEqual([["tree-label truncate", "This machine"], ["tree-tag dim", "box"]]);
  expect(el.children.length).toBe(2);
  expect(el.children[1].tag).toBe("p");
  expect(el.children[1].attrs.class).toBe("tree-note dim");
});

test("refresh asks for all colonies unless getProject names one; the snapshot is remembered for the Terminal page", async () => {
  const calls = [];
  api.get = async (path, q) => { calls.push([path, q]); return { host: "h", colonies: [], seats: [] }; };
  const mk = async (getProject) => { const el = MachineColonies({ getProject, poll: false }); await settle(); return el; };
  await mk(undefined);
  await mk(() => "all");
  await mk(() => "");
  await mk(() => null);
  expect(calls).toEqual([["term/snapshot", { all: "1" }], ["term/snapshot", { all: "1" }], ["term/snapshot", { all: "1" }], ["term/snapshot", { all: "1" }]]);
  expect(lastSnap.key).toBe('{"all":"1"}');
  const el = await mk(() => "/p/x");
  expect(calls[4]).toEqual(["term/snapshot", { project: "/p/x" }]);
  expect(lastSnap.key).toBe('{"project":"/p/x"}');
  expect(lastSnap.snap).toEqual({ host: "h", colonies: [], seats: [] });
  api.get = async () => ({ host: "h2", colonies: [{ id: "n" }], seats: [] });
  await el.refresh();
  expect(lastSnap.snap.host).toBe("h2");
});

test("a failed snapshot fetch draws the empty state without a host and leaves the remembered snapshot alone", async () => {
  lastSnap.key = "keep"; lastSnap.snap = { keep: true };
  api.get = async () => { throw new Error("down"); };
  const el = MachineColonies({ poll: false });
  await settle();
  expect(text(el)).toBe("This machine|No colonies running");
  expect(text(el.children[0].children[1])).toBe("");
  expect(lastSnap).toEqual({ key: "keep", snap: { keep: true } });
});

test("finished rows tag themselves 'finished' instead of the project", async () => {
  const el = await mount({ host: "m", project: "/a/b", colonies: [{ id: "x", finished: true }, { id: "y" }], seats: [] });
  const [x, y] = walk(el).filter((n) => cls(n, "rail-colony"));
  expect(cls(x, "is-finished")).toBe(true);
  expect(text(x.children[2])).toBe("finished");
  expect(text(y.children[2])).toBe("b");
});

test("polling refreshes every 5s while visible, pauses while the tab is hidden, and stop() ends it", async () => {
  let n = 0;
  api.get = async () => { n++; return { host: "h", colonies: [], seats: [] }; };
  const timers = [], cleared = [];
  globalThis.setInterval = (f, ms) => { timers.push([f, ms]); return timers.length; };
  globalThis.clearInterval = (t) => cleared.push(t);
  const el = MachineColonies({});
  await settle();
  expect(n).toBe(1);
  expect(timers.length).toBe(1);
  expect(timers[0][1]).toBe(5000);
  const tick = timers[0][0];
  tick(); await settle();
  expect(n).toBe(2);
  document.hidden = true;
  tick(); await settle();
  expect(n).toBe(2);
  document.hidden = false;
  expect(cleared).toEqual([]);
  el.stop();
  tick(); await settle();
  expect(n).toBe(2);
  expect(cleared).toEqual([1]);
});

test("poll:false schedules nothing and exposes no stop()", async () => {
  let scheduled = 0;
  globalThis.setInterval = () => { scheduled++; return 1; };
  api.get = async () => ({ colonies: [], seats: [] });
  const el = MachineColonies({ poll: false });
  await settle();
  expect(scheduled).toBe(0);
  expect(el.stop).toBeUndefined();
});
