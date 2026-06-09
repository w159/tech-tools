import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { discoverCanonicalSkills } from "./discover.js";
import { auditSkill } from "./skill-audit.js";

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

async function makeFixtureSkill(
  root: string,
  id: string,
  triggers: string[],
  extraFrontmatter = "",
): Promise<void> {
  const skillDir = path.join(root, "sources", id);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "skill.md"),
    `---
name: ${id}
description: ${id} description
triggers:
${triggers.map((trigger) => `  - ${trigger}`).join("\n")}
user_invocable: true
metadata:
  display_name: ${id}
  short_description: ${id} short
  default_prompt: Use ${id}
  site_category: Lifecycle
  site_example: /${id}
  site_best_for: ${id} best for
assets:
  scripts: []
  templates: []
  references: []
output:
  claude:
    path: .claude/plugins/minutes/skills/${id}/SKILL.md
  codex:
    path: .agents/skills/minutes/${id}/SKILL.md
tests:
  golden: true
  lint_commands: true
${extraFrontmatter}---

# /${id}
`,
    "utf8",
  );
}

test("skill-audit reports a clean synthetic skill", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "minutes-skill-audit-"));
  const toolingRoot = path.join(root, "tooling", "skills");
  await makeFixtureSkill(toolingRoot, "minutes-search", ["what did we discuss about X"]);

  const skills = await discoverCanonicalSkills(toolingRoot);
  const report = await auditSkill(skills[0], skills);
  assert.equal(report.ok, true);
  assert.equal(report.score, report.total);
});

test("skill-audit fails when routing fixture coverage is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "minutes-skill-audit-"));
  const toolingRoot = path.join(root, "tooling", "skills");
  await makeFixtureSkill(toolingRoot, "minutes-nonexistent", ["minutes nonexistent trigger"]);

  const skills = await discoverCanonicalSkills(toolingRoot);
  const report = await auditSkill(skills[0], skills);
  assert.equal(report.ok, false);
  const fixtureItem = report.items.find((item) => item.name === "routing_fixture_presence");
  assert.ok(fixtureItem);
  assert.equal(fixtureItem.status, "fail");
});

test("skill-audit works against the real repo for a routed skill", async () => {
  const skills = await discoverCanonicalSkills(path.join(REPO_ROOT, "tooling", "skills"));
  const skill = skills.find((candidate) => candidate.id === "minutes-search");
  assert.ok(skill);
  const report = await auditSkill(skill, skills);
  assert.equal(report.ok, true);
  assert.equal(report.skillId, "minutes-search");
});
