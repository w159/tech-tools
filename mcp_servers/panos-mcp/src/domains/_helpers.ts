import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '../utils/types.js';
import {
  CREDENTIAL_ISSUING_ANNOTATIONS,
  MUTATING_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
} from '../annotate-tool.js';

// Re-export the shared response-quality modules so every domain handler
// only needs to import from './_helpers.js'.
// The @shared alias is resolved by tsup's alias config to mcp_servers/_shared/.
export {
  shapeList,
  shapeItem,
  shapeRaw,
  extractShapeArgs,
  SHAPE_PROPS,
  type SummaryFn,
  type ShapeArgs,
} from '@shared/response-shaper.js';

export {
  toolError,
  missingCredsError,
} from '@shared/error-envelope.js';

// Every domain reports PAN-OS failures through this one mapping rather than
// the generic @shared classifier: it is the only thing that reads a
// PanosApiError's code / <msg> / httpStatus and picks a hint that matches the
// actual failure. The generic toolErrorFromCatch is deliberately NOT
// re-exported here so a domain cannot fall back to it by accident.
export { panosToolError } from '../utils/panos-error.js';

/** Legacy thin wrapper kept for navigate/status inline responses in server.ts. */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Legacy thin wrapper; prefer panosToolError in domain handlers. */
export function errorResult(msg: string): CallToolResult {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

/**
 * Shared optional `target` argument every domain tool declares identically:
 * the managed-firewall serial to route a Panorama call to, overriding
 * PANOS_TARGET for this one call.
 */
export const TARGET_PROP = {
  target: {
    type: 'string',
    description: 'Optional managed-firewall serial number, overriding PANOS_TARGET for this call.',
  },
};

// ---- Effect class, declared once per tool at its declaration site ---------
//
// These four wrappers are the ONLY place a panos tool's safety signals are
// set, so the `DESTRUCTIVE: ` description prefix required by
// docs/panos-connector-design.md and the readOnlyHint / destructiveHint
// annotations an MCP client automates on come from a single decision and
// cannot drift apart. A tool that goes through none of them is annotated
// mutating, with a loud stderr complaint, by annotate() - never read-only.

/**
 * Prefix a mutating tool's description with `DESTRUCTIVE: `, per the safety
 * rule in docs/panos-connector-design.md - the marker is mechanical, not
 * something every domain author has to remember to type - and carry the
 * matching machine-readable annotations.
 */
export function destructiveTool(tool: Tool): Tool {
  const description = tool.description?.startsWith('DESTRUCTIVE:')
    ? tool.description
    : `DESTRUCTIVE: ${tool.description ?? ''}`.trim();
  return { ...tool, description, annotations: { ...tool.annotations, ...MUTATING_ANNOTATIONS } };
}

/** A tool that only reads appliance state: no prefix, readOnlyHint true. */
export function readOnlyTool(tool: Tool): Tool {
  return { ...tool, annotations: { ...tool.annotations, ...READ_ONLY_ANNOTATIONS } };
}

/**
 * A passthrough whose effect is not knowable at declaration time - panos_op
 * takes arbitrary `<cmd>` XML and can reboot the appliance or clear sessions as
 * easily as it can show system info. It fails closed onto the mutating
 * annotations so no client auto-runs it, but it keeps its own description:
 * a blanket `DESTRUCTIVE: ` prefix would claim every op command mutates, and
 * its description already spells out the hazard in full.
 */
export function unknownEffectTool(tool: Tool): Tool {
  return { ...tool, annotations: { ...tool.annotations, ...MUTATING_ANNOTATIONS } };
}

/**
 * A tool whose side effect is handing the caller a credential - panos_keygen
 * mints a PAN-OS API key and returns it into the transcript. readOnlyTool()
 * would advertise that as safe to auto-run, which is how a long-lived
 * credential gets printed unattended; destructiveTool() would overstate it,
 * since keygen destroys nothing and PAN-OS answers the same key for the same
 * credentials. No `DESTRUCTIVE: ` prefix for the same reason - the tool is not
 * destructive, and its own description already spells out the
 * transcript-exposure hazard in full.
 */
export function credentialIssuingTool(tool: Tool): Tool {
  return {
    ...tool,
    annotations: { ...tool.annotations, ...CREDENTIAL_ISSUING_ANNOTATIONS },
  };
}
