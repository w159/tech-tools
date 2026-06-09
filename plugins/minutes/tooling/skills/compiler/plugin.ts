import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CanonicalSkillSource } from "../schema.js";

interface ClaudePluginManifest {
  name: string;
  version: string;
  description: string;
  skills: Array<{ name: string; path: string }>;
  agents?: Array<{ name: string; path: string }>;
  hooks?: Record<string, unknown>;
}

function getRelativeSkillPath(skill: CanonicalSkillSource): string {
  const configured =
    skill.frontmatter.output?.claude?.path ??
    `.claude/plugins/minutes/skills/${skill.frontmatter.name}/SKILL.md`;
  return configured.replace(/^\.claude\/plugins\/minutes\//, "");
}

function indentBlock(content: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return content
    .split("\n")
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join("\n");
}

function renderObjectInline(obj: Record<string, string>): string {
  const parts = Object.entries(obj).map(([key, value]) => `"${key}": ${JSON.stringify(value)}`);
  return `{ ${parts.join(", ")} }`;
}

function renderUnknown(value: unknown, indent = 0): string {
  if (Array.isArray(value)) {
    const rendered = value.map((item) => `${" ".repeat(indent + 2)}${renderUnknown(item, indent + 2)}`);
    return `[\n${rendered.join(",\n")}\n${" ".repeat(indent)}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, child]) => `${" ".repeat(indent + 2)}"${key}": ${renderUnknown(child, indent + 2)}`,
    );
    return `{\n${entries.join(",\n")}\n${" ".repeat(indent)}}`;
  }
  return JSON.stringify(value);
}

function renderClaudePluginManifestText(manifest: ClaudePluginManifest): string {
  const lines: string[] = [
    "{",
    `  "name": ${JSON.stringify(manifest.name)},`,
    `  "version": ${JSON.stringify(manifest.version)},`,
    `  "description": ${JSON.stringify(manifest.description)},`,
    "  \"skills\": [",
  ];

  lines.push(
    manifest.skills.map((skill) => `    ${renderObjectInline(skill)}`).join(",\n"),
  );
  lines.push("  ],");

  if (manifest.agents) {
    lines.push("  \"agents\": [");
    lines.push(manifest.agents.map((agent) => `    ${renderObjectInline(agent)}`).join(",\n"));
    lines.push("  ],");
  }

  if (manifest.hooks) {
    const renderedHooks = renderUnknown(manifest.hooks, 2).split("\n");
    if (renderedHooks.length > 0) {
      lines.push(`  "hooks": ${renderedHooks[0]}`);
      lines.push(...renderedHooks.slice(1).map((line) => `  ${line}`));
    }
  }

  if (lines[lines.length - 1]?.endsWith(",")) {
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
  }

  lines.push("}");
  return `${lines.join("\n")}\n`;
}

export async function renderClaudePluginManifest(rootDir: string, skills: CanonicalSkillSource[]): Promise<string> {
  const manifestPath = path.join(rootDir, "..", "..", ".claude", "plugins", "minutes", "plugin.json");
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as ClaudePluginManifest;

  const existingOrder = new Map(
    (manifest.skills ?? []).map((skill, index) => [skill.name, index]),
  );

  const generatedSkills = skills
    .map((skill) => ({
      name: skill.frontmatter.name,
      path: getRelativeSkillPath(skill),
    }))
    .sort((a, b) => {
      const aRank = existingOrder.get(a.name) ?? Number.MAX_SAFE_INTEGER;
      const bRank = existingOrder.get(b.name) ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return a.name.localeCompare(b.name);
    });

  const nextManifest: ClaudePluginManifest = {
    ...manifest,
    skills: generatedSkills,
  };

  return renderClaudePluginManifestText(nextManifest);
}
