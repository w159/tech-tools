import { test, expect } from "bun:test";
import { captureDisplay, pollCapture } from "./capture-view.js";

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

test("pollCapture updates, survives a failing fetch, and stops when gone", async () => {
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
  await new Promise((r) => setTimeout(r, 40));
  gone = true;
  await new Promise((r) => setTimeout(r, 20));
  const count = seen.length;
  await new Promise((r) => setTimeout(r, 30));
  expect(seen[0]).toBe("t1");
  expect(seen.some((t) => t.includes("boom"))).toBe(true);
  expect(seen.length).toBe(count); // no updates after isGone()
  stop();
});

test("pollCapture skips fetching while hidden", async () => {
  let calls = 0;
  const stop = pollCapture({ fetchOnce: async () => { calls++; return { text: "x" }; }, onUpdate: () => {}, isHidden: () => true, isGone: () => false, ms: 5 });
  await new Promise((r) => setTimeout(r, 30));
  stop();
  expect(calls).toBe(0);
});
