import path from "node:path";
import type {
  CanonicalSkillSource,
  CompiledSkillArtifact,
  HostConfig,
  HostName,
} from "../schema.js";

function rewritePaths(body: string, host: HostConfig): string {
  return host.pathPolicy.pathRewrites.reduce(
    (current, rewrite) => current.split(rewrite.from).join(rewrite.to),
    body,
  );
}

function rewriteCodexPluginPaths(body: string, skill: CanonicalSkillSource): string {
  return body
    .replace(
      /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/([^/]+)\/(scripts|templates|references)\//g,
      (_match, targetSkill: string, kind: string) =>
        targetSkill === skill.frontmatter.name
          ? `$MINUTES_SKILL_ROOT/${kind}/`
          : `$MINUTES_SKILLS_ROOT/${targetSkill}/${kind}/`,
    )
    .replace(
      /\.claude\/plugins\/minutes\/skills\/([^/]+)\/(scripts|templates|references)\//g,
      (_match, targetSkill: string, kind: string) =>
        targetSkill === skill.frontmatter.name
          ? `$MINUTES_SKILL_ROOT/${kind}/`
          : `$MINUTES_SKILLS_ROOT/${targetSkill}/${kind}/`,
    );
}

function rewriteSkillScopedAssetPaths(body: string, skill: CanonicalSkillSource, host: HostConfig): string {
  if (host.name !== "codex" && host.name !== "opencode") return body;
  return rewriteCodexPluginPaths(body, skill);
}

function appendFrontmatterField(
  lines: string[],
  key: string,
  value: unknown,
  indent = 0,
): void {
  const prefix = " ".repeat(indent);
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    lines.push(`${prefix}${key}:`);
    for (const item of value) {
      lines.push(`${prefix}  - ${String(item)}`);
    }
    return;
  }

  if (typeof value === "object") {
    lines.push(`${prefix}${key}:`);
    for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      appendFrontmatterField(lines, nestedKey, nestedValue, indent + 2);
    }
    return;
  }

  lines.push(`${prefix}${key}: ${String(value)}`);
}

function overflowDescription(description: string, host: HostConfig): string {
  const limit = host.descriptionPolicy.maxLength;
  if (!limit || description.length <= limit) return description;
  if (host.descriptionPolicy.onOverflow === "truncate") {
    return `${description.slice(0, limit - 3)}...`;
  }
  throw new Error(
    `Description for ${host.name} exceeds limit ${limit}: ${description.length} characters`,
  );
}

function applyHostFrontmatter(
  skill: CanonicalSkillSource,
  host: HostConfig,
): string {
  const override = skill.frontmatter.host_overrides?.[host.name as HostName];
  const description = overflowDescription(
    override?.description_override ?? skill.frontmatter.description,
    host,
  );
  const lines = [`---`, `name: ${skill.frontmatter.name}`, `description: ${description}`];
  for (const [key, value] of Object.entries(host.frontmatterPolicy.extraFields ?? {})) {
    appendFrontmatterField(lines, key, value);
  }
  const userInvocable = skill.frontmatter.user_invocable;
  if (
    host.frontmatterPolicy.mode === "denylist" &&
    userInvocable !== undefined &&
    !host.frontmatterPolicy.stripFields?.includes("user_invocable")
  ) {
    lines.push(`user_invocable: ${userInvocable ? "true" : "false"}`);
  }
  const allowedTools = skill.frontmatter.allowed_tools;
  if (
    host.frontmatterPolicy.mode === "denylist" &&
    Array.isArray(allowedTools) &&
    allowedTools.length > 0 &&
    !host.frontmatterPolicy.stripFields?.includes("allowed_tools")
  ) {
    lines.push(`allowed-tools:`);
    for (const tool of allowedTools) {
      lines.push(`  - ${tool}`);
    }
  }
  lines.push(`---`);
  return `${lines.join("\n")}\n\n`;
}

function makeSkillRootNote(host: HostConfig, skillName: string): string {
  const root =
    host.name === "codex"
      ? ".agents/skills/minutes"
      : host.name === "opencode"
        ? ".opencode/skills"
        : null;
  if (!root) return "";
  return `## Skill Path\n\nBefore running helper scripts or opening bundled references, set:\n\n\`\`\`bash\nexport MINUTES_SKILLS_ROOT=\"$(git rev-parse --show-toplevel)/${root}\"\nexport MINUTES_SKILL_ROOT=\"$MINUTES_SKILLS_ROOT/${skillName}\"\n\`\`\`\n\n`;
}

