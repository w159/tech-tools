// Tool annotation for the typesafe server.
//
// Usage:
//   import { annotate } from "./annotate-tool.js";
//   const tools = annotate(rawTools, "Typesafe");
//
// A tool's effect class is declared at its declaration site in src/domains/*
// with readOnlyTool() from domains/_helpers.js, which sets the machine-readable
// annotations below. This module deliberately does NOT infer a class from the
// tool name - see mcp_servers/panos-mcp/src/annotate-tool.ts for why a
// name-pattern fallback is unsafe (it shipped several mutating panos tools as
// readOnlyHint:true). An unclassified tool fails closed (annotated mutating)
// and loudly (stderr), never silently read-only.
//
// All three shipped tools (typesafe_status, typesafe_decide,
// typesafe_list_models) are pure reads: none of them mutate vendor-side
// state, not even typesafe_decide - it only asks Jev a typed question about a
// state the caller supplies and returns typed answers, so there is currently
// no destructive/credential-issuing wrapper to reach for.

import type { Tool, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * A tool that only reads state (env config or asks Jev a question): safe for
 * a client to run without prompting. openWorldHint stays true - every call
 * that reaches a provider leaves the process.
 */
export const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** Fail-closed default for any tool that declares no effect class. */
export const MUTATING_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

// Annotate a list of Tool objects (returns new objects). The optional
// `vendorTitle` prefix produces a friendly display name like
// "Typesafe: decide" for the Title column in Claude Desktop.
export function annotate(tools: Tool[], vendorTitle?: string): Tool[] {
  return tools.map((t) => {
    const rest = vendorTitle
      ? t.name.replace(new RegExp(`^${vendorTitle.toLowerCase()}_`), '').replace(/_/g, ' ')
      : undefined;
    const title = vendorTitle && rest ? `${vendorTitle}: ${rest}` : undefined;

    if (t.annotations?.readOnlyHint === undefined) {
      // Fail closed and loud: an unclassified tool is treated as mutating.
      // stderr only - stdout is the JSON-RPC channel.
      console.error(
        `[typesafe-mcp] tool ${t.name} declares no effect class; wrap it in ` +
          `readOnlyTool() in its domain. Annotating it as mutating.`
      );
      return { ...t, annotations: { ...(title ? { title } : {}), ...MUTATING_ANNOTATIONS } };
    }

    return title ? { ...t, annotations: { title, ...t.annotations } } : t;
  });
}
