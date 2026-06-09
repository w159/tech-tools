import path from "node:path";
import { fileURLToPath } from "node:url";
import { argv, cwd, exit } from "node:process";
import type { CanonicalSkillSource } from "../schema.js";
import { discoverCanonicalSkills } from "./discover.js";

export interface ResolverTriggerRecord {
  skillId: string;
  raw: string;
  normalized: string;
  tokens: string[];
}

export interface ResolverIssue {
  type:
    | "empty_trigger"
    | "duplicate_trigger"
    | "shadowed_trigger"
    | "anchored_overlap"
    | "fuzzy_overlap";
  skills: string[];
  triggers: string[];
  normalized: string[];
  message: string;
}

export interface ResolverIntegrityReport {
  ok: boolean;
  skillCount: number;
  triggerCount: number;
  issues: ResolverIssue[];
}

function getRootDir(): string {
  return cwd().endsWith(path.join("tooling", "skills"))
    ? cwd()
    : path.join(cwd(), "tooling", "skills");
}

export function normalizeTrigger(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\b([xyz])\b/g, "slot")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeTrigger(normalized: string): string[] {
  return normalized.length === 0 ? [] : normalized.split(" ");
}

function isContiguousTokenSubsequence(shorter: string[], longer: string[]): boolean {
  if (shorter.length === 0 || shorter.length > longer.length) {
    return false;
  }

  for (let start = 0; start <= longer.length - shorter.length; start += 1) {
    let matched = true;
    for (let index = 0; index < shorter.length; index += 1) {
      if (longer[start + index] !== shorter[index]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }

  return false;
}

function compareTriggerRecords(a: ResolverTriggerRecord, b: ResolverTriggerRecord): number {
  return (
    a.skillId.localeCompare(b.skillId) ||
    a.normalized.localeCompare(b.normalized) ||
    a.raw.localeCompare(b.raw)
  );
}

const CONTENT_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "then",
  "that",
  "this",
  "these",
  "those",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "she",
  "they",
  "them",
  "it",
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "did",
  "does",
  "for",
  "to",
  "of",
  "on",
  "in",
  "at",
  "by",
  "with",
  "from",
  "as",
  "any",
  "what",
  "who",
  "how",
  "when",
  "where",
  "why",
  "up",
  "about",
  "just",
]);

function extractContentTokens(tokens: string[]): string[] {
  return tokens.filter((token) => token === "slot" || (token.length > 1 && !CONTENT_STOPWORDS.has(token)));
}

function longestCommonSubsequenceTokens(a: string[], b: string[]): string[] {
  const dp = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => [] as string[]),
  );

  for (let row = 1; row <= a.length; row += 1) {
    for (let col = 1; col <= b.length; col += 1) {
      if (a[row - 1] === b[col - 1]) {
        dp[row][col] = [...dp[row - 1][col - 1], a[row - 1]];
        continue;
      }
      dp[row][col] =
        dp[row - 1][col].length >= dp[row][col - 1].length
          ? dp[row - 1][col]
          : dp[row][col - 1];
    }
  }

  return dp[a.length][b.length];
}

export function collectResolverTriggerRecords(
  skills: CanonicalSkillSource[],
): { records: ResolverTriggerRecord[]; issues: ResolverIssue[] } {
  const records: ResolverTriggerRecord[] = [];
  const issues: ResolverIssue[] = [];

  for (const skill of skills) {
    const normalizedBySkill = new Map<string, string[]>();

    for (const rawTrigger of skill.frontmatter.triggers) {
      const normalized = normalizeTrigger(rawTrigger);

      if (normalized.length === 0) {
        issues.push({
          type: "empty_trigger",
          skills: [skill.id],
          triggers: [rawTrigger],
          normalized: [normalized],
          message: `Skill ${skill.id} has an empty trigger after normalization: "${rawTrigger}"`,
        });
        continue;
      }

      const priorTriggers = normalizedBySkill.get(normalized) ?? [];
      priorTriggers.push(rawTrigger);
      normalizedBySkill.set(normalized, priorTriggers);

      records.push({
        skillId: skill.id,
        raw: rawTrigger,
        normalized,
        tokens: tokenizeTrigger(normalized),
      });
    }

    for (const [normalized, triggers] of normalizedBySkill.entries()) {
      if (triggers.length < 2) continue;
      issues.push({
        type: "duplicate_trigger",
        skills: [skill.id],
        triggers,
        normalized: [normalized],
        message: `Skill ${skill.id} declares duplicate trigger variants that normalize to "${normalized}"`,
      });
    }
  }

  records.sort(compareTriggerRecords);
  return { records, issues };
}

