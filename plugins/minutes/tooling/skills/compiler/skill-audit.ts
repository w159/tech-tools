import path from "node:path";
import { fileURLToPath } from "node:url";
import { argv, cwd, exit } from "node:process";
import type { CanonicalSkillSource } from "../schema.js";
import { HOSTS } from "../hosts/index.js";
import { discoverCanonicalSkills } from "./discover.js";
import { renderSkillForHost } from "./render.js";
import { validateSkillAssets } from "./validate.js";
import { analyzeResolverIntegrity } from "./resolver.js";
import { ROUTING_FIXTURES } from "./routing.fixtures.js";
import { evaluateRoutingFixtures } from "./routing.js";

export interface SkillAuditItem {
  name: string;
  status: "pass" | "fail" | "warn" | "na";
  detail: string;
}

export interface SkillAuditReport {
  skillId: string;
  ok: boolean;
  score: number;
  total: number;
  items: SkillAuditItem[];
  recommendations: string[];
}

function getRootDir(): string {
  return cwd().endsWith(path.join("tooling", "skills"))
    ? cwd()
    : path.join(cwd(), "tooling", "skills");
}

function parseArgs(rawArgs: string[]): { json: boolean; selectors: string[] } {
  const selectors: string[] = [];
  let json = false;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--skill" && rawArgs[index + 1]) {
      selectors.push(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    selectors.push(arg);
  }

  return { json, selectors };
}

function matchesSelector(skill: CanonicalSkillSource, selector: string): boolean {
  if (skill.id === selector) return true;
  const normalizedSelector = selector.replace(/\\/g, "/");
  return (
    skill.sourcePath.replace(/\\/g, "/").includes(normalizedSelector) ||
    normalizedSelector.includes(`/${skill.id}/`) ||
    normalizedSelector.endsWith(`/${skill.id}`) ||
    normalizedSelector.endsWith(`/${skill.id}.md`)
  );
}

function makeItem(
  name: string,
  status: SkillAuditItem["status"],
  detail: string,
): SkillAuditItem {
  return { name, status, detail };
}

