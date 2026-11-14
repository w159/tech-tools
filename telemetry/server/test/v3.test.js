// @ts-check
// Schema 3: lenient keys, week-to-date snapshots, test submissions, health, admin export and dashboard.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handle as admin } from "../api/admin.js";
import { handle as aggregate } from "../api/aggregate.js";
import { handle as dashboard } from "../api/dashboard.js";
import { handle as health } from "../api/health.js";
import { handle as ingest } from "../api/ingest.js";
import { createFsStore } from "../lib/store.js";
import { buildSummary, featureOf } from "../lib/summary.js";
import { validateSubmission } from "../lib/validate.js";
import { ALLOWED, NOW, PAST_WEEK, submission } from "./helpers.js";

const TOKEN = "t0ken-for-tests-only-0123456789";
const post = (/** @type {unknown} */ body) =>
  new Request("http://x/api/ingest", { method: "POST", body: JSON.stringify(body) });

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "atlas-tel3-"));
  const store = createFsStore(dir);
  const env = { ATLAS_DASHBOARD_TOKEN: TOKEN };
  return { ctx: { store, allowed: ALLOWED, now: NOW, env }, done: () => rm(dir, { recursive: true, force: true }) };
}

const v3 = (/** @type {Record<string, unknown>} */ over = {}) => submission({ schema: 3, partial: false, ...over });

test("one unknown key no longer sinks the payload: it is dropped and counted", () => {
  const r = validateSubmission(
    JSON.stringify(submission({ counts: { "skill.atlas-plan": 2, "hook.brand_new.context": 4 } })),
    ALLOWED,
    NOW,
  );
  assert.equal(r.ok, true, r.errors.join());
  assert.deepEqual(r.value?.counts, { "skill.atlas-plan": 2 });
  assert.equal(r.value?.dropped, 1);
});

test("a payload with only unknown keys is still accepted (it proves the install is alive)", () => {
  const r = validateSubmission(JSON.stringify(submission({ counts: { "x.y": 1 } })), ALLOWED, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value?.counts, {});
  assert.equal(r.value?.dropped, 1);
});

test("dropped keys still need a sane shape and value", () => {
  const long = "k".repeat(200);
  assert.equal(validateSubmission(JSON.stringify(submission({ counts: { [long]: 1 } })), ALLOWED, NOW).ok, false);
  assert.equal(validateSubmission(JSON.stringify(submission({ counts: { "x.y": 0 } })), ALLOWED, NOW).ok, false);
});

test("schema 3 needs partial, accepts test, rejects any other extra field", () => {
  assert.equal(validateSubmission(JSON.stringify(v3()), ALLOWED, NOW).ok, true);
  const missing = submission({ schema: 3 });
  assert.match(validateSubmission(JSON.stringify(missing), ALLOWED, NOW).errors.join(), /partial/);
  assert.equal(validateSubmission(JSON.stringify(v3({ test: true })), ALLOWED, NOW).value?.test, true);
  assert.equal(validateSubmission(JSON.stringify(v3({ test: "yes" })), ALLOWED, NOW).ok, false);
  assert.equal(validateSubmission(JSON.stringify(v3({ install_id: "a" })), ALLOWED, NOW).ok, false);
  assert.equal(validateSubmission(JSON.stringify(submission({ partial: true })), ALLOWED, NOW).ok, false);
  assert.equal(validateSubmission(JSON.stringify(submission({ schema: 4 })), ALLOWED, NOW).ok, false);
});

test("schema 3 snapshots upsert; a final one can not be replaced by a partial one", async () => {
  const { ctx, done } = await setup();
  try {
    const first = v3({ partial: true, counts: { "skill.atlas-plan": 1 } });
    assert.equal((await ingest(post(first), ctx)).status, 201);
    const again = { ...first, counts: { "skill.atlas-plan": 5 } };
    assert.equal((await ingest(post(again), ctx)).status, 200);
    const stored = /** @type {any[]} */ (await ctx.store.list(PAST_WEEK));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].counts["skill.atlas-plan"], 5);
    assert.equal((await ingest(post({ ...first, partial: false, counts: { "skill.atlas-plan": 6 } }), ctx)).status, 200);
    assert.equal((await ingest(post({ ...first, partial: true }), ctx)).status, 409);
  } finally {
    await done();
  }
});

