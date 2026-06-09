import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { argv, cwd, exit } from "node:process";
import { discoverCanonicalSkills } from "./discover.js";

const execFileAsync = promisify(execFile);

export interface SurfaceAuditIssue {
  surface: string;
  type:
    | "missing_file"
    | "parse_error"
    | "invalid_pack"
    | "unknown_skill_reference";
  message: string;
}

export interface SurfaceAuditReport {
  ok: boolean;
  issues: SurfaceAuditIssue[];
  auditedFiles: string[];
}

function getRootDir(): string {
  return cwd().endsWith(path.join("tooling", "skills"))
    ? cwd()
    : path.join(cwd(), "tooling", "skills");
}

function getRepoRoot(rootDir: string): string {
  return path.join(rootDir, "..", "..");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function extractMinutesSkillRefs(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/(^|[^a-z0-9-])\/(minutes-[a-z-]+)\b/gim)].map((match) => match[2]),
    ),
  ];
}

async function checkNodeParse(filePath: string): Promise<string | null> {
  try {
    await execFileAsync(process.execPath, ["--check", filePath], {
      cwd: path.dirname(filePath),
    });
    return null;
  } catch (error) {
    if (error instanceof Error && "stderr" in error) {
      return String((error as { stderr?: string }).stderr ?? error.message).trim();
    }
    return error instanceof Error ? error.message : String(error);
  }
}

function validatePackShape(
  pack: unknown,
  surface: string,
  validSkillIds: Set<string>,
): SurfaceAuditIssue[] {
  const issues: SurfaceAuditIssue[] = [];
  if (!pack || typeof pack !== "object") {
    return [
      {
        surface,
        type: "invalid_pack",
        message: "Pack file is not a JSON object.",
      },
    ];
  }

  const value = pack as Record<string, unknown>;
  const requiredFields = ["schema_version", "pack_id", "title", "description", "skill_names"];
  for (const field of requiredFields) {
    if (!(field in value)) {
      issues.push({
        surface,
        type: "invalid_pack",
        message: `Missing required pack field: ${field}`,
      });
    }
  }

  if (value.schema_version !== 1) {
    issues.push({
      surface,
      type: "invalid_pack",
      message: `schema_version must be 1 (got ${String(value.schema_version)})`,
    });
  }

  const skillNames = Array.isArray(value.skill_names) ? value.skill_names : [];
  for (const skillName of skillNames) {
    if (typeof skillName !== "string" || !validSkillIds.has(skillName)) {
      issues.push({
        surface,
        type: "unknown_skill_reference",
        message: `Pack references unknown skill ${JSON.stringify(skillName)}`,
      });
    }
  }

  const entrypoints = Array.isArray(value.entrypoints) ? value.entrypoints : [];
  for (const entry of entrypoints) {
    const skillName =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>).skill_name
        : undefined;
    if (typeof skillName !== "string" || !validSkillIds.has(skillName)) {
      issues.push({
        surface,
        type: "unknown_skill_reference",
        message: `Pack entrypoint references unknown skill ${JSON.stringify(skillName)}`,
      });
    }
  }

  return issues;
}

export async function auditNonPortableSurfaces(
  rootDir = getRootDir(),
): Promise<SurfaceAuditReport> {
  const repoRoot = getRepoRoot(rootDir);
  const skills = await discoverCanonicalSkills(rootDir);
  const validSkillIds = new Set(skills.map((skill) => skill.id));
  const issues: SurfaceAuditIssue[] = [];
  const auditedFiles: string[] = [];

  const hookFiles = [
    ".claude/plugins/minutes/hooks/post-record.mjs",
    ".claude/plugins/minutes/hooks/session-reminder.mjs",
  ];
  const agentFiles = [
    ".claude/plugins/minutes/agents/meeting-analyst.md",
  ];
  const packFiles = [
    ".claude/plugins/minutes/packs/founder-weekly.json",
    ".claude/plugins/minutes/packs/relationship-intel.json",
    ".claude/plugins/minutes/packs/README.md",
    ".claude/plugins/minutes/packs/schema.json",
  ];

  for (const relativePath of [...hookFiles, ...agentFiles, ...packFiles]) {
    const absolutePath = path.join(repoRoot, relativePath);
    auditedFiles.push(relativePath);
    if (!(await fileExists(absolutePath))) {
      issues.push({
        surface: relativePath,
        type: "missing_file",
        message: `Missing required non-portable surface file: ${relativePath}`,
      });
    }
  }

  for (const relativePath of hookFiles) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!(await fileExists(absolutePath))) continue;
    const parseError = await checkNodeParse(absolutePath);
    if (parseError) {
      issues.push({
        surface: relativePath,
        type: "parse_error",
        message: parseError,
      });
      continue;
    }

    const body = await readFile(absolutePath, "utf8");
    for (const skillRef of extractMinutesSkillRefs(body)) {
      if (!validSkillIds.has(skillRef)) {
        issues.push({
          surface: relativePath,
          type: "unknown_skill_reference",
          message: `Hook references unknown skill ${skillRef}`,
        });
      }
    }
  }

  for (const relativePath of agentFiles) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!(await fileExists(absolutePath))) continue;
    const body = await readFile(absolutePath, "utf8");
    for (const skillRef of extractMinutesSkillRefs(body)) {
      if (!validSkillIds.has(skillRef)) {
        issues.push({
          surface: relativePath,
          type: "unknown_skill_reference",
          message: `Agent surface references unknown skill ${skillRef}`,
        });
      }
    }
  }

  for (const relativePath of packFiles.filter((filePath) => filePath.endsWith(".json") && !filePath.endsWith("schema.json"))) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!(await fileExists(absolutePath))) continue;
    try {
      const pack = JSON.parse(await readFile(absolutePath, "utf8"));
      issues.push(...validatePackShape(pack, relativePath, validSkillIds));
    } catch (error) {
      issues.push({
        surface: relativePath,
        type: "parse_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const packsReadmePath = path.join(repoRoot, ".claude/plugins/minutes/packs/README.md");
  if (await fileExists(packsReadmePath)) {
    const packsReadme = await readFile(packsReadmePath, "utf8");
    const referencedPacks = [...new Set([...packsReadme.matchAll(/packs\/([a-z0-9-]+\.json)/g)].map((match) => match[1]))];
    for (const packFile of referencedPacks) {
      const absolutePack = path.join(repoRoot, ".claude/plugins/minutes/packs", packFile);
      if (!(await fileExists(absolutePack))) {
        issues.push({
          surface: ".claude/plugins/minutes/packs/README.md",
          type: "missing_file",
          message: `README references missing pack file ${packFile}`,
        });
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    auditedFiles,
  };
}

async function main(): Promise<void> {
  const report = await auditNonPortableSurfaces();
  if (report.ok) {
    console.log(
      JSON.stringify({
        status: "ok",
        auditedFiles: report.auditedFiles,
      }),
    );
    return;
  }

  console.error(
    JSON.stringify(
      {
        status: "error",
        auditedFiles: report.auditedFiles,
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
