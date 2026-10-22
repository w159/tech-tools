import { test, expect } from "bun:test";

// Minimal DOM stand-in (no DOM lib is installed), same shape as channel-lens.test.js.
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.hidden = false; this.style = { setProperty() {} }; this.dataset = {}; this.value = ""; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  replaceChildren(...c) { this.children = []; c.forEach((x) => x && this.appendChild(x)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  get firstChild() { return this.children[0] || null; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); }
  set textContent(v) { this.children = [{ text: String(v) }]; }
  querySelectorAll(sel) { const w = (n, o = []) => { if (n.children) n.children.forEach((c) => { o.push(c); w(c, o); }); return o; }; return w(this).filter((n) => (sel[0] === "." ? (n.attrs && (n.attrs.class || "").split(" ").includes(sel.slice(1))) : n.tag === sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  get textContent() { return this.children.map((c) => (c.text !== undefined ? c.text : c.textContent)).join(""); }
}
globalThis.Node = N;
globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false }), location: { href: "http://127.0.0.1:7421/", origin: "http://127.0.0.1:7421" } };
globalThis.location = window.location;
globalThis.navigator = {};
globalThis.sessionStorage = { getItem: () => null, setItem() {} };
globalThis.document = { createElement: (t) => new N(t), createElementNS: (_n, t) => new N(t), createTextNode: (t) => ({ text: t }), querySelector: () => null, documentElement: new N("html"), addEventListener() {}, body: new N("body"), hidden: false };

const { api } = await import("./api.js");
// Spy on the shared api.post (restored per test) instead of a module mock, which is process-global and leaks into send-path.test.js.
const sent = [];
const { startChannelSync, FALLBACK_MS } = await import("./channel-sync.js");
const { mountChannelLens } = await import("./pages/channel-lens.js");

const fakeStore = (conn = "live") => {
  const subs = new Set();
  const evs = new Set();
  return {
    subscribe: (fn) => { subs.add(fn); fn({ conn }); return () => subs.delete(fn); },
    onEvent: (fn) => { evs.add(fn); return () => evs.delete(fn); },
    setConn: (c) => subs.forEach((fn) => fn({ conn: c })),
    emit: (name, data) => evs.forEach((fn) => fn(name, data)),
    listeners: () => subs.size + evs.size,
  };
};
const fakeTimers = () => {
  const t = { live: new Map(), n: 0, set: (fn, ms) => { t.live.set(++t.n, { fn, ms }); return t.n; }, clear: (id) => t.live.delete(id) };
  return t;
};

test("an irc event refreshes with no timer running while SSE is live", () => {
  const store = fakeStore("live");
  const timers = fakeTimers();
  let calls = 0;
  startChannelSync({ store, refresh: () => { calls += 1; }, timers });
  expect(timers.live.size).toBe(0);
  store.emit("irc", {});
  store.emit("herd", {});
  expect(calls).toBe(1);
});

test("30 s fallback poll runs only while SSE is down and stops when it is live again", () => {
  const store = fakeStore("poll");
  const timers = fakeTimers();
  let calls = 0;
  const stop = startChannelSync({ store, refresh: () => { calls += 1; }, timers });
  expect(FALLBACK_MS).toBe(30000);
  expect([...timers.live.values()].map((v) => v.ms)).toEqual([30000]);
  [...timers.live.values()][0].fn();
  expect(calls).toBe(1);
  store.setConn("live");
  expect(timers.live.size).toBe(0);
  store.setConn("reconnecting");
  expect(timers.live.size).toBe(1);
  stop();
  expect(timers.live.size).toBe(0);
  expect(store.listeners()).toBe(0);
});

test("skip() suppresses refresh (open dropdown keeps the draft)", () => {
  const store = fakeStore("live");
  let calls = 0;
  startChannelSync({ store, refresh: () => { calls += 1; }, skip: () => true, timers: fakeTimers() });
  store.emit("irc", {});
  expect(calls).toBe(0);
});

test("channels page has no 5 s poll and uses the sync helper", async () => {
  const src = await Bun.file(new URL("./pages/channels.js", import.meta.url)).text();
  expect(src).not.toContain("5000");
  expect(src).not.toContain("setInterval");
  expect(src).toContain("startChannelSync");
});

const walk = (n, out = []) => { if (n && n.children) { out.push(n); n.children.forEach((c) => walk(c, out)); } return out; };
const ctxWith = (get, post = async () => ({})) => ({ params: {}, project: "p", api: { get, post }, store: { get: () => [] }, setProject() {}, openAgent() {}, navigate() {} });
const tick = () => new Promise((r) => setTimeout(r, 0));

test("loading state before data arrives", async () => {
  const body = new N("div");
  const lens = mountChannelLens(ctxWith(() => new Promise(() => {})), body);
  expect(walk(body).some((n) => JSON.stringify(n.attrs).toLowerCase().includes("loading")) || body.textContent.toLowerCase().includes("loading")).toBe(true);
  lens.destroy();
});

test("error state with retry when channels fail", async () => {
  const body = new N("div");
  const lens = mountChannelLens(ctxWith(async () => { throw new Error("boom"); }), body);
  await tick(); await tick();
  expect(body.textContent).toContain("boom");
  lens.destroy();
});

test("empty state when there are no channels", async () => {
  const body = new N("div");
  const lens = mountChannelLens(ctxWith(async () => ({ channels: [] })), body);
  await tick(); await tick();
  expect(body.textContent).toContain("No channels in these projects yet");
  lens.destroy();
});

test("composer posts through the single send path", async () => {
  const body = new N("div");
  const get = async (path) => (path === "channels"
    ? { current: "a@b", channels: [{ name: "a@b", project: "/p", members: [{ name: "w1" }] }] }
    : { channel: { name: "a@b" }, messages: [] });
  const lens = mountChannelLens(ctxWith(get), body);
  await tick(); await tick(); await tick();
  const all = walk(body);
  const ta = all.find((n) => n.tag === "textarea");
  const send = all.find((n) => n.tag === "button" && n.textContent === "Send");
  ta.value = "hi";
  const realPost = api.post;
  api.post = async (path, b) => { sent.push([path.split("/")[1], b.text]); return { ok: true, message: { delivery_text: "delivered" } }; };
  try { await send.listeners.click(); } finally { api.post = realPost; }
  expect(sent).toEqual([["w1", "hi"]]);
  lens.destroy();
});
