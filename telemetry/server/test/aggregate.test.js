// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregate } from "../lib/aggregate.js";
import { PAST_WEEK, submission } from "./helpers.js";

/** @param {Record<string, unknown>[]} list */
const subs = (list) => /** @type {any[]} */ (list);

test("2 installs publish only week and submission count", () => {
  const out = aggregate(PAST_WEEK, subs([submission(), submission()]), 3);
  assert.deepEqual(out, { week: PAST_WEEK, submissions: 2 });
});

test("3 installs publish keys reported by 3 and hide keys reported by 2", () => {
  const out = aggregate(
    PAST_WEEK,
    subs([
      submission({ counts: { "skill.atlas-plan": 1, "skill.atlas-review": 5 } }),
      submission({ counts: { "skill.atlas-plan": 2, "skill.atlas-review": 7 } }),
      submission({ counts: { "skill.atlas-plan": 4 } }),
    ]),
    3,
  );
  assert.equal(out.submissions, 3);
  assert.deepEqual(out.counts, { "skill.atlas-plan": { installs: 3, total: 7 } });
  assert.deepEqual(out.atlas_version, { "16.12.0": 3 });
  assert.deepEqual(out.os, { linux: 3 });
  assert.deepEqual(out.python, { "3.12": 3 });
});

test("small version, os and python buckets fold into other", () => {
  const mk = (/** @type {Record<string, unknown>} */ o) => submission(o);
  const out = aggregate(
    PAST_WEEK,
    subs([
      mk({}),
      mk({}),
      mk({}),
      mk({ atlas_version: "16.11.0", os: "darwin", python: "3.11" }),
      mk({ atlas_version: "16.10.0", os: "windows", python: "3.13" }),
      mk({ atlas_version: "16.9.0", os: "other", python: "3.10" }),
    ]),
    3,
  );
  assert.deepEqual(out.atlas_version, { "16.12.0": 3, other: 3 });
  assert.deepEqual(out.os, { linux: 3, other: 3 });
  assert.deepEqual(out.python, { "3.12": 3, other: 3 });
});

test("an other bucket that stays below the threshold is dropped", () => {
  const out = aggregate(
    PAST_WEEK,
    subs([submission(), submission(), submission(), submission({ os: "darwin" })]),
    3,
  );
  assert.deepEqual(out.os, { linux: 3 });
});
