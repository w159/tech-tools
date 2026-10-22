import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

// Annotation presets that map to Claude Desktop's tool-permissions grouping:
//   readOnlyHint: true                  -> "Read-only tools" bucket
//   readOnlyHint: false                 -> "Write/delete tools" bucket
//   (neither hint)                      -> "Other tools" bucket
// All ConnectWise tools talk to a remote system, so openWorldHint is always true.

export const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export const WRITE_CREATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export const WRITE_UPDATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

export const titled = (title: string, base: ToolAnnotations): ToolAnnotations => ({
  title,
  ...base,
});
