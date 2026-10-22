import { test } from "node:test";
import assert from "node:assert/strict";
import * as page from "./pages/channels.js";
const messages = [{ ts: "2026-10-22T10:00:00Z", from: "impl-a", to: "all", body: "hello", kind: "note" }];

test("channels: module exports render", () => {
  assert.equal(typeof page.render, "function");
});

test("channels: loading state paints skeletons", () => {
  assert.match(page.renderFeedRegion({ loaded: false }), /aria-busy="true"/);
});

test("channels: empty list says No messages yet.", () => {
  assert.ok(page.renderFeedRegion({ messages: [], loaded: true }).includes("No messages yet."));
});

test("channels: error offers Retry", () => {
  const html = page.renderFeedRegion({ messages: [], loaded: true, error: "boom" });
  assert.ok(html.includes("Retry"));
  assert.ok(html.includes("boom"));
});

test("channels: fixture data yields a row", () => {
  const html = page.renderFeedRegion({ messages, loaded: true });
  assert.ok(html.includes("feed-row"));
  assert.ok(!html.includes("No messages yet."));
});
