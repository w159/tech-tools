import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  toBand,
  toSeats,
  toFeed,
  toNeeds,
  toGates,
  toMetrics,
  leadSessionId,
} from "./run-data.js";
import { STATE_GLYPH, roleLetter } from "./glyph-table.js";

const fx = (n) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"),
  );
const overview = fx("overview");
const agents = fx("agents");
const colony = fx("colony");
const channel = fx("channel");
const gates = fx("gates");
const NOW = Date.parse("2026-10-22T17:00:00Z");

test("fixtures carry no home path", () => {
  for (const n of ["overview", "agents", "colony", "channel", "gates"]) {
    const raw = readFileSync(
      new URL(`./fixtures/${n}.json`, import.meta.url),
      "utf8",
    );
    assert.ok(!raw.includes("/Users/jerry"), n);
  }
});

test("toSeats: one row per agent when no colony", () => {
  const seats = toSeats(agents, { ok: false }, NOW);
  assert.equal(seats.length, agents.agents.length);
  for (const s of seats) {
    assert.equal(s.glyph, STATE_GLYPH[s.state] || STATE_GLYPH.idle);
    assert.equal(s.letter, roleLetter(s.role));
    assert.ok(s.elapsedCells >= 0 && s.elapsedCells <= 8);
  }
});

test("toSeats: one row per colony member, letter and glyph from the tables", () => {
  const seats = toSeats(agents, colony, NOW);
  assert.equal(seats.length, colony.members.length);
  const lead = seats.find((s) => s.lead);
  assert.equal(lead.name, colony.lead.name);
  assert.equal(lead.letter, "L");
  const impl = seats.find((s) => s.name === "impl-cc15-t4");
  assert.equal(impl.role, "implementer");
  assert.equal(impl.letter, "I");
  assert.equal(impl.glyph, STATE_GLYPH.running);
  const parked = seats.find((s) => s.name === "explorer-plan-facts");
  assert.equal(parked.state, "parked");
  assert.equal(parked.glyph, STATE_GLYPH.parked);
});

test("toSeats: elapsedCells is one per 7.5 minutes, capped at 8", () => {
  const m = (secAgo) => ({
    ok: true,
    members: [
      { name: "impl-x", kind: "worker", state: "running", last_active: NOW / 1000 - secAgo },
    ],
  });
  assert.equal(toSeats({}, m(0), NOW)[0].elapsedCells, 0);
  assert.equal(toSeats({}, m(450), NOW)[0].elapsedCells, 1);
  assert.equal(toSeats({}, m(3 * 3600), NOW)[0].elapsedCells, 8);
  assert.equal(toSeats({}, m(450), NOW)[0].age, "7m");
});

test("toFeed: dedupes a fixture concatenated with itself, sorted by ts", () => {
  const rows = toFeed(channel.messages);
  assert.equal(toFeed([...channel.messages, ...channel.messages]).length, rows.length);
  assert.equal(rows.length, channel.messages.length);
  const ts = rows.map((r) => Date.parse(r.t));
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
  assert.ok(rows.every((r) => r.key && r.from && typeof r.needs === "boolean"));
});

test("toFeed: dedupe key prefers seq, then id, then ts+from+text", () => {
  const a = { seq: 1, id: "x", ts: "2026-01-01T00:00:00Z", from: "a", body: "t" };
  const b = { seq: 1, id: "y", ts: "2026-01-01T00:00:01Z", from: "b", body: "u" };
  assert.equal(toFeed([a, b]).length, 1);
  const c = { ts: "2026-01-01T00:00:00Z", from: "a", text: "t" };
  assert.equal(toFeed([c, { ...c }]).length, 1);
  assert.equal(toFeed(null).length, 0);
});

test("toFeed: pulls the phase from an ATLAS header in the text", () => {
  const [r] = toFeed([
    { id: "1", ts: "2026-01-01T00:00:00Z", from: "lead", body: "ATLAS | x implement 2/5 | go" },
  ]);
  assert.equal(r.phase, "implement");
});

test("toNeeds: since null gives a stateLine without NaN or undefined", () => {
  const ov = { attention: [{ severity: "warn", title: "t", detail: "d", first: null, action: { label: "Open", target: "health#1" } }] };
  const ag = { agents: [{ key: "k", name: "n", state: "input", project: "p", state_changed_at: null }] };
  const items = toNeeds(ov, ag, NOW);
  assert.equal(items.length, 2);
  for (const it of items) {
    assert.doesNotMatch(it.stateLine, /NaN|undefined/);
    assert.match(it.stateLine, /^(waiting|failing|warning)/);
  }
  assert.equal(items[0].state, "waiting");
  assert.equal(items[0].stateLine, "waiting");
  assert.deepEqual(items[1].actions, [{ label: "Open", target: "health#1" }]);
});

