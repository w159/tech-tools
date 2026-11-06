import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installDom, restoreDom } from "./operate-dom-stub.js";

installDom();
const { actionButton, dismissButton } = await import("./health-actions.js");
restoreDom();

const realTimeout = globalThis.setTimeout;
const realNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
let timers;
beforeEach(() => {
  installDom();
  timers = [];
  globalThis.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; };
});
afterEach(() => {
  globalThis.setTimeout = realTimeout;
  if (realNav) Object.defineProperty(globalThis, "navigator", realNav);
  restoreDom();
});
const click = (btn) => Promise.all((btn.listeners.click || []).map((f) => f({})));

describe("actionButton", () => {
  test("no concrete action means no button", () => {
    expect(actionButton({ kind: "x" }, [], () => {})).toBeNull();
  });
  test("a finding opens Improve through navigate, never the clipboard", async () => {
    const seen = [];
    const btn = actionButton({ finding_id: "f 1" }, [], (t) => seen.push(t));
    expect(btn.textContent).toBe("Open in Improve");
    expect(btn.attrs.title).toBe("improve?finding=f%201");
    expect(btn.attrs.class).toBe("btn");
    await click(btn);
    expect(seen).toEqual(["improve?finding=f%201"]);
  });
  test("a copy action copies the text, shows Copied, then restores the label after 2.5s", async () => {
    let written;
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t) => { written = t; } } }, configurable: true, writable: true });
    globalThis.window.isSecureContext = true;
    const btn = actionButton({ session_id: "abc" }, [], () => { throw new Error("no nav"); });
    expect(btn.textContent).toBe("Copy session id");
    await click(btn);
    expect(written).toBe("abc");
    expect(btn.textContent).toBe("Copied");
    expect(timers).toHaveLength(1);
    expect(timers[0][1]).toBe(2500);
    timers[0][0]();
    expect(btn.textContent).toBe("Copy session id");
  });
  test("a failed copy says so", async () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    const mk = globalThis.document.createElement;
    globalThis.document.createElement = (t) => Object.assign(mk(t), { select() {} });
    globalThis.document.execCommand = () => false;
    const btn = actionButton({ session_id: "abc" }, [], () => {});
    await click(btn);
    expect(btn.textContent).toBe("Copy failed: select the text in Do this");
  });
});

describe("dismissButton", () => {
  const mkApi = (impl) => { const calls = []; return { calls, post: async (p, b) => { calls.push([p, b]); return impl ? impl() : {}; } }; };
  test("labels and titles for dismiss vs restore", () => {
    const d = dismissButton({ id: "i" }, mkApi(), () => {});
    expect([d.textContent, d.attrs.title, d.attrs.class]).toEqual(["Dismiss", "Hide until it happens again", "btn btn-ghost"]);
    const r = dismissButton({ id: "i" }, mkApi(), () => {}, true);
    expect([r.textContent, r.attrs.title]).toEqual(["Restore", "Show this item again"]);
  });
  test("dismiss posts the id, disables the button and calls onDone", async () => {
    const api = mkApi();
    let done = 0;
    const btn = dismissButton({ id: "i1" }, api, () => { done++; });
    await click(btn);
    expect(api.calls).toEqual([["/api/v2/dismiss", { id: "i1" }]]);
    expect(btn.disabled).toBe(true);
    expect(done).toBe(1);
  });
  test("restore posts undo:true", async () => {
    const api = mkApi();
    await click(dismissButton({ id: "i1" }, api, () => {}, true));
    expect(api.calls[0][1]).toEqual({ id: "i1", undo: true });
  });
  test("a server error re-enables the button and shows the server's message", async () => {
    const btn = dismissButton({ id: "i" }, mkApi(() => { throw { error: "boom" }; }), () => { throw new Error("must not finish"); });
    await click(btn);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Failed: boom");
  });
  test("an error without a message says retry", async () => {
    const btn = dismissButton({ id: "i" }, mkApi(() => { throw new Error(); }), () => {});
    await click(btn);
    expect(btn.textContent).toBe("Failed: retry");
  });
});
