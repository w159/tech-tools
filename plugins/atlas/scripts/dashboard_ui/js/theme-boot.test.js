import { test, expect, describe, afterEach } from "bun:test";

const KEYS = ["document", "location", "window", "localStorage"];
const saved = {};
for (const k of KEYS) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
    else delete globalThis[k];
  }
});

let n = 0;
// Evaluates the boot IIFE afresh against stubbed globals; returns the attributes it set on <html>.
async function boot({ search = "", prefs, rail, framed = false, crossOrigin = false, storageThrows = false } = {}) {
  const attrs = {};
  const root = { setAttribute: (k, v) => { attrs[k] = v; } };
  const store = { "atlas.dashboard.prefs": prefs === undefined ? null : typeof prefs === "string" ? prefs : JSON.stringify(prefs), "atlas.rail": rail ?? null };
  Object.defineProperty(globalThis, "document", { value: { documentElement: root }, configurable: true, writable: true });
  Object.defineProperty(globalThis, "location", { value: { search }, configurable: true, writable: true });
  const self = {};
  const win = { self };
  Object.defineProperty(win, "top", { get() { if (crossOrigin) throw new Error("SecurityError"); return framed ? {} : self; } });
  Object.defineProperty(globalThis, "window", { value: win, configurable: true, writable: true });
  Object.defineProperty(globalThis, "localStorage", { value: { getItem: (k) => { if (storageThrows) throw new Error("blocked"); return store[k]; } }, configurable: true, writable: true });
  await import("./theme-boot.js?boot=" + ++n);
  return attrs;
}

describe("theme-boot", () => {
  test("top-level page with no prefs is the app shell and sets nothing else", async () => {
    expect(await boot()).toEqual({ "data-shell": "app" });
  });
  test("?embed=1 selects the framed shell", async () => {
    expect((await boot({ search: "?embed=1" }))["data-shell"]).toBe("framed");
  });
  test("being inside a frame selects the framed shell", async () => {
    expect((await boot({ framed: true }))["data-shell"]).toBe("framed");
  });
  test("a cross-origin parent (window.top throws) counts as framed", async () => {
    expect((await boot({ crossOrigin: true }))["data-shell"]).toBe("framed");
  });
  test("saved prefs and rail apply", async () => {
    const a = await boot({ prefs: { theme: "light", density: "compact" }, rail: "collapsed" });
    expect(a).toEqual({ "data-shell": "app", "data-theme": "light", "data-density": "compact", "data-rail": "collapsed" });
  });
  test("query overrides the saved prefs for this load", async () => {
    const a = await boot({ search: "?theme=dark&density=comfortable", prefs: { theme: "light", density: "compact" } });
    expect(a["data-theme"]).toBe("dark");
    expect(a["data-density"]).toBe("comfortable");
  });
  test("system theme and expanded rail are accepted", async () => {
    const a = await boot({ prefs: { theme: "system" }, rail: "expanded" });
    expect(a["data-theme"]).toBe("system");
    expect(a["data-rail"]).toBe("expanded");
  });
  test("unknown values are never written to the document", async () => {
    const a = await boot({ search: "?theme=neon&density=huge", rail: "sideways" });
    expect(a).toEqual({ "data-shell": "app" });
  });
  test("corrupt or null prefs JSON falls back to defaults", async () => {
    expect(await boot({ prefs: "{not json" })).toEqual({ "data-shell": "app" });
    expect(await boot({ prefs: "null" })).toEqual({ "data-shell": "app" });
  });
  test("blocked storage still sets the shell and nothing throws", async () => {
    expect(await boot({ storageThrows: true, search: "?embed=1" })).toEqual({ "data-shell": "framed" });
  });
  test("blocked storage also drops the query theme (prefs and query share one try block)", async () => {
    // documents the current contract: prefs parsing and the query share one try block
    expect(await boot({ storageThrows: true, search: "?theme=light" })).toEqual({ "data-shell": "app" });
  });
});
