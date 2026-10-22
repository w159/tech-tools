import { test, expect } from "bun:test";
import { MOBILE_TABS, normalizeNav, DEFAULT_NAV } from "./nav-order.js";

// Minimal DOM stand-in: just enough for h()/replace() (no DOM lib is installed).
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


test("nav model: Colony and Channels are flat entries, mobile More lists each once", () => {
  const colonyTabs = MOBILE_TABS.filter((t) => t[0] === "colony");
  expect(colonyTabs).toEqual([["colony", "Colony"]]);
  expect(MOBILE_TABS.some((t) => /herdr/i.test(t[0] + t[1] + (t[2] || "")))).toBe(false);
  const ordered = normalizeNav(undefined).map((id) => MOBILE_TABS.find((t) => t[0] === id)).filter(Boolean);
  expect(ordered.map((t) => t[0])).toEqual(DEFAULT_NAV);
  expect(MOBILE_TABS.filter((t) => t[0] === "channels")).toEqual([["channels", "Channels"]]);
  expect(normalizeNav(["irc", "colony"]).slice(0, 2)).toEqual(["channels", "colony"]);
  expect(ordered.slice(4).filter((t) => t[0] === "colony").length).toBe(1); // reachable from the More popover
});
test("every id in the nav model has a Settings label (no raw ids in the nav-order editor)", async () => {
  const src = await Bun.file(new URL("./pages/settings.js", import.meta.url)).text();
  const labels = src.match(/const NAV_LABELS = \{([^}]*)\}/)[1];
  for (const id of DEFAULT_NAV) expect(labels).toMatch(new RegExp("\\b" + id + ": '[A-Z]"));
  expect(src).not.toMatch(/Herdr[ ]console/);
  expect(labels).toContain("colony: 'Colony'");
  expect(labels).toContain("terminal: 'Terminal'");
});

test("colony roster: Send is disabled with a reason for finished/dead, headless explains delivery", async () => {
  const { sendBlock, canSteer } = await import("./pages/colony.js");
  expect(sendBlock({ state: "finished", exit_code: 0 })).toContain("exit 0");
  expect(sendBlock({ state: "dead" })).toContain("gone");
  expect(sendBlock({ state: "running", steerable: true })).toBe("");
  expect(sendBlock({ state: "idle", headless: true })).toBe("");
  expect(canSteer({ state: "finished" })).toBe(false);
  expect(canSteer({ state: "stuck" })).toBe(true);
});

test("Terminal route is the Terminal workspace; no herdr wording in its page or nav label", async () => {
  const src = await Bun.file(new URL("./pages/terminal.js", import.meta.url)).text();
  expect(src).not.toMatch(/herdr/i);
  expect(MOBILE_TABS.find((t) => t[0] === "terminal")[1]).toBe("Terminal");
});

test("Open terminal on a member row deep-links to terminal?space=&seat=", async () => {
  const { terminalParams } = await import("./pages/colony.js");
  expect(terminalParams({ name: "impl-1", colony: "run1" })).toEqual({ space: "run1", seat: "impl-1" });
  expect(terminalParams({ name: "impl-1" })).toEqual({ seat: "impl-1" });
});

// All-projects roster: worker seats get Stop/Pause/Cancel, posting with the seat's own project root; the lead gets none.
test("all-projects roster: worker seat has Stop/Pause/Cancel and posts its own project root, lead has none", async () => {
  const { allProjects, rosterDeps } = await import("./pages/colony.js");
  const posts = [];
  rosterDeps.api = { post: async (path, body) => { posts.push([path, body]); } };
  rosterDeps.confirm = async () => true;
  document.getElementById = () => null; // toast() looks up its host
  try {
    const snap = {
      colonies: [{ id: "c1", project: "/p/one", title: "t" }],
      seats: [
        { name: "lead-1", colony: "c1", project: "/p/one", role: "lead", state: "working", lead: true },
        { name: "impl-1", colony: "c1", project: "/p/one", role: "implementer", state: "working", lead: false },
      ],
    };
    const root = allProjects(snap, { navigate() {}, params: {} }, () => {});
    const text = (n) => (n.children || []).map((c) => (typeof c.text === "string" ? c.text : text(c))).join("");
    const rows = [];
    const walk = (n) => { if (n.attrs && n.attrs.class === "colony-top" && /-1/.test(text(n))) rows.push(n); (n.children || []).forEach((c) => c.children && walk(c)); };
    walk(root);
    const buttons = (row) => row.children.filter((c) => c.tag === "button");
    const labels = (row) => buttons(row).map(text);
    const lead = rows.find((r) => /lead-1/.test(text(r)));
    const worker = rows.find((r) => /impl-1/.test(text(r)));
    expect(labels(worker)).toEqual(expect.arrayContaining(["Stop", "Pause", "Cancel"]));
    expect(labels(lead).filter((l) => ["Stop", "Pause", "Cancel", "Resume"].includes(l))).toEqual([]);
    const stop = buttons(worker).find((b) => text(b) === "Stop");
    await (stop.listeners.click || stop.onClick)({});
    await new Promise((r) => setTimeout(r, 0));
    expect(posts).toEqual([["colony/impl-1/kill", { project: "/p/one" }]]);
  } finally {
    delete rosterDeps.api;
    delete rosterDeps.confirm;
    delete document.getElementById;
  }
});
