import { afterEach, expect, test } from "bun:test";
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

// ---- meta baseline, probe edge cases, banner markup, polling ----
const realQuery = document.querySelector, realSetInterval = globalThis.setInterval, realClearInterval = globalThis.clearInterval, realLocation = globalThis.location;
afterEach(() => {
  document.querySelector = realQuery; document.hidden = false;
  globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval; globalThis.location = realLocation;
});
const metaStub = (content) => { document.querySelector = (sel) => (sel === 'meta[name="atlas-version"]' ? { getAttribute: (k) => (k === "content" ? content : null) } : null); };
const watch = (versions, extra = {}) => {
  const mounted = [];
  let i = 0;
  const w = watchVersion({ probe: async () => versions[Math.min(i++, versions.length - 1)], mount: (n) => mounted.push(n), ms: 1e9, ...extra });
  return { w, mounted };
};
const up = (version) => ({ up: true, data: { version } });
const settle = () => new Promise((r) => setTimeout(r, 5));

test("the version the page was served with (meta atlas-version) is the baseline", async () => {
  metaStub("5.0.0");
  const { w, mounted } = watch([up("5.0.0"), up("5.0.0"), up("5.1.0")]);
  await settle(); await w.tick();
  expect(mounted.length).toBe(0);
  await w.tick();
  expect(mounted.length).toBe(1);
  expect(flat(mounted[0])).toContain("Dashboard updated to 5.1.0");
  w.stop();
  // the very first health already differs from the served version: no silent re-baselining
  const first = watch([up("5.2.0")]);
  await settle();
  expect(first.mounted.length).toBe(1);
  expect(flat(first.mounted[0])).toContain("Dashboard updated to 5.2.0");
  first.w.stop();
});

test("an unsubstituted or empty meta placeholder is no baseline: the first health response becomes it", async () => {
  for (const content of ["__ATLAS_VERSION__", "", null]) {
    metaStub(content);
    const { w, mounted } = watch([up("7.0.0"), up("7.0.0"), up("7.0.1")]);
    await settle(); await w.tick();
    expect(mounted.length).toBe(0);
    await w.tick();
    expect(mounted.length).toBe(1);
    w.stop();
  }
  document.querySelector = () => null;
  const { w, mounted } = watch([up("8"), up("8.1")]);
  await settle(); await w.tick();
  expect(mounted.length).toBe(1);
  w.stop();
});

test("watching probes once straight away", async () => {
  let probes = 0;
  const w = watchVersion({ probe: async () => { probes++; return up("1"); }, mount() {}, ms: 1e9, known: "1" });
  expect(probes).toBe(1);
  w.stop();
});

test("an unreachable or versionless probe changes nothing and never becomes the baseline", async () => {
  const { w, mounted } = watch([null, undefined, { up: false, data: { version: "9.9.9" } }, { up: true }, { up: true, data: {} }, { up: true, data: { version: "" } }], { known: "1.0.0" });
  for (let i = 0; i < 6; i++) await w.tick();
  expect(mounted.length).toBe(0);
  w.stop();
  const b = watch([{ up: false, data: { version: "9.9.9" } }, up("2.0.0"), up("2.0.1")], { known: "" });
  await settle(); await b.w.tick(); await b.w.tick();
  expect(b.mounted.length).toBe(1);
  expect(flat(b.mounted[0])).toContain("2.0.1");
  b.w.stop();
});

test("the banner is a status region with a Reload button and is mounted only once per page", async () => {
  const { w, mounted } = watch([up("1.1"), up("1.2"), up("1.3")], { known: "1.0" });
  await settle(); await w.tick(); await w.tick();
  expect(mounted.length).toBe(1);
  const b = mounted[0];
  expect(b.tag).toBe("div");
  expect(b.attrs.class).toBe("update-banner");
  expect(b.attrs.role).toBe("status");
  expect(b.children[0].tag).toBe("span");
  expect(b.children[0].children[0].text).toBe("Dashboard updated to 1.1 — ");
  expect(b.children[1].tag).toBe("button");
  expect(b.children[1].attrs.class).toBe("btn");
  expect(b.children[1].attrs.type).toBe("button");
  expect(flat(b.children[1])).toBe("Reload");
  w.stop();
});

test("Reload defaults to location.reload()", async () => {
  let reloads = 0;
  globalThis.location = { reload: () => reloads++ };
  const { w, mounted } = watch([up("2")], { known: "1" });
  await settle();
  mounted[0].children[1].listeners.click();
  expect(reloads).toBe(1);
  w.stop();
});

test("polls every 30s by default, skips ticks while the tab is hidden, and stop() clears the timer", async () => {
  let probes = 0;
  const timers = [], cleared = [];
  globalThis.setInterval = (f, ms) => { timers.push([f, ms]); return 42; };
  globalThis.clearInterval = (t) => cleared.push(t);
  const w = watchVersion({ probe: async () => { probes++; return up("1"); }, mount() {}, known: "1" });
  expect(timers.length).toBe(1);
  expect(timers[0][1]).toBe(30000);
  expect(probes).toBe(1);
  timers[0][0]();
  expect(probes).toBe(2);
  document.hidden = true;
  timers[0][0]();
  expect(probes).toBe(2);
  document.hidden = false;
  timers[0][0]();
  expect(probes).toBe(3);
  expect(cleared).toEqual([]);
  w.stop();
  expect(cleared).toEqual([42]);
});

test("a custom interval is honoured", () => {
  const timers = [];
  globalThis.setInterval = (f, ms) => { timers.push(ms); return 1; };
  const w = watchVersion({ probe: async () => null, mount() {}, ms: 1234, known: "1" });
  expect(timers).toEqual([1234]);
  w.stop();
});
