import { test, expect } from "bun:test";
import { MOBILE_TABS, normalizeNav, DEFAULT_NAV } from "./nav-order.js";

// Minimal DOM stand-in: just enough for h()/replace() and the console frame builder (no DOM lib is installed).
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.isConnected = false; this.hidden = false; this.classList = { toggle() {}, remove() {}, add() {} }; this.style = {}; }
  appendChild(c) { this.children.push(c); if (c instanceof N) c.isConnected = true; return c; }
  replaceChildren(...c) { this.children = []; c.forEach((x) => x && this.appendChild(x)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  insertBefore(c) { return this.appendChild(c); }
  contains() { return false; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  remove() { this.isConnected = false; }
  set className(v) { this.attrs.class = v; }
  get className() { return this.attrs.class || ""; }
  querySelector() { return null; }
}
globalThis.Node = N;
const SELF = {};
globalThis.window = { self: SELF, top: SELF, addEventListener() {}, removeEventListener() {}, innerWidth: 1440, matchMedia: () => ({ matches: true }), location: { href: "http://127.0.0.1:7421/", origin: "http://127.0.0.1:7421" } };
globalThis.location = window.location;
globalThis.navigator = {};
globalThis.addEventListener = () => {};
globalThis.innerWidth = 1440;
globalThis.sessionStorage = { v: {}, getItem(k) { return this.v[k] ?? null; }, setItem(k, x) { this.v[k] = String(x); } };
globalThis.document = { createElement: (t) => new N(t), createElementNS: (_n, t) => new N(t), createTextNode: (t) => ({ text: t }), querySelector: () => null, documentElement: new N("html"), addEventListener() {}, removeEventListener() {}, body: new N("body") };

const { default: colony, mountConsoleFrame, noteFramePane } = await import("./pages/herdr.js");
const { agentsStore } = await import("./agents-store.js");

const walk = (n, out = []) => { if (n && n.children) { out.push(n); n.children.forEach((c) => walk(c, out)); } return out; };
const frames = (n) => walk(n).filter((x) => x.tag === "iframe");

function setStore(state) { agentsStore.getState = () => state; agentsStore.subscribe = () => () => {}; }
const up = { loaded: true, down: null, layers: { herdr: { state: "up" }, webui: { state: "up", url: "http://127.0.0.1:7317/" } } };
const ctxOf = (params = {}) => ({ params, api: {} });

test("Colony page renders only the frame: chrome=full iframe, nothing else in the page", () => {
  setStore(up);
  const page = colony.render(ctxOf());
  expect(colony.id).toBe("colony");
  expect(page.attrs.class).toContain("colony-page");
  // DOM children: the iframe plus its loading veil, no head, lens bar, toggle or status strip
  expect(page.children.map((c) => c.tag + "." + c.attrs.class)).toEqual(["iframe.console-frame", "div.console-veil"]);
  const f = frames(page)[0];
  expect(f.attrs.src).toContain("chrome=full");
  expect(f.attrs.src).not.toContain("pane=");
  expect(f.attrs.sandbox).toContain("allow-same-origin");
  expect(walk(page).some((n) => ["h1", "h2", "header", "button"].includes(n.tag))).toBe(false);
  colony.destroy();
});

test("frame is never recreated by redraws; ?pane= deep link carries into the frame URL", () => {
  setStore(up);
  const body = new N("div");
  const params = {};
  const draw = mountConsoleFrame(ctxOf(params), body);
  draw();
  const f = frames(body)[0];
  f.isConnected = true;
  draw(); draw();
  expect(frames(body)[0]).toBe(f);
  params.pane = "p_7";
  draw();
  const g = frames(body)[0];
  expect(g).not.toBe(f);
  expect(g.attrs.src).toContain("pane=p_7");
  expect(g.attrs.src).toContain("chrome=full");
});

test("recovery card when the web UI is down (Start + Recheck), no iframe", () => {
  setStore({ ...up, layers: { herdr: { state: "up" }, webui: { state: "down", url: "" } } });
  const body = new N("div");
  mountConsoleFrame(ctxOf(), body)();
  expect(frames(body).length).toBe(0);
  expect(walk(body).some((n) => n.attrs["data-layer"] === "webui")).toBe(true);
});

test("no iframe when the dashboard itself is framed (recursion guard)", () => {
  setStore(up);
  window.top = {}; // distinct from self = framed
  const body = new N("div");
  mountConsoleFrame(ctxOf(), body)();
  expect(frames(body).length).toBe(0);
  window.top = SELF;
});

test("nav model: Colony is one flat entry, mobile More lists it once", () => {
  const colonyTabs = MOBILE_TABS.filter((t) => t[0] === "colony");
  expect(colonyTabs).toEqual([["colony", "Colony"]]);
  expect(MOBILE_TABS.some((t) => /herdr/i.test(t[0] + t[1] + (t[2] || "")))).toBe(false);
  const ordered = normalizeNav(undefined).map((id) => MOBILE_TABS.find((t) => t[0] === id)).filter(Boolean);
  expect(ordered.map((t) => t[0])).toEqual(DEFAULT_NAV);
  expect(ordered.slice(4).filter((t) => t[0] === "colony").length).toBe(1); // reachable from the More popover
});

test("iframe node and src are stable across load, frame-reported pane and store/SSE ticks; an external pane navigates", () => {
  setStore(up);
  const body = new N("div");
  const params = {};
  const draw = mountConsoleFrame(ctxOf(params), body);
  draw();
  const f = frames(body)[0];
  const src = f.attrs.src;
  f.listeners.load(); // frame loaded
  // the frame reports its own selection: app.js notes it, then mirrors it into ctx.params (setParams)
  noteFramePane("p_3");
  params.pane = "p_3";
  for (let i = 0; i < 5; i++) { setStore({ ...up, generation: i }); draw(); } // store / SSE ticks
  expect(frames(body)[0]).toBe(f);
  expect(frames(body)[0].attrs.src).toBe(src);
  // the user picks another pane inside the frame
  noteFramePane("p_9");
  params.pane = "p_9";
  draw(); draw();
  expect(frames(body)[0]).toBe(f);
  expect(f.attrs.src).toBe(src);
  // a pane from outside (deep link / Open in Colony) does navigate
  params.pane = "p_1";
  draw();
  const g = frames(body)[0];
  expect(g).not.toBe(f);
  expect(g.attrs.src).toContain("pane=p_1");
  g.isConnected = true;
  draw(); draw();
  expect(frames(body)[0]).toBe(g);
});

test("every id in the nav model has a Settings label (no raw ids in the nav-order editor)", async () => {
  const src = await Bun.file(new URL("./pages/settings.js", import.meta.url)).text();
  const labels = src.match(/const NAV_LABELS = \{([^}]*)\}/)[1];
  for (const id of DEFAULT_NAV) expect(labels).toMatch(new RegExp("\\b" + id + ": '[A-Z]"));
  expect(src).not.toMatch(/Herdr[ ]console/);
  expect(labels).toContain("colony: 'Colony'");
});