function makeOpenCodeCommand(skill: CanonicalSkillSource, host: HostConfig): {
  relativePath: string;
  content: string;
} | null {
  if (host.name !== "opencode") return null;
  const description = overflowDescription(skill.frontmatter.description, host);
  return {
    relativePath: path.join(".opencode", "commands", `${skill.frontmatter.name}.md`),
    content: [
      "---",
      `description: ${description}`,
      "---",
      "",
      `Load the \`${skill.frontmatter.name}\` skill and follow it exactly for this request.`,
      "",
      "User arguments: $ARGUMENTS",
      "",
      "If no arguments were provided, use the skill's normal no-argument/default flow instead of stopping to ask for input.",
      "",
    ].join("\n"),
  };
}

export function renderSkillForHost(
  skill: CanonicalSkillSource,
  host: HostConfig,
): CompiledSkillArtifact {
  const override = skill.frontmatter.host_overrides?.[host.name];
  const rewrittenBody = rewriteSkillScopedAssetPaths(
    rewritePaths(skill.body.trimStart(), host),
    skill,
    host,
  );
  const extraNotes = override?.extra_notes?.trim();
  const outputPath =
    skill.frontmatter.output?.[host.name]?.path ??
    (host.name === "claude"
      ? path.join(host.outputRoot, "skills", skill.frontmatter.name, "SKILL.md")
      : path.join(host.outputRoot, skill.frontmatter.name, "SKILL.md"));

  const frontmatter = applyHostFrontmatter(skill, host);
  const metadata = skill.frontmatter.metadata ?? {};
  const metadataDescription = overflowDescription(
    metadata.short_description ??
      override?.description_override ??
      skill.frontmatter.description,
    host,
  );
  const assetFiles =
    host.assetPolicy.mode === "copy"
      ? [
          ...(skill.frontmatter.assets?.scripts ?? []).map((asset) => ({
            sourceRelativePath: asset,
            outputRelativePath: path.join(path.dirname(outputPath), asset),
          })),
          ...(skill.frontmatter.assets?.templates ?? []).map((asset) => ({
            sourceRelativePath: asset,
            outputRelativePath: path.join(path.dirname(outputPath), asset),
          })),
          ...(skill.frontmatter.assets?.references ?? []).map((asset) => ({
            sourceRelativePath: asset,
            outputRelativePath: path.join(path.dirname(outputPath), asset),
          })),
        ]
      : [];

  const needsSkillRootNote =
    (host.name === "codex" || host.name === "opencode") &&
    (assetFiles.length > 0 ||
      rewrittenBody.includes("$MINUTES_SKILL_ROOT") ||
      rewrittenBody.includes("$MINUTES_SKILLS_ROOT"));

  const skillRootNote = needsSkillRootNote ? makeSkillRootNote(host, skill.frontmatter.name) : "";

  const body =
    host.transformPolicy.extraNotesPlacement === "prepend" && extraNotes
      ? `${frontmatter}${skillRootNote}${extraNotes}\n\n${rewrittenBody}\n`
      : host.transformPolicy.extraNotesPlacement === "append" && extraNotes
        ? `${frontmatter}${skillRootNote}${rewrittenBody}\n\n## Host Notes\n\n${extraNotes}\n`
        : `${frontmatter}${skillRootNote}${rewrittenBody}\n`;

  const openCodeCommand = makeOpenCodeCommand(skill, host);
  const sidecarFiles = [
    ...(
      host.metadataPolicy.generateSidecar && host.metadataPolicy.format === "openai.yaml"
      ? [
          {
            relativePath: path.join(
              path.dirname(outputPath),
              host.metadataPolicy.relativeDir ?? "",
              "openai.yaml",
            ),
            content: [
              "interface:",
              `  display_name: ${JSON.stringify(metadata.display_name ?? skill.frontmatter.name)}`,
              `  short_description: ${JSON.stringify(metadataDescription)}`,
              ...(metadata.icon_small
                ? [`  icon_small: ${JSON.stringify(metadata.icon_small)}`]
                : []),
              ...(metadata.icon_large
                ? [`  icon_large: ${JSON.stringify(metadata.icon_large)}`]
                : []),
              `  default_prompt: ${JSON.stringify(
                metadata.default_prompt ?? `Use ${skill.frontmatter.name} for this task.`,
              )}`,
              "",
            ].join("\n"),
          },
        ]
      : []
    ),
    ...(openCodeCommand ? [openCodeCommand] : []),
  ];

  return {
    host: host.name,
    skillName: skill.frontmatter.name,
    outputPath,
    body,
    assetFiles,
    sidecarFiles,
  };
}
