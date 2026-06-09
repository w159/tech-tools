import test from "node:test";
import assert from "node:assert/strict";
import type { CanonicalSkillSource } from "../schema.js";
import {
  analyzeResolverIntegrity,
  normalizeTrigger,
} from "./resolver.js";

function makeSkill(
  name: string,
  triggers: string[],
): CanonicalSkillSource {
  return {
    id: name,
    sourcePath: `/tmp/${name}/skill.md`,
    frontmatter: {
      name,
      description: `${name} description`,
      triggers,
      user_invocable: true,
      metadata: {
        display_name: name,
        short_description: `${name} short`,
        default_prompt: `Use ${name}`,
        site_category: "Lifecycle",
        site_example: `/${name}`,
        site_best_for: `${name} best for`,
      },
    },
    body: `# ${name}`,
  };
}

test("normalizeTrigger collapses case, punctuation, and placeholder slots", () => {
  assert.equal(
    normalizeTrigger("What did we discuss about X?"),
    "what did we discuss about slot",
  );
  assert.equal(
    normalizeTrigger("  Review   this walkthrough!!  "),
    "review this walkthrough",
  );
  assert.equal(
    normalizeTrigger("I'm meeting with"),
    "im meeting with",
  );
});

test("analyzeResolverIntegrity passes for distinct trigger lanes", () => {
  const report = analyzeResolverIntegrity([
    makeSkill("minutes-search", ["what did we discuss about X"]),
    makeSkill("minutes-brief", ["brief me"]),
    makeSkill("minutes-record", ["start recording"]),
  ]);

  assert.equal(report.ok, true);
  assert.equal(report.issues.length, 0);
  assert.equal(report.skillCount, 3);
  assert.equal(report.triggerCount, 3);
});

test("analyzeResolverIntegrity flags duplicate normalized triggers across skills", () => {
  const report = analyzeResolverIntegrity([
    makeSkill("minutes-search", ["What did Alex say?"]),
    makeSkill("minutes-graph", ["what did alex say"]),
  ]);

  assert.equal(report.ok, false);
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].type, "duplicate_trigger");
  assert.deepEqual(report.issues[0].skills, ["minutes-graph", "minutes-search"]);
});

test("analyzeResolverIntegrity flags shadowed triggers across skills", () => {
  const report = analyzeResolverIntegrity([
    makeSkill("minutes-brief", ["what happened this week"]),
    makeSkill("minutes-prep", ["what happened this week with Sarah"]),
  ]);

  assert.equal(report.ok, false);
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].type, "shadowed_trigger");
  assert.deepEqual(report.issues[0].skills, ["minutes-brief", "minutes-prep"]);
});

test("analyzeResolverIntegrity flags anchored prefix overlap for shorter triggers", () => {
  const report = analyzeResolverIntegrity([
    makeSkill("minutes-alpha", ["brief me"]),
    makeSkill("minutes-beta", ["brief me on sarah"]),
  ]);

  assert.equal(report.ok, false);
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].type, "anchored_overlap");
});

test("analyzeResolverIntegrity flags fuzzy placeholder overlap on content tokens", () => {
  const report = analyzeResolverIntegrity([
    makeSkill("minutes-alpha", ["every time we talked about Y"]),
    makeSkill("minutes-beta", ["find that meeting where we talked about Y"]),
  ]);

  assert.equal(report.ok, false);
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].type, "fuzzy_overlap");
});

test("analyzeResolverIntegrity allows nested trigger specificity within the same skill", () => {
  const report = analyzeResolverIntegrity([
    makeSkill("minutes-brief", ["brief me", "brief me on Sarah"]),
  ]);

  assert.equal(report.ok, true);
  assert.equal(report.issues.length, 0);
});
