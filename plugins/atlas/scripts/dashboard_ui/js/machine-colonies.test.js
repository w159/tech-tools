import { test, expect } from "bun:test";

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
    { id: "run1", name: "run1", title: "", project: "tech-tools", state: "working", seats: 2 },
    { id: "run2", name: "run2", title: "", project: "other", state: "blocked", seats: 1 },
    { id: "run3", name: "run3", title: "", project: "tech-tools", state: "idle", seats: 1 },
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
