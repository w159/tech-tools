// @ts-check
import { randomUUID } from "node:crypto";

export const NOW = new Date("2026-11-05T12:00:00Z"); // ISO week 2026-W45
export const PAST_WEEK = "2026-W44";

/** @type {import("../lib/validate.js").AllowedKeys} */
export const ALLOWED = {
  schema: 3,
  schemas: [2, 3],
  max_count: 10000,
  min_installs_published: 3,
  keys: ["agent.planner", "gate.a.block", "skill.atlas-plan", "skill.atlas-review"],
};

/**
 * @param {Record<string, unknown>} [over]
 * @returns {Record<string, unknown>}
 */
export function submission(over = {}) {
  return {
    schema: 2,
    atlas_version: "16.12.0",
    os: "linux",
    python: "3.12",
    week: PAST_WEEK,
    nonce: randomUUID(),
    counts: { "skill.atlas-plan": 3 },
    ...over,
  };
}
