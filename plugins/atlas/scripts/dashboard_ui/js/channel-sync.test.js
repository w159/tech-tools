import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { startChannelSync, FALLBACK_MS } from "./channel-sync.js";

const fakeStore = (conn = "live") => {
  const subs = new Set();
  const evs = new Set();
  return {
    subscribe: (fn) => { subs.add(fn); fn({ conn }); return () => subs.delete(fn); },
    onEvent: (fn) => { evs.add(fn); return () => evs.delete(fn); },
    setConn: (c) => subs.forEach((fn) => fn({ conn: c })),
    emit: (name) => evs.forEach((fn) => fn(name)),
    listeners: () => subs.size + evs.size,
  };
};
const fakeTimers = () => {
  const t = { live: new Map(), n: 0, cleared: [], set: (fn, ms) => { t.live.set(++t.n, { fn, ms }); return t.n; }, clear: (id) => { t.cleared.push(id); t.live.delete(id); } };
  return t;
};
const fire = (timers) => [...timers.live.values()].forEach((v) => v.fn());

describe("startChannelSync", () => {
  let savedDoc;
  beforeEach(() => { savedDoc = globalThis.document; globalThis.document = { hidden: false }; });
  afterEach(() => { globalThis.document = savedDoc; });

  test("the fallback interval is 30 seconds unless overridden", () => {
    expect(FALLBACK_MS).toBe(30000);
    const timers = fakeTimers();
    startChannelSync({ store: fakeStore("poll"), refresh() {}, timers });
    startChannelSync({ store: fakeStore("poll"), refresh() {}, fallbackMs: 1234, timers });
    expect([...timers.live.values()].map((v) => v.ms)).toEqual([30000, 1234]);
  });

  test("a fallback tick refreshes when the page is visible and skip() allows it", () => {
    const timers = fakeTimers();
    let calls = 0;
    startChannelSync({ store: fakeStore("poll"), refresh: () => { calls++; }, timers });
    fire(timers);
    fire(timers);
    expect(calls).toBe(2);
  });

  test("a fallback tick does nothing while the tab is hidden, and resumes when visible", () => {
    const timers = fakeTimers();
    let calls = 0;
    startChannelSync({ store: fakeStore("poll"), refresh: () => { calls++; }, timers });
    globalThis.document.hidden = true;
    fire(timers);
    expect(calls).toBe(0);
    globalThis.document.hidden = false;
    fire(timers);
    expect(calls).toBe(1);
  });

  test("a fallback tick still refreshes where there is no document at all", () => {
    globalThis.document = undefined;
    const timers = fakeTimers();
    let calls = 0;
    startChannelSync({ store: fakeStore("poll"), refresh: () => { calls++; }, timers });
    fire(timers);
    expect(calls).toBe(1);
  });

  test("skip() is consulted on every tick and on irc events, in both paths", () => {
    const timers = fakeTimers();
    const store = fakeStore("poll");
    let calls = 0;
    let skipping = true;
    startChannelSync({ store, refresh: () => { calls++; }, skip: () => skipping, timers });
    fire(timers);
    store.emit("irc");
    expect(calls).toBe(0);
    skipping = false;
    fire(timers);
    store.emit("irc");
    expect(calls).toBe(2);
  });

  test("only the irc event refreshes; other event names are ignored", () => {
    const store = fakeStore("live");
    let calls = 0;
    startChannelSync({ store, refresh: () => { calls++; }, timers: fakeTimers() });
    for (const name of ["herd", "colony", "IRC", "", undefined]) store.emit(name);
    expect(calls).toBe(0);
    store.emit("irc");
    expect(calls).toBe(1);
  });

  test("repeated non-live states keep one timer; going live clears exactly that timer", () => {
    const timers = fakeTimers();
    const store = fakeStore("idle");
    startChannelSync({ store, refresh() {}, timers });
    expect(timers.live.size).toBe(1);
    store.setConn("poll");
    store.setConn("reconnecting");
    expect(timers.live.size).toBe(1);
    expect(timers.n).toBe(1);
    store.setConn("live");
    expect(timers.cleared).toEqual([1]);
    expect(timers.live.size).toBe(0);
    store.setConn("live");
    expect(timers.cleared).toEqual([1]);
    store.setConn("poll");
    expect(timers.n).toBe(2);
    expect(timers.live.size).toBe(1);
  });

  test("stop() unsubscribes both listeners and clears a running timer (and is quiet when none runs)", () => {
    const timers = fakeTimers();
    const down = fakeStore("poll");
    const stop = startChannelSync({ store: down, refresh() {}, timers });
    stop();
    expect(timers.cleared).toEqual([1]);
    expect(down.listeners()).toBe(0);
    const up = fakeStore("live");
    const timers2 = fakeTimers();
    startChannelSync({ store: up, refresh() {}, timers: timers2 })();
    expect(timers2.cleared).toEqual([]);
    expect(up.listeners()).toBe(0);
    // after stop, a late timer firing is not our concern, but a later store event must not refresh
    let calls = 0;
    const s3 = fakeStore("live");
    const stop3 = startChannelSync({ store: s3, refresh: () => { calls++; }, timers: fakeTimers() });
    stop3();
    s3.emit("irc");
    expect(calls).toBe(0);
  });

  test("the default timers use the global setInterval/clearInterval, called detached (no Illegal invocation)", () => {
    const realSet = globalThis.setInterval;
    const realClear = globalThis.clearInterval;
    const log = [];
    globalThis.setInterval = function (fn, ms) { log.push(["set", this === undefined || this === globalThis, ms]); return 77; };
    globalThis.clearInterval = function (id) { log.push(["clear", id]); };
    try {
      const store = fakeStore("poll");
      const stop = startChannelSync({ store, refresh() {}, fallbackMs: 4321 });
      store.setConn("live");
      store.setConn("poll");
      stop();
    } finally {
      globalThis.setInterval = realSet;
      globalThis.clearInterval = realClear;
    }
    expect(log).toEqual([["set", true, 4321], ["clear", 77], ["set", true, 4321], ["clear", 77]]);
  });
});