test("toNeeds: duration appears when since parses; unparsable since omits it", () => {
  const ag = (since) => ({ agents: [{ key: "k", name: "n", state: "input", state_changed_at: since }] });
  assert.equal(toNeeds({}, ag("2026-10-22T16:54:00Z"), NOW)[0].stateLine, "waiting 6m");
  assert.equal(toNeeds({}, ag("garbage"), NOW)[0].stateLine, "waiting");
});

test("toNeeds: live overview fixture maps every attention item", () => {
  const items = toNeeds(overview, { agents: [] }, NOW);
  assert.equal(items.length, overview.attention.length);
  assert.ok(items.every((i) => i.title && !/NaN|undefined/.test(i.stateLine)));
});

test("toBand: colony ok:false gives research and null n", () => {
  const b = toBand(overview, { ok: false }, null);
  assert.equal(b.phase, "research");
  assert.equal(b.n, null);
  assert.equal(b.m, null);
  assert.deepEqual(b.counts, { working: 0, needs: 0, failed: 0, parked: 0 });
});

test("toBand: live colony, header parsed from the last ATLAS line", () => {
  const header = "noise\nATLAS | x implement 2/5 | a\nATLAS | x verify 3/5 | b\ntail";
  const b = toBand(overview, colony, header);
  assert.equal(b.phase, "verify");
  assert.equal(b.n, 3);
  assert.equal(b.m, 5);
  assert.equal(b.lead, colony.lead.name);
  assert.equal(b.branch, "main");
  assert.equal(b.project, "tech-tools");
  assert.equal(b.counts.working, 2);
  assert.equal(b.counts.parked, 1);
  assert.equal(b.counts.needs, overview.attention.length);
  assert.deepEqual(Object.keys(b).sort(), ["branch", "counts", "lead", "m", "n", "phase", "project"]);
  assert.equal(toBand(overview, colony, "ATLAS | x done | ok").n, null);
  assert.equal(toBand(overview, colony, "not a header").phase, "research");
});

test("toMetrics: five rows in spec order, cells 0..13", () => {
  const rows = toMetrics(overview);
  assert.deepEqual(rows.map((r) => r.id), ["runs", "dispatches", "silent_failures", "tool_errors", "findings_open"]);
  for (const r of rows) assert.ok(r.cells >= 0 && r.cells <= 13);
  assert.equal(Math.max(...rows.map((r) => r.cells)), 13);
  const runs = rows[0];
  assert.equal(runs.n, 354);
  assert.equal(runs.delta, "-47.6%");
  assert.equal(runs.tone, "dn");
  assert.equal(rows[2].tone, "up");
  assert.equal(rows[1].tone, "flat");
});

test("toMetrics: rising errors are bad, missing kpis give n null, empty max gives 0 cells", () => {
  const ov = { kpis: [{ id: "silent_failures", value: 3, delta: 10 }, { id: "runs", value: 0, delta: 0 }] };
  const rows = toMetrics(ov);
  assert.equal(rows[2].tone, "bad");
  assert.equal(rows[2].delta, "+10.0%");
  assert.equal(rows[1].n, null);
  assert.equal(rows[0].delta, "0");
  assert.equal(toMetrics({}).every((r) => r.n === null && r.cells === 0), true);
});

test("toGates: chips mirror the real route lines (id, ok, detail, fix)", () => {
  const chips = toGates(gates);
  assert.equal(chips.length, gates.lines.length);
  chips.forEach((c, i) => {
    assert.equal(c.ok, gates.lines[i].ok);
    assert.equal(c.letter, gates.lines[i].id);
    assert.equal(c.message, gates.lines[i].detail || "");
    assert.equal(c.fix, gates.lines[i].fix);
  });
  assert.equal(chips.filter((c) => !c.ok).length, 1);
  assert.deepEqual(toGates({ ok: false }), []);
});

test("leadSessionId: by name, else kind lead, else null", () => {
  const ag = { agents: [{ name: "w", session_id: "s1" }, { name: "lead-1", kind: "lead", session_id: "s2" }] };
  assert.equal(leadSessionId(ag, { lead: { name: "w" } }), "s1");
  assert.equal(leadSessionId(ag, { ok: false }), "s2");
  assert.equal(leadSessionId(agents, colony), null);
  assert.equal(leadSessionId(null, null), null);
});
