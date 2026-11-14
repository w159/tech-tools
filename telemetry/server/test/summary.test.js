// @ts-check
// The owner's three questions on realistic data: what is unused, what fails, what to build next.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSummary } from "../lib/summary.js";
import { PAST_WEEK } from "./helpers.js";

const KEYS = [
  "session.claude",
  "skill.atlas-plan",
  "skill.atlas-review",
  "skill.atlas-ship",
  "skill.atlas-wiki",
  "command.atlas-plan",
  "command.atlas-review",
  "command.atlas-ship",
  "command.atlas-wiki",
  "hook.git_guard.ask",
  "hook.git_guard.ask.protected",
  "hook.git_guard.deny",
  "hook.git_guard.deny.protected",
  "hook.format_after_edit.fault",
  "hook.silent_hook.deny",
  "gate.m.block",
  "gate.n.block",
  "gate.pass",
  "fault.format_after_edit.timeout",
  "delivery.fail.network",
  "delivery.ok.urllib",
  "team.outcome.done",
  "team.outcome.failed",
  "dispatch.PreToolUse.ms.lt50",
  "dispatch.PreToolUse.ms.ge1000",
];
const sub = (/** @type {Record<string, number>} */ counts, partial = false) => ({
  schema: 3, atlas_version: "17.20.0", os: "linux", python: "3.13", week: PAST_WEEK, nonce: "x", partial, counts,
});
// Three installs, 24 sessions, 34 finishes of which 9 were blocked.
const SUBS = [
  sub({ "session.claude": 10, "skill.atlas-plan": 4, "command.atlas-review": 3, "command.atlas-ship": 2, "hook.git_guard.ask": 2, "hook.git_guard.ask.protected": 2, "hook.format_after_edit.fault": 1, "fault.format_after_edit.timeout": 1, "gate.m.block": 5, "gate.pass": 20, "team.outcome.done": 3, "team.outcome.failed": 1, "dispatch.PreToolUse.ms.lt50": 90, "dispatch.PreToolUse.ms.ge1000": 10 }),
  sub({ "session.claude": 6, "skill.atlas-plan": 1, "hook.git_guard.deny": 1, "hook.git_guard.deny.protected": 1, "gate.m.block": 2, "gate.pass": 9, "delivery.fail.network": 2 }),
  sub({ "session.claude": 8, "skill.atlas-review": 2, "hook.git_guard.ask": 1, "hook.format_after_edit.fault": 2, "gate.n.block": 2, "gate.pass": 3, "delivery.ok.urllib": 1 }, true),
];
const build = () => buildSummary([{ week: PAST_WEEK, submissions: /** @type {any} */ (SUBS) }], { keys: KEYS, min_installs_published: 3 }, { generatedAt: "t" });
const byName = (/** @type {any[]} */ list, /** @type {string} */ name) => list.find((f) => f.name === name);

test("a hook's total counts decisions once: the reason sub-key is the same event", () => {
  const s = build();
  // ask 2 + ask 1 + deny 1 = 4 decisions; 7 before the sub-keys were left out.
  assert.equal(byName(s.features.hook, "git_guard").total, 4);
  assert.equal(byName(s.features.hook, "git_guard").installs, 3);
});

test("a hook that only faults is failing, not used; a hook that never decides is reported as silent", () => {
  const s = build();
  assert.equal(byName(s.features.hook, "format_after_edit"), undefined);
  assert.ok(s.failures.some((f) => f.key === "hook.format_after_edit.fault"));
  assert.ok(s.unused.hook.includes("format_after_edit"));
});

test("a skill typed as a slash command is used: unused counts neither skill.X nor command.X", () => {
  const s = build();
  assert.deepEqual(s.unused.skill, ["atlas-wiki"]);
  assert.deepEqual(s.unused.command, ["atlas-wiki"]);
});

test("adoption: each feature carries the share of install-weeks that used it", () => {
  const s = build();
  assert.equal(byName(s.features.skill, "atlas-plan").pct, 67);
  assert.equal(byName(s.features.skill, "atlas-review").pct, 33);
});

test("failures carry how many installs hit them and per 100 sessions, so a rare fault and a common one differ", () => {
  const s = build();
  const f = s.failures.find((x) => x.key === "hook.format_after_edit.fault");
  assert.equal(f?.pct, 67);
  assert.equal(f?.per_100_sessions, 12.5);
});

test("rates: gate block share, send failure share, failed team runs and slow dispatches", () => {
  const r = build().rates;
  assert.deepEqual(r.gate, { blocks: 9, passes: 32, block_pct: 22 });
  assert.deepEqual(r.delivery, { ok: 1, fail: 2, fail_pct: 67 });
  assert.deepEqual(r.team, { done: 3, failed: 1, timeout: 0, fail_pct: 25 });
  assert.deepEqual(r.dispatch, { total: 100, slow: 10, slow_pct: 10 });
});

test("signals name what to fix or build next, each with the evidence behind it", () => {
  const sig = build().signals;
  const kinds = sig.map((x) => x.kind);
  assert.ok(kinds.includes("gate_blocks"), kinds.join());
  assert.ok(kinds.includes("hook_faults"), kinds.join());
  assert.ok(kinds.includes("send_failures"), kinds.join());
  assert.ok(kinds.includes("unused_features"), kinds.join());
  assert.ok(sig.every((x) => typeof x.evidence === "string" && x.evidence.length > 0));
  assert.match(sig.find((x) => x.kind === "gate_blocks")?.evidence ?? "", /gate\.m\.block/);
});

test("the dashboard page draws the signals, rates and per-feature share", async () => {
  const { handle } = await import("../api/dashboard.js");
  const html = await (await handle(new Request("http://x/"))).text();
  assert.match(html, /Fix or build next/);
  assert.match(html, /d\.signals/);
  assert.match(html, /per_100_sessions/);
  const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  assert.doesNotThrow(() => new Function(script));
});
