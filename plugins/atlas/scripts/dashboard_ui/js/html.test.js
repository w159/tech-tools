import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { esc } from "./html.js";

test("esc escapes all five HTML-significant characters", () => {
  assert.equal(esc(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(0), "0");
});

test("former duplicate call sites import the shared helper", () => {
  for (const f of [
    "region-state.js",
    "band.js",
    "pages/run.js",
    "pages/board.js",
  ]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(
      src,
      /import\s*\{[^}]*\besc\b[^}]*\}\s*from\s*"\.\.?\/html\.js"/,
      `${f} imports esc from html.js`,
    );
    assert.doesNotMatch(
      src,
      /const esc = \((s|v)\)/,
      `${f} has no local HTML esc copy`,
    );
  }
});

test("region-state output escapes single quotes via the shared helper", async () => {
  const { renderRegionState } = await import("./region-state.js");
  assert.ok(!renderRegionState("error", "x", "it's").includes("it's"));
});
