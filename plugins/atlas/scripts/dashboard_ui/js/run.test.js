import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderSeats, renderFeed, renderNeeds, renderGates, renderMetrics, renderSteerError } from "./pages/run.js";
import { renderRegionState } from "./region-state.js";
import { renderBand } from "./band.js";
import { toSeats, toFeed, toNeeds, toGates, toMetrics } from "./run-data.js";

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));
const overview = fx("overview");
const agents = fx("agents");
const colony = fx("colony");
const channel = fx("channel");
const gates = fx("gates");
const NOW = Date.parse("2026-10-22T17:00:00Z");
const count = (s, re) => (s.match(re) || []).length;

test("seats: one selected row, letters L and I, spinner only on running", () => {
  const seats = toSeats(agents, colony, NOW);
  const html = renderSeats(seats, "impl-cc15-t4", { frame: 0 });
  assert.equal(count(html, /class="seat sel"/g), 1);
  assert.equal(count(html, /class="seat"/g), seats.length - 1);
  assert.match(html, /class="rl">L</);
  assert.match(html, /class="rl">I</);
  const running = seats.filter((s) => s.state === "running").length;
  assert.equal(count(html, /class="spin"/g), running);
});

test("seats: names are escaped", () => {
  const html = renderSeats([{ name: "<b>x</b>", letter: "I", state: "idle", glyph: "o", tool: "", elapsedCells: 0, age: "" }], null, {});
  assert.ok(!html.includes("<b>x"));
});

test("feed: needs row carries ev need and a daymark; rows are escaped", () => {
  const rows = toFeed(channel.messages);
  const need = { ...rows[0], key: "n1", needs: true, text: "<i>stuck</i>" };
  const html = renderFeed([...rows, need], null);
  assert.match(html, /class="ev need"/);
  assert.match(html, /class="daymark"/);
  assert.ok(!html.includes("<i>stuck"));
  assert.equal(count(html, /class="ev( need| phase)?"/g), rows.length + 1);
});

test("feed: filter keeps only the selected sender", () => {
  const rows = toFeed(channel.messages);
  const who = rows[0].from;
  const html = renderFeed(rows, who);
  assert.equal(count(html, /class="ev( need| phase)?"/g), rows.filter((r) => r.from === who).length);
});

test("needs: Answer for waiting, Open for warnings, red class for failing", () => {
  const items = [
    { key: "a", title: "impl-x", detail: "d", state: "waiting", stateLine: "waiting 6m", actions: [{ label: "Open", target: "agents#a" }] },
    { key: "b", title: "doctor", detail: "d", state: "warning", stateLine: "warning 1m", actions: [{ label: "Open", target: "health#b" }] },
    { key: "c", title: "boom", detail: "d", state: "failing", stateLine: "failing", actions: [] },
  ];
  const html = renderNeeds(items);
  assert.match(html, /Answer/);
  assert.match(html, /href="#\/health\?focus=b"|href="#\/health/);
  assert.match(html, /class="need failing"/);
  assert.equal(count(html, /class="need /g), 3);
});

test("needs: more than five items link to Health", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ key: String(i), title: "t", detail: "", state: "warning", stateLine: "warning", actions: [] }));
  const html = renderNeeds(many);
  assert.equal(count(html, /class="need /g), 5);
  assert.match(html, /2 more in Health/);
});

test("gates: one gate ok per passing line, failing shows fix", () => {
  const chips = toGates(gates);
  const html = renderGates(chips);
  assert.equal(count(html, /class="gate ok"/g), chips.filter((c) => c.ok).length);
  assert.equal(count(html, /class="gate open"/g), chips.filter((c) => !c.ok).length);
  assert.match(html, /add a CHANGELOG entry/);
});

test("metrics: five rows, 13 cells each, tone class", () => {
  const rows = toMetrics(overview);
  const html = renderMetrics(rows);
  assert.equal(count(html, /class="mrow /g), 5);
  for (const m of html.matchAll(/class="mbar[^"]*"><b>([^<]*)<\/b><i>([^<]*)<\/i>/g)) {
    assert.equal(m[1].length + m[2].length, 13);
  }
  assert.equal(count(html, /class="mbar/g), 5);
});

test("needs list from fixtures renders without NaN or undefined", () => {
  const html = renderNeeds(toNeeds(overview, { agents: [] }, NOW));
  assert.doesNotMatch(html, /NaN|undefined|null/);
});

test("region states", () => {
  assert.match(renderRegionState("empty", "seats"), /No seats yet\./);
  assert.match(renderRegionState("empty", "messages"), /No messages yet\./);
  const err = renderRegionState("error", "channel", "timeout");
  assert.match(err, /timeout/);
  assert.match(err, /<button class="btn" data-action="retry">Retry<\/button>/);
  assert.equal(count(renderRegionState("loading", "seats"), /class="skel"/g), 3);
  assert.ok(!renderRegionState("error", "x", "<script>").includes("<script>"));
});

test("band: projectOptions renders a select with the selected option", () => {
  const html = renderBand({
    project: "tech-tools", branch: "main", lead: "", phase: "research", n: null, m: null,
    counts: { working: 0, needs: 0, failed: 0, parked: 0 }, live: "live", clock: "", narrow: false, route: "run",
    projectOptions: [{ value: "all", label: "all projects" }, { value: "/r/tech-tools", label: "tech-tools", selected: true }],
  });
  assert.match(html, /<select class="proj"/);
  assert.match(html, /<option value="\/r\/tech-tools" selected>tech-tools<\/option>/);
  assert.equal(count(html, /<option /g), 2);
});

test("steer error: the inline renderer prints the server message, escaped", () => {
  assert.equal(renderSteerError({ ok: false, error: "agent_busy", message: "seat is held" }), "seat is held");
  assert.equal(renderSteerError({ ok: false, error: "x", message: "<b>no</b>" }).includes("<b>"), false);
  assert.equal(renderSteerError({ ok: false, error: "agent_busy" }), "agent_busy");
});

test("app.js no longer maps run to the v14 overview page", () => {
  const src = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.ok(!src.includes("PAGE_MODULE"));
});

test("run page sources have no literal non-ASCII characters", () => {
  for (const f of ["pages/run.js", "steer.js", "region-state.js"]) {
    assert.equal(/[^\x00-\x7F]/.test(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")), false, f);
  }
});
