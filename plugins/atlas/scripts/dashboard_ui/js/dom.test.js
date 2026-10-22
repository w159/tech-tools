import test from "node:test";
import assert from "node:assert/strict";
import { relTime, duration, num, delta, truncate, baseName } from "./dom.js";

const NOW = Date.parse("2026-01-01T12:00:00Z");

test("relTime gives compact ages", () => {
  assert.equal(relTime("2026-01-01T11:59:55Z", NOW), "just now");
  assert.equal(relTime("2026-01-01T11:59:30Z", NOW), "30s");
  assert.equal(relTime("2026-01-01T11:56:00Z", NOW), "4m");
  assert.equal(relTime("2026-01-01T09:00:00Z", NOW), "3h");
  assert.equal(relTime("2025-12-29T12:00:00Z", NOW), "3d");
  assert.equal(relTime(null, NOW), "");
  assert.equal(relTime("garbage", NOW), "");
});

test("duration", () => {
  assert.equal(duration(12), "12s");
  assert.equal(duration(245), "4m 05s");
  assert.equal(duration(7800), "2h 10m");
  assert.equal(duration(null), "");
});

test("num and delta", () => {
  assert.equal(num(1234567), "1,234,567");
  assert.equal(num(null), "-");
  assert.equal(delta(12), "+12");
  assert.equal(delta(-3), "-3");
  assert.equal(delta(0), "0");
  assert.equal(delta(1.25), "+1.3");
  assert.equal(delta(null), "");
});

test("truncate uses three plain periods", () => {
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("abcdefghij", 8), "abcde...");
  assert.equal(truncate(null), "");
});

test("baseName", () => {
  assert.equal(baseName("/Users/a/proj/"), "proj");
  assert.equal(baseName("proj"), "proj");
});
