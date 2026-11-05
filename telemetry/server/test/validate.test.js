// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSubmission } from "../lib/validate.js";
import { ALLOWED, NOW, submission } from "./helpers.js";

/** @param {unknown} body */
const check = (body) => validateSubmission(typeof body === "string" ? body : JSON.stringify(body), ALLOWED, NOW);

/**
 * @param {string} name
 * @param {Record<string, unknown>} over
 * @param {RegExp} msg
 */
function rejects(name, over, msg) {
  test(`rejects ${name}`, () => {
    const r = check(submission(over));
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), msg);
  });
}

test("accepts a valid submission and returns the canonical value", () => {
  const body = submission({ counts: { "skill.atlas-review": 2, "agent.planner": 1 } });
  const r = check(body);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(Object.keys(r.value?.counts ?? {}), ["agent.planner", "skill.atlas-review"]);
});

test("accepts the current week and a 9 week old week", () => {
  assert.equal(check(submission({ week: "2026-W45" })).ok, true);
  assert.equal(check(submission({ week: "2026-W36" })).ok, true);
});

test("rejects body over 64 KB", () => {
  const r = check("x".repeat(65 * 1024));
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /larger than/);
});

test("rejects invalid JSON and non-object bodies", () => {
  assert.match(check("{nope").errors[0], /valid JSON/);
  assert.match(check("[1]").errors[0], /JSON object/);
  assert.match(check("null").errors[0], /JSON object/);
});

test("rejects extra and missing envelope keys", () => {
  assert.match(check({ ...submission(), install_id: "x" }).errors.join(), /unexpected envelope key/);
  const missing = submission();
  delete missing.os;
  assert.match(check(missing).errors.join(), /missing envelope key: os/);
});

rejects("wrong schema", { schema: 1 }, /schema must be 2/);
rejects("non-semver atlas_version", { atlas_version: "v16" }, /atlas_version/);
rejects("non-string atlas_version", { atlas_version: 16 }, /atlas_version/);
rejects("unknown os", { os: "freebsd" }, /os must be/);
rejects("bad python", { python: "2.7" }, /python/);
rejects("bad python text", { python: "3.12.1" }, /python/);
rejects("bad week format", { week: "2026-44" }, /week must look like/);
rejects("impossible week", { week: "2026-W54" }, /not a real ISO week/);
rejects("week 53 in a 52 week year", { week: "2025-W53" }, /not a real ISO week/);
rejects("future week", { week: "2026-W46" }, /in the future/);
rejects("week older than 9 weeks", { week: "2026-W35" }, /older than 9 weeks/);
rejects("non-uuid nonce", { nonce: "abc" }, /nonce/);
rejects("uuid v1 nonce", { nonce: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" }, /nonce/);
rejects("uppercase nonce", { nonce: "6BA7B810-9DAD-41D1-80B4-00C04FD430C8" }, /nonce/);
rejects("empty counts", { counts: {} }, /must not be empty/);
rejects("array counts", { counts: [1] }, /counts must be an object/);
rejects("unknown count key", { counts: { "skill.nope": 1 } }, /not allowed/);
rejects("zero count", { counts: { "skill.atlas-plan": 0 } }, /out of range/);
rejects("negative count", { counts: { "skill.atlas-plan": -1 } }, /out of range/);
rejects("fractional count", { counts: { "skill.atlas-plan": 1.5 } }, /out of range/);
rejects("string count", { counts: { "skill.atlas-plan": "3" } }, /out of range/);
rejects("count above max", { counts: { "skill.atlas-plan": 10001 } }, /out of range/);
