import { expect, test } from "bun:test";
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
