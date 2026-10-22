import { test } from "node:test";
import assert from "node:assert/strict";
import * as page from "./pages/settings.js";
const data = { projects: [{ root: "/p/x", name: "x", last_active: "2026-10-22T10:00:00Z", runs_7d: 2, health: "ok" }] };

test("settings: module exports render", () => {
  assert.equal(typeof page.render, "function");
});

test("settings: loading state paints skeletons", () => {
  assert.match(page.renderProjectsRegion({ loaded: false }), /aria-busy="true"/);
});

test("settings: empty list says No projects yet.", () => {
  assert.ok(page.renderProjectsRegion({ data: { projects: [] }, loaded: true }).includes("No projects yet."));
});

test("settings: error offers Retry", () => {
  const html = page.renderProjectsRegion({ data: null, loaded: true, error: "boom" });
  assert.ok(html.includes("Retry"));
  assert.ok(html.includes("boom"));
});

test("settings: fixture data yields a row", () => {
  const html = page.renderProjectsRegion({ data, loaded: true });
  assert.ok(html.includes("proj-row"));
  assert.ok(!html.includes("No projects yet."));
});
