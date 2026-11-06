import { test, expect, describe, afterEach } from "bun:test";
import { activeLabel, focusByLabel } from "./focus.js";

const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => { Object.defineProperty(globalThis, "document", saved); });

const el = (label, inside = true) => {
  const e = { label, inside, focused: 0, getAttribute: (k) => (k === "aria-label" ? label : null), focus() { e.focused += 1; } };
  return e;
};
const setActive = (a) => { globalThis.document = { activeElement: a }; };
const rootOf = (kids, containsFn) => ({ contains: containsFn || ((n) => kids.includes(n)), querySelectorAll: (sel) => (sel === "[aria-label]" ? kids : []) });

describe("activeLabel", () => {
  test("returns the aria-label of the focused control inside root", () => {
    const a = el("Send");
    setActive(a);
    expect(activeLabel(rootOf([a]))).toBe("Send");
  });
  test("null when the focused element is outside root", () => {
    const a = el("Send");
    setActive(a);
    expect(activeLabel(rootOf([]))).toBeNull();
  });
  test("null when nothing is focused", () => {
    setActive(null);
    expect(activeLabel(rootOf([]))).toBeNull();
  });
  test("a focused control with no label yields null, not undefined", () => {
    const a = { getAttribute: () => null };
    setActive(a);
    expect(activeLabel(rootOf([a]))).toBeNull();
  });
});

describe("focusByLabel", () => {
  test("focuses only the first control carrying the label", () => {
    const a = el("Other"), b = el("Go"), c = el("Go");
    focusByLabel(rootOf([a, b, c]), "Go");
    expect([a.focused, b.focused, c.focused]).toEqual([0, 1, 0]);
  });
  test("a falsy label never touches the DOM", () => {
    const a = el("");
    const root = { querySelectorAll() { throw new Error("must not query"); } };
    focusByLabel(root, null);
    focusByLabel(root, "");
    expect(a.focused).toBe(0);
  });
  test("skips a match without focus() and keeps looking", () => {
    const noFocus = { getAttribute: () => "Go" };
    const b = el("Go");
    focusByLabel(rootOf([noFocus, b]), "Go");
    expect(b.focused).toBe(1);
  });
  test("no match focuses nothing", () => {
    const a = el("A");
    focusByLabel(rootOf([a]), "B");
    expect(a.focused).toBe(0);
  });
});
