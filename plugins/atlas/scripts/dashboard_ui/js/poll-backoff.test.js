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

test("the exponent stops growing at 10 failures, so the delay stays finite for any failure count", () => {
  expect(nextPollDelay(1, 9, null)).toBe(512);
  expect(nextPollDelay(1, 10, null)).toBe(1024);
  expect(nextPollDelay(1, 11, null)).toBe(1024);
  expect(nextPollDelay(1, 500, null)).toBe(1024);
  expect(nextPollDelay(8000, 500, { status: 0 })).toBe(MAX_POLL_BACKOFF_MS);
  expect(MAX_POLL_BACKOFF_MS).toBe(60000);
});

test("backoff doubles per failure and the cap lands exactly at 60s", () => {
  expect([0, 1, 2, 3].map((f) => nextPollDelay(1000, f, { status: 500 }))).toEqual([1000, 2000, 4000, 8000]);
  expect(nextPollDelay(1000, 6, { status: 500 })).toBe(60000);
  expect(nextPollDelay(1000, 5, { status: 500 })).toBe(32000);
  expect(nextPollDelay(30000, 1, { status: 500 })).toBe(60000);
});

test("auth failures stop polling at any failure count; other statuses (even string 401) do not", async () => {
  const { isAuthFailure } = await import("./poll-backoff.js");
  expect(nextPollDelay(8000, 0, { status: 401 })).toBeNull();
  expect(nextPollDelay(8000, 7, { status: 403 })).toBeNull();
  expect(nextPollDelay(8000, 1, { status: "401" })).toBe(16000);
  expect(nextPollDelay(8000, 1, { status: 404 })).toBe(16000);
  expect(isAuthFailure({ status: 400 })).toBe(false);
  expect(isAuthFailure({})).toBe(false);
  expect(isAuthFailure(undefined)).toBe(false);
});

test("the session-expired message tells the user to reload", async () => {
  const { SESSION_EXPIRED_TEXT } = await import("./poll-backoff.js");
  expect(SESSION_EXPIRED_TEXT).toBe("Session expired, reload the page.");
});
