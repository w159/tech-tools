import { test } from "node:test";
import assert from "node:assert/strict";
import * as page from "./pages/health.js";
const data = { subsystems: [{ id: "hooks", label: "Hooks", status: "ok", measured: true, detail: "fine", evidence: [] }] };

test("health: module exports render", () => {
  assert.equal(typeof page.render, "function");
});

test("health: loading state paints skeletons", () => {
  assert.match(page.renderSubsystemsRegion({ loaded: false }), /aria-busy="true"/);
});

test("health: empty list says No subsystems yet.", () => {
  assert.ok(page.renderSubsystemsRegion({ data: { subsystems: [] }, loaded: true }).includes("No subsystems yet."));
});

test("health: error offers Retry", () => {
  const html = page.renderSubsystemsRegion({ data: null, loaded: true, error: "boom" });
  assert.ok(html.includes("Retry"));
  assert.ok(html.includes("boom"));
});

test("health: fixture data yields a row", () => {
  const html = page.renderSubsystemsRegion({ data, loaded: true });
  assert.ok(html.includes("sub-row"));
  assert.ok(!html.includes("No subsystems yet."));
});
