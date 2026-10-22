import { test } from "node:test";
import assert from "node:assert/strict";
import * as page from "./pages/agents.js";
import { mergeAgents } from "./state.js";
const rows = mergeAgents({ agents: [{ name: "impl-a", pane_id: "p1", state: "working", state_changed_at: "2026-10-22T10:00:00Z", kind: "claude", project: "/p/x" }] }, null);

test("agents: module exports render", () => {
  assert.equal(typeof page.render, "function");
});

test("agents: loading state paints skeletons", () => {
  assert.match(page.renderAgentsRegion({ loaded: false }), /aria-busy="true"/);
});

test("agents: empty list says No agents yet.", () => {
  assert.ok(page.renderAgentsRegion({ rows: [], loaded: true }).includes("No agents yet."));
});

test("agents: error offers Retry", () => {
  const html = page.renderAgentsRegion({ rows: [], loaded: true, error: "boom" });
  assert.ok(html.includes("Retry"));
  assert.ok(html.includes("boom"));
});

test("agents: fixture data yields a row", () => {
  const html = page.renderAgentsRegion({ rows, loaded: true });
  assert.ok(html.includes("seat-row"));
  assert.ok(!html.includes("No agents yet."));
});