export async function auditSkill(
  skill: CanonicalSkillSource,
  skills: CanonicalSkillSource[],
): Promise<SkillAuditReport> {
  const items: SkillAuditItem[] = [];
  const recommendations: string[] = [];

  const metadata = skill.frontmatter.metadata ?? {};
  const metadataMissing = [
    ["display_name", metadata.display_name],
    ["short_description", metadata.short_description],
    ["default_prompt", metadata.default_prompt],
    ["site_category", metadata.site_category],
    ["site_example", metadata.site_example],
    ["site_best_for", metadata.site_best_for],
  ].filter(([, value]) => !value);
  items.push(
    metadataMissing.length === 0
      ? makeItem("canonical_metadata", "pass", "Canonical display/prompt/site metadata is complete.")
      : makeItem(
          "canonical_metadata",
          "fail",
          `Missing metadata fields: ${metadataMissing.map(([field]) => field).join(", ")}`,
        ),
  );

  const tests = skill.frontmatter.tests ?? {};
  const missingTestFlags = [
    !tests.golden ? "tests.golden" : null,
    !tests.lint_commands ? "tests.lint_commands" : null,
  ].filter(Boolean) as string[];
  items.push(
    missingTestFlags.length === 0
      ? makeItem("compiler_test_flags", "pass", "Golden + command-lint coverage are enabled.")
      : makeItem(
          "compiler_test_flags",
          "fail",
          `Missing required test flags: ${missingTestFlags.join(", ")}`,
        ),
  );

  items.push(
    skill.frontmatter.user_invocable !== undefined
      ? makeItem(
          "user_invocable",
          "pass",
          `user_invocable is explicitly set to ${skill.frontmatter.user_invocable ? "true" : "false"}.`,
        )
      : makeItem(
          "user_invocable",
          "fail",
          "user_invocable is implicit; declare it explicitly so host behavior is unambiguous.",
        ),
  );

  try {
    await validateSkillAssets(skill);
    items.push(
      makeItem(
        "asset_resolution",
        "pass",
        "Declared scripts/templates/references resolve from the canonical skill source.",
      ),
    );
  } catch (error) {
    items.push(
      makeItem(
        "asset_resolution",
        "fail",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  const codexArtifact = renderSkillForHost(skill, HOSTS.codex);
  const opencodeArtifact = renderSkillForHost(skill, HOSTS.opencode);
  const hostIssues: string[] = [];

  if (!skill.frontmatter.output?.claude?.path || !skill.frontmatter.output?.codex?.path) {
    hostIssues.push("canonical output paths for claude/codex are not fully declared");
  }
  if (!codexArtifact.sidecarFiles.some((file) => file.relativePath.endsWith("agents/openai.yaml"))) {
    hostIssues.push("codex openai.yaml sidecar is not planned");
  }
  if (
    (skill.frontmatter.assets?.scripts?.length ||
      skill.frontmatter.assets?.templates?.length ||
      skill.frontmatter.assets?.references?.length) &&
    (codexArtifact.assetFiles.length === 0 || opencodeArtifact.assetFiles.length === 0)
  ) {
    hostIssues.push("declared bundled assets are not emitted for codex/opencode");
  }

  items.push(
    hostIssues.length === 0
      ? makeItem("host_artifacts", "pass", "Host outputs and portable sidecars/assets are planned correctly.")
      : makeItem("host_artifacts", "fail", hostIssues.join("; ")),
  );

  const resolverIssues = analyzeResolverIntegrity(skills).issues.filter((issue) =>
    issue.skills.includes(skill.id),
  );
  items.push(
    resolverIssues.length === 0
      ? makeItem("resolver_integrity", "pass", "No duplicate or shadowed trigger lanes involve this skill.")
      : makeItem(
          "resolver_integrity",
          "fail",
          resolverIssues.map((issue) => issue.message).join(" | "),
        ),
  );

  const routingFixtures = ROUTING_FIXTURES.filter((fixture) => fixture.expectedSkill === skill.id);
  items.push(
    routingFixtures.length > 0
      ? makeItem(
          "routing_fixture_presence",
          "pass",
          `${routingFixtures.length} deterministic routing fixture(s) target this skill.`,
        )
      : makeItem(
          "routing_fixture_presence",
          "fail",
          "No routing fixture currently targets this skill.",
        ),
  );

  const routingReport = evaluateRoutingFixtures(skills, routingFixtures);
  items.push(
    routingFixtures.length === 0
      ? makeItem("routing_fixture_pass", "na", "Skipped because no routing fixtures target this skill.")
      : routingReport.ok
        ? makeItem(
            "routing_fixture_pass",
            "pass",
            "All deterministic routing fixtures for this skill resolve correctly.",
          )
        : makeItem(
            "routing_fixture_pass",
            "fail",
            routingReport.failures
              .map((failure) =>
                `${failure.utterance} -> ${failure.actualSkill ?? "no match"}${failure.ambiguousSkills.length > 0 ? ` (ambiguous: ${failure.ambiguousSkills.join(", ")})` : ""}`,
              )
              .join(" | "),
          ),
  );

  for (const item of items) {
    if (item.status !== "fail") continue;
    switch (item.name) {
      case "canonical_metadata":
        recommendations.push(`Fill in missing metadata in ${skill.sourcePath}.`);
        break;
      case "compiler_test_flags":
        recommendations.push(`Enable both tests.golden and tests.lint_commands in ${skill.sourcePath}.`);
        break;
      case "user_invocable":
        recommendations.push(`Declare user_invocable explicitly in ${skill.sourcePath}.`);
        break;
      case "asset_resolution":
        recommendations.push(`Fix or remove broken asset references in ${skill.sourcePath}.`);
        break;
      case "host_artifacts":
        recommendations.push(`Inspect render/output wiring for ${skill.id} and rerun npm --prefix tooling/skills run check.`);
        break;
      case "resolver_integrity":
        recommendations.push(`Adjust ${skill.id} trigger language or neighboring skills so resolver overlap disappears.`);
        break;
      case "routing_fixture_presence":
        recommendations.push(`Add at least one fixture in tooling/skills/compiler/routing.fixtures.ts for ${skill.id}.`);
        break;
      case "routing_fixture_pass":
        recommendations.push(`Fix deterministic routing for ${skill.id} or adjust its fixture utterances.`);
        break;
      default:
        break;
    }
  }

  const score = items.filter((item) => item.status === "pass" || item.status === "na").length;
  const total = items.length;
  return {
    skillId: skill.id,
    ok: items.every((item) => item.status !== "fail"),
    score,
    total,
    items,
    recommendations: [...new Set(recommendations)],
  };
}

async function main(): Promise<void> {
  const rootDir = getRootDir();
  const { json, selectors } = parseArgs(argv.slice(2));
  const skills = await discoverCanonicalSkills(rootDir);
  const selectedSkills =
    selectors.length === 0
      ? skills
      : skills.filter((skill) => selectors.some((selector) => matchesSelector(skill, selector)));

  if (selectedSkills.length === 0) {
    throw new Error(`No canonical skills matched selectors: ${selectors.join(", ")}`);
  }

  const reports = [];
  for (const skill of selectedSkills) {
    reports.push(await auditSkill(skill, skills));
  }

  if (json) {
    const payload = {
      status: reports.every((report) => report.ok) ? "ok" : "error",
      reports,
    };
    const out = JSON.stringify(payload, null, 2);
    if (payload.status === "ok") {
      console.log(out);
      return;
    }
    console.error(out);
    exit(1);
  }

  for (const report of reports) {
    console.log(`[${report.skillId}] ${report.score}/${report.total}`);
    for (const item of report.items) {
      console.log(`- ${item.status.toUpperCase()} ${item.name}: ${item.detail}`);
    }
    if (report.recommendations.length > 0) {
      console.log("Recommendations:");
      for (const recommendation of report.recommendations) {
        console.log(`- ${recommendation}`);
      }
    }
    console.log("");
  }

  if (!reports.every((report) => report.ok)) {
    exit(1);
  }
}

const invokedPath = argv[1] ? path.resolve(argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    exit(1);
  });
}
