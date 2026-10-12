import { test, expect } from "bun:test";
import { nextPollDelay, MAX_POLL_BACKOFF_MS } from "./poll-backoff.js";

test("healthy poll keeps its interval", () => expect(nextPollDelay(8000, 0, null)).toBe(8000));
test("network errors back off exponentially, capped at 60s", () => {
  expect(nextPollDelay(8000, 1, { status: 0 })).toBe(16000);
  expect(nextPollDelay(8000, 2, { status: 0 })).toBe(32000);
  expect(nextPollDelay(8000, 9, { status: 0 })).toBe(MAX_POLL_BACKOFF_MS);
});
test("401 and 403 stop polling", () => {
  expect(nextPollDelay(8000, 1, { status: 401 })).toBeNull();
  expect(nextPollDelay(8000, 1, { status: 403 })).toBeNull();
});

test("no error object, with or without failures", () => {
  expect(nextPollDelay(8000, 0, undefined)).toBe(8000);
  expect(nextPollDelay(8000, 1, null)).toBe(16000);
});
test("isAuthFailure", async () => {
  const { isAuthFailure } = await import("./poll-backoff.js");
  expect([isAuthFailure(null), isAuthFailure({ status: 500 }), isAuthFailure({ status: 403 })]).toEqual([false, false, true]);
});
