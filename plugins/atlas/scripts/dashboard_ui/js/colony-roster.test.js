import { test, expect } from "bun:test";

class N {
  constructor(t) { this.tag = t; this.style = {}; this.dataset = {}; this.children = []; this.classList = { add() { }, remove() { }, toggle() { } }; }
  setAttribute() { }
  append() { }
  appendChild() { }
  addEventListener() { }
}
globalThis.Node = N;
globalThis.window = { addEventListener() { }, matchMedia: () => ({ matches: false }), location: { href: "http://127.0.0.1:7421/", origin: "http://127.0.0.1:7421" } };
globalThis.location = window.location;
globalThis.navigator = {};
globalThis.sessionStorage = { getItem: () => null, setItem() { } };
globalThis.document = { createElement: (t) => new N(t), createElementNS: (_n, t) => new N(t), createTextNode: (t) => ({ text: t }), querySelector: () => null, documentElement: new N("html"), addEventListener() { }, body: new N("body") };
const { sendBlock, canSteer, sendBody, killBody } = await import("./pages/colony.js");

test("send is blocked with a reason for finished and dead members only", () => {
  expect(sendBlock({ state: "finished", exit_code: 0 })).toContain("exit 0");
  expect(sendBlock({ state: "dead" })).toContain("gone");
  expect(sendBlock({ state: "running", steerable: false, headless: true })).toBe("");
  expect(sendBlock({ state: "stuck", steerable: true })).toBe("");
  expect(canSteer({ state: "finished" })).toBe(false);
});

test("sendBlock edge states", () => {
  expect(sendBlock({ state: "finished" })).toBe("Finished: nothing to send to.");
  expect(sendBlock({ state: "idle", steerable: false, headless: false })).toContain("cannot receive");
  expect(canSteer({ state: "stuck" })).toBe(true);
  expect(canSteer({ state: "dead" })).toBe(false);
});

test("send and kill POST bodies carry the selected project", () => {
  const ctx = { params: {}, project: "/repo/a" };
  expect(sendBody(ctx, "hi")).toEqual({ text: "hi", project: "/repo/a" });
  expect(killBody(ctx)).toEqual({ project: "/repo/a" });
  expect(killBody({ params: { project: "/repo/b" }, project: "/repo/a" }).project).toBe("/repo/b");
});
