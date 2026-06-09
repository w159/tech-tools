import type { HostConfig } from "../schema.js";

export const opencodeHost: HostConfig = {
  name: "opencode",
  displayName: "OpenCode",
  outputRoot: ".opencode/skills",
  pathPolicy: {
    defaultSkillDir: ".",
    pathRewrites: [
      { from: "${CLAUDE_PLUGIN_ROOT}/hooks/lib", to: "$MINUTES_SKILLS_ROOT/_runtime/hooks/lib" },
      { from: ".claude/plugins/minutes", to: ".opencode/skills" },
    ],
  },
  frontmatterPolicy: {
    mode: "allowlist",
    keepFields: ["name", "description"],
    extraFields: {
      compatibility: "opencode",
    },
  },
  descriptionPolicy: {
    maxLength: 1024,
    onOverflow: "error",
  },
  metadataPolicy: {
    generateSidecar: false,
    format: null,
    relativeDir: null,
  },
  transformPolicy: {
    extraNotesPlacement: "append",
  },
  assetPolicy: {
    mode: "copy",
  },
};