test("schema 2 stays create-only", async () => {
  const { ctx, done } = await setup();
  try {
    const s = submission();
    assert.equal((await ingest(post(s), ctx)).status, 201);
    assert.equal((await ingest(post(s), ctx)).status, 409);
  } finally {
    await done();
  }
});

test("test submissions are kept out of the public aggregate", async () => {
  const { ctx, done } = await setup();
  try {
    for (let i = 0; i < 3; i++) await ingest(post(submission()), ctx);
    await ingest(post(v3({ test: true, counts: { "agent.planner": 9 } })), ctx);
    const body = await (await aggregate(new Request(`http://x/api/aggregate?week=${PAST_WEEK}`), ctx)).json();
    assert.equal(body.submissions, 3);
    assert.equal(body.counts["agent.planner"], undefined);
  } finally {
    await done();
  }
});

test("health reports the allowlist fingerprint and submission counts, no secrets", async () => {
  const { ctx, done } = await setup();
  try {
    await ingest(post(submission()), ctx);
    await ingest(post(v3({ test: true })), ctx);
    const res = await health(new Request("http://x/api/health"), ctx);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.schemas, [2, 3]);
    assert.equal(body.allowlist.keys, ALLOWED.keys.length);
    assert.match(body.allowlist.sha256, /^[0-9a-f]{64}$/);
    assert.equal(body.dashboard_configured, true);
    assert.deepEqual(body.weeks[PAST_WEEK], { submissions: 1, test: 1 });
    assert.doesNotMatch(JSON.stringify(body), new RegExp(TOKEN));
  } finally {
    await done();
  }
});

test("admin: 503 when unset, 401 on a wrong token, 200 with the header only; a query token is refused", async () => {
  const { ctx, done } = await setup();
  try {
    const req = (/** @type {string} */ q, /** @type {Record<string,string>} */ h = {}) =>
      new Request(`http://x/api/admin${q}`, { headers: h });
    assert.equal((await admin(req(""), { ...ctx, env: {} })).status, 503);
    assert.equal((await admin(req(""), ctx)).status, 401);
    assert.equal((await admin(req("", { authorization: "Bearer wrong" }), ctx)).status, 401);
    assert.equal((await admin(req("?token=wrong"), ctx)).status, 401);
    const ok = await admin(req("", { authorization: `Bearer ${TOKEN}` }), ctx);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.equal((await admin(req(`?token=${TOKEN}`), ctx)).status, 401, "the right secret in the query string must not work");
  } finally {
    await done();
  }
});

test("admin summary: totals, trend, top, unused, failures, versions, no nonces", async () => {
  const { ctx, done } = await setup();
  try {
    await ingest(post(submission({ counts: { "skill.atlas-plan": 3, "gate.a.block": 2 } })), ctx);
    await ingest(post(v3({ partial: true, counts: { "skill.atlas-plan": 1, "agent.planner": 4, "zzz.new": 1 } })), ctx);
    await ingest(post(v3({ test: true, counts: { "skill.atlas-review": 7 } })), ctx);
    const res = await admin(new Request("http://x/api/admin", { headers: { authorization: `Bearer ${TOKEN}` } }), ctx);
    const s = await res.json();
    assert.equal(s.totals.submissions, 2);
    assert.equal(s.totals.test_submissions, 1);
    assert.equal(s.totals.dropped_keys, 1);
    const wk = s.weeks.find((/** @type {any} */ w) => w.week === PAST_WEEK);
    assert.equal(wk.submissions, 2);
    assert.equal(wk.partial, 1);
    assert.deepEqual(s.features.skill.find((/** @type {any} */ f) => f.name === "atlas-plan"), { name: "atlas-plan", installs: 2, total: 4 });
    assert.ok(s.unused.skill.includes("atlas-review"), "test data must not count as use");
    assert.ok(!s.unused.skill.includes("atlas-plan"));
    assert.deepEqual(s.failures.find((/** @type {any} */ f) => f.key === "gate.a.block"), { key: "gate.a.block", installs: 1, total: 2 });
    assert.deepEqual(s.versions.atlas_version, { "16.12.0": 2 });
    assert.equal(s.keys["skill.atlas-plan"].total, 4);
    assert.doesNotMatch(JSON.stringify(s), /[0-9a-f]{8}-[0-9a-f]{4}-4/);
    const withTest = await (await admin(new Request("http://x/api/admin?include_test=1", { headers: { authorization: `Bearer ${TOKEN}` } }), ctx)).json();
    assert.equal(withTest.totals.submissions, 3);
  } finally {
    await done();
  }
});

