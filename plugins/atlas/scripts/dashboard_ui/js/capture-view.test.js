import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { CAPTURE_LINES, captureDisplay, pollCapture } from "./capture-view.js";

test("empty or missing text shows the waiting state", () => {
  expect(captureDisplay({ ok: true, text: "" })).toEqual({ text: "waiting for output", isError: false });
  expect(captureDisplay(null)).toEqual({ text: "waiting for output", isError: false });
});

test("text is shown with trailing blank space trimmed", () => {
  expect(captureDisplay({ ok: true, text: "$ ls\nfile\n\n  " })).toEqual({ text: "$ ls\nfile", isError: false });
});

test("a failure becomes error text and never throws", () => {
  const d = captureDisplay(null, { error: "not_supported", why: "no capture on this backend" });
  expect(d.isError).toBe(true);
  expect(d.text).toContain("no capture on this backend");
});

const until = async (cond, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
};

test("pollCapture with real timers updates, survives a failing fetch, and stops when gone", async () => {
  const seen = [];
  let gone = false;
  let n = 0;
  const stop = pollCapture({
    fetchOnce: async () => { n++; if (n === 2) throw new Error("boom"); return { text: "t" + n }; },
    onUpdate: (d) => seen.push(d.text),
    isHidden: () => false,
    isGone: () => gone,
    ms: 5,
  });
  await until(() => seen.length >= 3);
  expect(seen[0]).toBe("t1");
  expect(seen[1]).toBe("Could not read this terminal: boom");
  expect(seen[2]).toBe("t3");
  gone = true;
  stop();
});

test("pollCapture with real timers skips fetching while hidden", async () => {
  let calls = 0;
  let ticks = 0;
  const stop = pollCapture({ fetchOnce: async () => { calls++; return { text: "x" }; }, onUpdate: () => {}, isHidden: () => { ticks++; return true; }, isGone: () => false, ms: 5 });
  await until(() => ticks >= 3);
  stop();
  expect(calls).toBe(0);
});

test("captureDisplay failure text prefers why, then error, then message, then a generic reason", () => {
  expect(captureDisplay(null, { why: "W", error: "E", message: "M" }).text).toBe("Could not read this terminal: W");
  expect(captureDisplay(null, { error: "E", message: "M" }).text).toBe("Could not read this terminal: E");
  expect(captureDisplay(new Error("ignored"), new Error("M")).text).toBe("Could not read this terminal: M");
  expect(captureDisplay(null, {}).text).toBe("Could not read this terminal: capture failed");
  expect(captureDisplay({ text: "ignored" }, { error: "E" })).toEqual({ text: "Could not read this terminal: E", isError: true });
});

test("captureDisplay ignores a non-string text and only trims trailing whitespace", () => {
  expect(captureDisplay({ text: 42 })).toEqual({ text: "waiting for output", isError: false });
  expect(captureDisplay({ text: "   \n\n" })).toEqual({ text: "waiting for output", isError: false });
  expect(captureDisplay({ text: "  indented\nline  \t\n" })).toEqual({ text: "  indented\nline", isError: false });
});

test("the seat view asks for the last 60 lines", () => {
  expect(CAPTURE_LINES).toBe(60);
});

describe("pollCapture with a manual clock", () => {
  let realSet;
  let realClear;
  let timers;
  beforeEach(() => {
    realSet = globalThis.setInterval;
    realClear = globalThis.clearInterval;
    timers = { fns: [], ms: [], cleared: [] };
    globalThis.setInterval = (fn, ms) => { timers.fns.push(fn); timers.ms.push(ms); return timers.fns.length; };
    globalThis.clearInterval = (id) => { timers.cleared.push(id); };
  });
  afterEach(() => {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  });
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const make = (over = {}) => {
    const updates = [];
    const o = { fetchOnce: async () => ({ text: "hi" }), onUpdate: (d) => updates.push(d), isHidden: () => false, isGone: () => false, ...over };
    const stop = pollCapture(o);
    return { stop, updates };
  };

  test("polls every 2000ms by default, or the ms given, and fetches once immediately", async () => {
    let calls = 0;
    make({ fetchOnce: async () => { calls++; return { text: "a" }; } });
    expect(timers.ms).toEqual([2000]);
    expect(calls).toBe(1);
    make({ ms: 750 });
    expect(timers.ms).toEqual([2000, 750]);
  });

  test("each interval tick publishes the trimmed capture to onUpdate", async () => {
    let n = 0;
    const { updates } = make({ fetchOnce: async () => ({ text: `frame ${++n}\n\n` }) });
    await flush();
    timers.fns[0]();
    await flush();
    expect(updates).toEqual([{ text: "frame 1", isError: false }, { text: "frame 2", isError: false }]);
  });

  test("a slow request is never overlapped; the next tick after it settles fetches again", async () => {
    const resolvers = [];
    let calls = 0;
    make({ fetchOnce: () => { calls++; return new Promise((r) => resolvers.push(r)); } });
    timers.fns[0]();
    timers.fns[0]();
    await flush();
    expect(calls).toBe(1);
    resolvers[0]({ text: "done" });
    await flush();
    timers.fns[0]();
    await flush();
    expect(calls).toBe(2);
  });

  test("a failing fetch becomes error text and the poll keeps going", async () => {
    let n = 0;
    const { updates } = make({ fetchOnce: async () => { n++; if (n === 1) throw Object.assign(new Error("x"), { why: "no pane" }); return { text: "back" }; } });
    await flush();
    timers.fns[0]();
    await flush();
    expect(updates).toEqual([{ text: "Could not read this terminal: no pane", isError: true }, { text: "back", isError: false }]);
  });

  test("hidden ticks skip the fetch and resume when visible again", async () => {
    let hidden = true;
    let calls = 0;
    make({ isHidden: () => hidden, fetchOnce: async () => { calls++; return { text: "x" }; } });
    await flush();
    timers.fns[0]();
    expect(calls).toBe(0);
    hidden = false;
    timers.fns[0]();
    await flush();
    expect(calls).toBe(1);
  });

  test("when the seat is gone the poll stops itself without fetching or updating", async () => {
    let calls = 0;
    const { updates } = make({ isGone: () => true, fetchOnce: async () => { calls++; return { text: "x" }; } });
    await flush();
    expect(timers.cleared).toEqual([1]);
    expect(calls).toBe(0);
    expect(updates).toEqual([]);
  });

  test("stop() clears the timer and later ticks do nothing", async () => {
    let calls = 0;
    const { stop } = make({ fetchOnce: async () => { calls++; return { text: "x" }; } });
    await flush();
    expect(calls).toBe(1);
    stop();
    expect(timers.cleared).toEqual([1]);
    timers.fns[0]();
    await flush();
    expect(calls).toBe(1);
  });
});
