import { afterEach, beforeEach, expect, test } from "bun:test";
import { body, installDom, restoreDom } from "./operate-dom-stub.js";
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, f) { this.listeners[k] = f; }
}
globalThis.Node = N;
globalThis.document = { createElement: (t) => new N(t), createTextNode: (t) => ({ text: t }), querySelector: () => null, body: { prepend() {} } };
const { reportFetchFail, clearFetchFail, fetchFailures } = await import("./fetch-fail.js");

test("reports count per endpoint and clears on success", () => {
  reportFetchFail("overview", "/api/v2/health", new Error("500"));
  reportFetchFail("overview", "/api/v2/health", new Error("500"));
  reportFetchFail("colony", "colony", "x");
  expect(fetchFailures().length).toBe(2);
  expect(fetchFailures()[0].n).toBe(2);
  clearFetchFail("colony"); clearFetchFail("/api/v2/health");
  expect(fetchFailures().length).toBe(0);
});

// ---- banner rendering (rich DOM stub; globals restored after each test) ----
const RealDate = Date;
let now;
const stubDate = () => { globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } }; };
const clock = (hh, mm, ss) => new RealDate(2026, 0, 2, hh, mm, ss).getTime();
const hms = (t) => new RealDate(t).toTimeString().slice(0, 8);
const banners = () => body.children.filter((c) => c.className === "fetch-fail-banner");
const clearAll = () => fetchFailures().forEach((f) => clearFetchFail(f.endpoint));

beforeEach(() => {
  installDom();
  body.prepend = function (n) { this.children.unshift(n); n.parent = this; };
  now = clock(9, 5, 7);
  stubDate();
});
afterEach(() => { clearAll(); globalThis.Date = RealDate; delete body.prepend; restoreDom(); });

test("a failure paints one role=alert banner at the top of the page naming page, endpoint, message and time", () => {
  body.appendChild(new (body.constructor)("main"));
  reportFetchFail("overview", "/api/health", new Error("boom"));
  const [b] = banners();
  expect(banners().length).toBe(1);
  expect(body.children[0]).toBe(b);
  expect(b.tag).toBe("div");
  expect(b.attrs.role).toBe("alert");
  expect(b.children[0].tag).toBe("span");
  expect(b.children[0].textContent).toBe("Stale data: overview /api/health failed (boom) at " + hms(now));
  expect(b.children[1].tag).toBe("button");
  expect(b.children[1].attrs.type).toBe("button");
  expect(b.children[1].className).toBe("btn");
  expect(b.children[1].textContent).toBe("Dismiss");
});

test("the message is the first of error.error, error.message, the error itself, else 'failed'", () => {
  const text = () => banners()[0].children[0].textContent;
  reportFetchFail("p", "e", { error: "api said no", message: "other" });
  expect(text()).toContain("failed (api said no)");
  reportFetchFail("p", "e", { message: "just message" });
  expect(text()).toContain("failed (just message)");
  reportFetchFail("p", "e", "plain string");
  expect(text()).toContain("failed (plain string)");
  reportFetchFail("p", "e", undefined);
  expect(text()).toContain("failed (failed)");
  reportFetchFail("p", "e", null);
  expect(text()).toContain("failed (failed)");
  reportFetchFail("p", "e", { error: "", message: "" });
  expect(text()).toContain("failed ([object Object])");
});

test("repeat failures bump the count and the banner reports the total across endpoints, newest failure named", () => {
  reportFetchFail("overview", "/a", "x");
  expect(banners()[0].children[0].textContent).not.toContain("failures");
  now = clock(9, 6, 0);
  reportFetchFail("colony", "/b", "y");
  now = clock(9, 7, 30);
  reportFetchFail("colony", "/b", "z");
  expect(banners().length).toBe(1);
  expect(banners()[0].children[0].textContent).toBe("Stale data: colony /b failed (z) at " + hms(clock(9, 7, 30)) + " - 3 failures");
  expect(fetchFailures().map((f) => [f.endpoint, f.n])).toEqual([["/a", 1], ["/b", 2]]);
  expect(fetchFailures()[1].error).toBe("z");
  expect(fetchFailures()[1].at.getTime()).toBe(clock(9, 7, 30));
});

test("when two failures share a timestamp the later report is the one named", () => {
  reportFetchFail("first", "/a", "x");
  reportFetchFail("second", "/b", "y");
  expect(banners()[0].children[0].textContent).toContain("Stale data: second /b failed (y)");
});

test("an older endpoint reported later in time is not displaced by an earlier timestamp", () => {
  now = clock(10, 0, 0);
  reportFetchFail("late", "/a", "x");
  now = clock(9, 0, 0);
  reportFetchFail("early", "/b", "y");
  expect(banners()[0].children[0].textContent).toContain("Stale data: late /a");
});

test("repainting replaces the banner in place instead of stacking another", () => {
  reportFetchFail("p", "/a", "x");
  const first = banners()[0];
  reportFetchFail("p", "/b", "y");
  expect(banners().length).toBe(1);
  expect(banners()[0]).not.toBe(first);
  expect(first.parent).toBe(null);
  expect(body.children.length).toBe(1);
});

test("a successful fetch of the only failing endpoint removes the banner; of an unrelated one leaves it untouched", () => {
  reportFetchFail("p", "/a", "x");
  const b = banners()[0];
  clearFetchFail("/never-failed");
  expect(banners()[0]).toBe(b);
  clearFetchFail("/a");
  expect(banners().length).toBe(0);
  expect(fetchFailures()).toEqual([]);
});

test("clearing one of two endpoints repaints with the remaining failure only", () => {
  reportFetchFail("one", "/a", "x");
  now = clock(9, 6, 0);
  reportFetchFail("two", "/b", "y");
  clearFetchFail("/b");
  expect(banners().length).toBe(1);
  expect(banners()[0].children[0].textContent).toBe("Stale data: one /a failed (x) at " + hms(clock(9, 5, 7)));
});

test("Dismiss drops every recorded failure and removes the banner", () => {
  reportFetchFail("p", "/a", "x");
  reportFetchFail("q", "/b", "y");
  banners()[0].children[1].click();
  expect(banners().length).toBe(0);
  expect(fetchFailures()).toEqual([]);
  reportFetchFail("p", "/a", "x");
  expect(banners().length).toBe(1);
  expect(fetchFailures()[0].n).toBe(1);
});

test("without a document body that can prepend nothing is painted and nothing throws", () => {
  delete body.prepend;
  expect(() => reportFetchFail("p", "/a", "x")).not.toThrow();
  expect(banners().length).toBe(0);
  expect(fetchFailures().length).toBe(1);
  globalThis.document.body = null;
  expect(() => reportFetchFail("p", "/b", "x")).not.toThrow();
  const saved = globalThis.document;
  globalThis.document = undefined;
  expect(() => reportFetchFail("p", "/c", "x")).not.toThrow();
  globalThis.document = saved;
});

test("clearing a failure that was never painted (body was unavailable) is a no-op once the body exists", () => {
  const prepend = body.prepend;
  delete body.prepend;
  reportFetchFail("p", "/a", "x");
  body.prepend = prepend;
  expect(() => clearFetchFail("/a")).not.toThrow();
  expect(banners().length).toBe(0);
});
