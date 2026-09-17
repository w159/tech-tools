// Tool annotation for the panos server.
//
// Usage:
//   import { annotate } from "./annotate-tool.js";
//   const tools = annotate(rawTools, "Panos");
//
// A tool's effect class is declared at its declaration site in src/domains/*
// with readOnlyTool() / destructiveTool() / unknownEffectTool() /
// credentialIssuingTool() from
// domains/_helpers.js. Those wrappers set the `DESTRUCTIVE: ` description
// prefix AND the machine-readable annotations below from one decision, so the
// prose a human reads and the flags an MCP client automates on cannot diverge.
//
// This module deliberately does NOT infer a class from the tool name. The
// earlier name-pattern classifier fell back to "read" for any name it did not
// match, which annotated panos_commit, panos_software_install,
// panos_system_reboot's siblings and 19 other mutating tools as
// readOnlyHint:true - i.e. safe to auto-run - while their own descriptions said
// DESTRUCTIVE. An unclassified tool now fails closed (annotated mutating) and
// loudly (stderr), never read-only.

import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * A tool that only reads appliance state: safe for a client to run without
 * prompting. openWorldHint stays true - every call leaves the process and
 * talks to a firewall whose state we do not own.
 */
export const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/**
 * A tool that changes appliance state. idempotentHint is false because
 * repeating any of these has additional effect (a second commit pushes
 * whatever landed in the candidate config meanwhile, a second install/reboot
 * takes the box down again), so a client must not treat a retry as free.
 */
export const MUTATING_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

/**
 * A tool whose only side effect is issuing a credential back to the caller -
 * panos_keygen mints a PAN-OS API key and returns it into the transcript.
 * Neither existing class is honest about it: readOnlyHint:true would tell a
 * client it is safe to auto-run, which is how a live long-lived credential
 * gets printed unattended, and destructiveHint:true would overstate it.
 *
 * readOnlyHint:false  - it is not a read: it hands back credential material.
 * destructiveHint:false - nothing on the appliance is destroyed or overwritten.
 * idempotentHint:true - PAN-OS returns the same key for the same credentials,
 *                       so a repeat call costs nothing extra.
 * openWorldHint:true  - as everywhere here, the call leaves the process.
 */
export const CREDENTIAL_ISSUING_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

// Annotate a list of Tool objects (returns new objects). The optional
// `vendorTitle` prefix produces a friendly display name like
// "Panos: config show" for the Title column in Claude Desktop.
export function annotate(tools: Tool[], vendorTitle?: string): Tool[] {
  return tools.map((t) => {
    const rest = vendorTitle
      ? t.name.replace(new RegExp(`^${vendorTitle.toLowerCase()}_`), "").replace(/_/g, " ")
      : undefined;
    const title = vendorTitle && rest ? `${vendorTitle}: ${rest}` : undefined;

    if (t.annotations?.readOnlyHint === undefined) {
      // Fail closed and loud: an unclassified tool is treated as mutating.
      // stderr only - stdout is the JSON-RPC channel.
      console.error(
        `[panos-mcp] tool ${t.name} declares no effect class; wrap it in ` +
          `readOnlyTool() / destructiveTool() / unknownEffectTool() / ` +
          `credentialIssuingTool() in its domain. ` +
          `Annotating it as mutating.`
      );
      return { ...t, annotations: { ...(title ? { title } : {}), ...MUTATING_ANNOTATIONS } };
    }

    return title ? { ...t, annotations: { title, ...t.annotations } } : t;
  });
}
