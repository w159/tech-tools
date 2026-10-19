import { expect, test } from "bun:test";
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, f) { this.listeners[k] = f; }
}
globalThis.Node = N;
globalThis.document = { createElement: (t) => new N(t), createTextNode: (t) => ({ text: t }), querySelector: () => null, hidden: false };
const { watchVersion } = await import("./version-banner.js");
const flat = (n) => (n.text !== undefined ? n.text : (n.children || []).map(flat).join(""));

test("shows a reload banner only when the polled version differs from the known one", async () => {
  let ver = "1.0.0"; const mounted = []; let reloads = 0;
  const w = watchVersion({ probe: async () => ({ up: true, data: { version: ver } }), mount: (n) => mounted.push(n), reload: () => reloads++, ms: 1e9, known: "1.0.0" });
  await w.tick();
  expect(mounted.length).toBe(0);
  ver = "1.1.0";
  await w.tick(); await w.tick();
  expect(mounted.length).toBe(1);
  expect(flat(mounted[0])).toContain("Dashboard updated to 1.1.0 — Reload");
  mounted[0].children[1].listeners.click();
  expect(reloads).toBe(1);
  w.stop();
});

test("without a meta version the first health sets the baseline", async () => {
  let ver = "2.0.0"; const mounted = [];
  const w = watchVersion({ probe: async () => ({ up: true, data: { version: ver } }), mount: (n) => mounted.push(n), ms: 1e9, known: "" });
  await w.tick(); expect(mounted.length).toBe(0);
  ver = "2.0.1"; await w.tick();
  expect(mounted.length).toBe(1);
  w.stop();
});
