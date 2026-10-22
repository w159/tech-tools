import test from "node:test";
import assert from "node:assert/strict";
import { renderBand } from "./band.js";

const model = {
  project: "atlas",
  branch: "worker/cc15",
  lead: "lead-17b803",
  phase: "implement",
  n: 3,
  m: 5,
  counts: { working: 2, needs: 1, failed: 0, parked: 4 },
  live: "live",
  clock: "12:00:00",
  narrow: false,
};
const count = (s, re) => (s.match(re) || []).length;

test("current pill shows NAME n/m, past and future pills counted", () => {
  const html = renderBand(model);
  assert.match(html, /class="pill now"[^>]*>[^]*IMPLEMENT 3\/5/);
  assert.equal(count(html, /class="pill past"/g), 4);
  assert.equal(count(html, /class="pill future"/g), 2);
  assert.ok(html.includes("1 needs you"));
  assert.ok(html.includes("atlas") && html.includes("worker/cc15") && html.includes("lead-17b803"));
});

test("narrow renders only the current pill", () => {
  assert.equal(count(renderBand({ ...model, narrow: true }), /class="pill/g), 1);
});

test("live word comes from LIVE_WORD", () => {
  assert.ok(renderBand({ ...model, live: "reconnecting" }).includes("Reconnecting"));
});

test("null n/m, branch and lead are omitted", () => {
  const html = renderBand({ ...model, n: null, m: null, branch: null, lead: null });
  assert.ok(html.includes("IMPLEMENT</"));
  assert.ok(!html.includes("null"));
});

test("six route tabs render", () => {
  assert.equal(count(renderBand(model), /data-route="/g), 6);
});

test("model strings are escaped", () => {
  assert.ok(!renderBand({ ...model, project: "<b>x</b>" }).includes("<b>x"));
});

test("counts and live marker are CSS dots, not glyph characters", () => {
  const html = renderBand({ ...model, counts: { ...model.counts, working: 1 } });
  assert.ok(html.includes('class="dot working pulse"'));
  assert.ok(html.includes('class="dot ok"'));
  assert.ok(!html.includes("\u25B6"));
  assert.ok(!html.includes('class="dot working pulse"') || !renderBand(model).includes("dot working pulse") === false);
  assert.ok(!renderBand({ ...model, counts: { ...model.counts, working: 0 } }).includes("working pulse"));
  assert.ok(renderBand(model).includes("<svg"));
});

test("band.js source has no literal non-ASCII characters", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./band.js", import.meta.url), "utf8");
  assert.equal(/[^\x00-\x7F]/.test(src), false);
});