test("admin DELETE removes only test submissions", async () => {
  const { ctx, done } = await setup();
  try {
    await ingest(post(submission()), ctx);
    await ingest(post(v3({ test: true })), ctx);
    const del = await admin(
      new Request("http://x/api/admin?purge=test", { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } }),
      ctx,
    );
    assert.equal(del.status, 200);
    assert.equal((await del.json()).deleted, 1);
    const left = /** @type {any[]} */ (await ctx.store.list(PAST_WEEK));
    assert.equal(left.length, 1);
    assert.equal(left[0].test, undefined);
    const noAuth = await admin(new Request("http://x/api/admin?purge=test", { method: "DELETE" }), ctx);
    assert.equal(noAuth.status, 401);
  } finally {
    await done();
  }
});

test("dashboard page is HTML, never embeds the token, and talks to the admin API", async () => {
  const { ctx, done } = await setup();
  try {
    const res = await dashboard(new Request("http://x/dashboard"), ctx);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    const html = await res.text();
    assert.match(html, /<title>Atlas telemetry<\/title>/);
    assert.match(html, /\/api\/admin/);
    assert.doesNotMatch(html, new RegExp(TOKEN));
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    // The owner can delete test submissions from the page: a DELETE to purge=test with the Bearer header.
    assert.match(html, /Delete test data/);
    assert.match(html, /purge=test/);
    assert.match(html, /method: "DELETE"/);
  } finally {
    await done();
  }
});

test("keys with + or capitals are dropped like any unknown key, not refused as malformed", () => {
  const r = validateSubmission(
    JSON.stringify(submission({ counts: { "team.size.9+": 1, "dispatch.PreToolUse.x": 2, "skill.atlas-plan": 1 } })),
    ALLOWED,
    NOW,
  );
  assert.equal(r.ok, true, r.errors.join());
  assert.equal(r.value?.dropped, 2);
});

test("mod features are named by action and target; mod errors and delivery failures are failures, delivery.ok is not", () => {
  assert.deepEqual(featureOf("mod.open.dock"), ["mod", "open.dock"]);
  assert.deepEqual(featureOf("mod.command.atlas-cc"), ["mod", "command.atlas-cc"]);
  assert.equal(featureOf("mod.error.boot"), null);
  assert.deepEqual(featureOf("skill.atlas-plan.x"), ["skill", "atlas-plan"]);
  assert.equal(featureOf("fault.crew.timeout"), null);
  const keys = ["mod.open.dock", "mod.open.board", "mod.command.atlas-cc", "mod.error.boot", "delivery.ok.curl", "delivery.fail.ssl"];
  const subs = [{ counts: { "mod.open.dock": 3, "mod.error.boot": 1, "delivery.ok.curl": 5, "delivery.fail.ssl": 2 } }];
  const s = buildSummary([{ week: PAST_WEEK, submissions: /** @type {any} */ (subs) }], { keys, min_installs_published: 3 });
  assert.deepEqual(s.features.mod.map((/** @type {any} */ f) => f.name), ["open.dock"]);
  assert.deepEqual(s.unused.mod, ["command.atlas-cc", "open.board"]);
  assert.deepEqual(s.failures.map((/** @type {any} */ f) => f.key).sort(), ["delivery.fail.ssl", "mod.error.boot"]);
});