export function analyzeResolverIntegrity(skills: CanonicalSkillSource[]): ResolverIntegrityReport {
  const { records, issues: initialIssues } = collectResolverTriggerRecords(skills);
  const issues = [...initialIssues];
  const duplicateKeys = new Set<string>();
  const shadowKeys = new Set<string>();
  const byNormalized = new Map<string, ResolverTriggerRecord[]>();

  for (const record of records) {
    const bucket = byNormalized.get(record.normalized) ?? [];
    bucket.push(record);
    byNormalized.set(record.normalized, bucket);
  }

  for (const [normalized, bucket] of byNormalized.entries()) {
    const skillsUsingTrigger = [...new Set(bucket.map((record) => record.skillId))];
    if (skillsUsingTrigger.length < 2) continue;

    const rawVariants = [...new Set(bucket.map((record) => record.raw))];
    const duplicateKey = `${skillsUsingTrigger.join("|")}::${normalized}`;
    if (duplicateKeys.has(duplicateKey)) continue;
    duplicateKeys.add(duplicateKey);

    issues.push({
      type: "duplicate_trigger",
      skills: skillsUsingTrigger,
      triggers: rawVariants,
      normalized: [normalized],
      message: `Trigger "${normalized}" is claimed by multiple skills: ${skillsUsingTrigger.join(", ")}`,
    });
  }

  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      const a = records[left];
      const b = records[right];

      if (a.skillId === b.skillId || a.normalized === b.normalized) {
        continue;
      }

      const [shorter, longer] =
        a.tokens.length <= b.tokens.length
          ? [a, b]
          : [b, a];

      if (
        shorter.tokens.length >= 3 &&
        isContiguousTokenSubsequence(shorter.tokens, longer.tokens)
      ) {
        const shadowKey = [
          "shadowed",
          shorter.skillId,
          shorter.normalized,
          longer.skillId,
          longer.normalized,
        ].join("::");
        if (shadowKeys.has(shadowKey)) {
          continue;
        }
        shadowKeys.add(shadowKey);
        issues.push({
          type: "shadowed_trigger",
          skills: [shorter.skillId, longer.skillId],
          triggers: [shorter.raw, longer.raw],
          normalized: [shorter.normalized, longer.normalized],
          message:
            `Trigger "${shorter.raw}" in ${shorter.skillId} is shadowed by ` +
            `"${longer.raw}" in ${longer.skillId}`,
        });
        continue;
      }

      if (
        shorter.tokens.length >= 2 &&
        longer.normalized.startsWith(`${shorter.normalized} `)
      ) {
        const overlapKey = [
          "anchored",
          shorter.skillId,
          shorter.normalized,
          longer.skillId,
          longer.normalized,
        ].join("::");
        if (shadowKeys.has(overlapKey)) {
          continue;
        }
        shadowKeys.add(overlapKey);
        issues.push({
          type: "anchored_overlap",
          skills: [shorter.skillId, longer.skillId],
          triggers: [shorter.raw, longer.raw],
          normalized: [shorter.normalized, longer.normalized],
          message:
            `Trigger "${shorter.raw}" in ${shorter.skillId} is an anchored prefix of ` +
            `"${longer.raw}" in ${longer.skillId}`,
        });
        continue;
      }

      const shorterContent = extractContentTokens(shorter.tokens);
      const longerContent = extractContentTokens(longer.tokens);
      const contentOverlap = longestCommonSubsequenceTokens(shorterContent, longerContent);

      if (contentOverlap.length >= 2 && contentOverlap.includes("slot")) {
        const overlapKey = [
          "fuzzy",
          shorter.skillId,
          shorter.normalized,
          longer.skillId,
          longer.normalized,
          contentOverlap.join("|"),
        ].join("::");
        if (shadowKeys.has(overlapKey)) {
          continue;
        }
        shadowKeys.add(overlapKey);
        issues.push({
          type: "fuzzy_overlap",
          skills: [shorter.skillId, longer.skillId],
          triggers: [shorter.raw, longer.raw],
          normalized: [shorter.normalized, longer.normalized],
          message:
            `Trigger "${shorter.raw}" in ${shorter.skillId} overlaps with ` +
            `"${longer.raw}" in ${longer.skillId} on placeholder-bearing content tokens (${contentOverlap.join(", ")})`,
        });
      }
    }
  }

  issues.sort((a, b) => {
    return (
      a.type.localeCompare(b.type) ||
      a.skills.join("|").localeCompare(b.skills.join("|")) ||
      a.triggers.join("|").localeCompare(b.triggers.join("|"))
    );
  });

  return {
    ok: issues.length === 0,
    skillCount: skills.length,
    triggerCount: records.length,
    issues,
  };
}

async function main(): Promise<void> {
  const rootDir = getRootDir();
  const skills = await discoverCanonicalSkills(rootDir);
  const report = analyzeResolverIntegrity(skills);

  if (report.ok) {
    console.log(
      JSON.stringify({
        status: "ok",
        skillCount: report.skillCount,
        triggerCount: report.triggerCount,
      }),
    );
    return;
  }

  console.error(
    JSON.stringify(
      {
        status: "error",
        skillCount: report.skillCount,
        triggerCount: report.triggerCount,
        issues: report.issues,
      },
      null,
      2,
    ),
  );
  exit(1);
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
