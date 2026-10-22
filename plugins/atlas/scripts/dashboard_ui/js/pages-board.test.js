import { test } from "node:test";
import assert from "node:assert/strict";
import * as page from "./pages/board.js";
const state = { phases: [{ name: "p", items: [{ id: "1", status: "open", content: "Do the thing", phase: "p", updated: "2026-10-22T10:00:00Z" }] }] };

test("board: module exports render", () => {
  assert.equal(typeof page.render, "function");
});

test("board: loading state paints skeletons", () => {
  assert.match(page.renderBoardRegion({ loaded: false }), /aria-busy="true"/);
});

test("board: empty list says No tasks yet.", () => {
  assert.ok(page.renderBoardRegion({ state: { phases: [] }, loaded: true }).includes("No tasks yet."));
});

test("board: error offers Retry", () => {
  const html = page.renderBoardRegion({ state: null, loaded: true, error: "boom" });
  assert.ok(html.includes("Retry"));
  assert.ok(html.includes("boom"));
});

test("board: fixture data yields a row", () => {
  const html = page.renderBoardRegion({ state, loaded: true });
  assert.ok(html.includes("task-row"));
  assert.ok(!html.includes("No tasks yet."));
});
