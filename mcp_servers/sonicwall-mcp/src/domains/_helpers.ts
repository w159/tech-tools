import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { SonicwallClient } from 'node-sonicwall';
import type { CallToolResult, DomainHandler } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { sonicwallToolError } from '../utils/sonicwall-error.js';
import {
  CREDENTIAL_ISSUING_ANNOTATIONS,
  MUTATING_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
} from '../annotate-tool.js';
import { shapeRaw } from '@shared/response-shaper.js';
import { hasOp } from '../utils/inventory.js';

import { toolError } from '@shared/error-envelope.js';
export { toolError };
export { shapeRaw };

// Every domain reports SonicOS failures through this one mapping rather than
// the generic @shared classifier: it is the only thing that reads a
// SonicwallApiError's code / httpStatus and picks the matching hint. The
// generic toolErrorFromCatch is deliberately NOT re-exported here so a domain
// cannot fall back to it by accident.
export { sonicwallToolError } from '../utils/sonicwall-error.js';

// ---- Effect class, declared once per tool at its declaration site ---------
// These wrappers are the ONLY place a tool's safety signals are set, so the
// `DESTRUCTIVE: ` prefix and the annotations a client automates on come from
// one decision. annotate() fails closed (mutating, loud on stderr) for a tool
// that goes through none of them.

export function destructiveTool(tool: Tool): Tool {
  const description = tool.description?.startsWith('DESTRUCTIVE:')
    ? tool.description
    : `DESTRUCTIVE: ${tool.description ?? ''}`.trim();
  return { ...tool, description, annotations: { ...tool.annotations, ...MUTATING_ANNOTATIONS } };
}

export function readOnlyTool(tool: Tool): Tool {
  return { ...tool, annotations: { ...tool.annotations, ...READ_ONLY_ANNOTATIONS } };
}

/** A passthrough whose effect is not knowable at declaration time (sonicwall_request): fails closed onto the mutating annotations, keeps its own description. */
export function unknownEffectTool(tool: Tool): Tool {
  return { ...tool, annotations: { ...tool.annotations, ...MUTATING_ANNOTATIONS } };
}

/** Part of the fleet contract; SonicOS has no API-key mint, so no sonicwall tool uses it. */
export function credentialIssuingTool(tool: Tool): Tool {
  return { ...tool, annotations: { ...tool.annotations, ...CREDENTIAL_ISSUING_ANNOTATIONS } };
}

// ---- Shared call plumbing -------------------------------------------------

/** Appended to every staged write so the model never assumes a write took effect. */
export const STAGED_NOTE =
  'This stages the change in the pending config only; nothing takes effect until sonicwall_config_commit is called as a separate step.';

let warningsShown = 0;
/** Client warnings (e.g. "re-login discarded pending config") the caller has not seen yet. */
function newWarnings(client: SonicwallClient): string[] {
  const all = client.warnings();
  const fresh = all.slice(warningsShown);
  warningsShown = all.length;
  return fresh;
}

function withNotes(res: CallToolResult, notes: string[]): CallToolResult {
  if (notes.length) res.content.push({ type: 'text', text: notes.join('\n') });
  return res;
}

/**
 * Run one client call and shape the outcome. A throw becomes a classified tool
 * error; client warnings ride along on both paths.
 */
export async function run(
  operation: string,
  fn: (client: SonicwallClient) => Promise<unknown>,
  opts: { note?: string; hint?: string } = {},
): Promise<CallToolResult> {
  let client: SonicwallClient | undefined;
  try {
    client = await getClient();
    const data = await fn(client);
    return withNotes(shapeRaw(data === undefined ? { ok: true } : data), [...newWarnings(client), ...(opts.note ? [opts.note] : [])]);
  } catch (err) {
    return withNotes(sonicwallToolError(operation, err, { hint: opts.hint }), client ? newWarnings(client) : []);
  }
}

/** A local validation failure: no network call has happened and none will. */
export function invalid(message: string, hint?: string): CallToolResult {
  return toolError('INVALID_ARGS', message, hint ? { hint } : {});
}

export interface Entry {
  tool: Tool;
  run: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

/** Build a DomainHandler from tool/run pairs, so a tool and its behaviour are declared together. */
export function defineDomain(entries: Entry[]): DomainHandler {
  const byName = new Map(entries.map((e) => [e.tool.name, e]));
  return {
    getTools: () => entries.map((e) => e.tool),
    handleCall: async (toolName, args) => {
      const entry = byName.get(toolName);
      if (!entry) return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
      return entry.run(args);
    },
  };
}

/** A zero-argument GET, the shape of most read tools. */
export function getEntry(name: string, description: string, path: string, accept?: 'text/plain'): Entry {
  return {
    tool: readOnlyTool({ name, description, inputSchema: { type: 'object' as const, properties: {} } }),
    run: () => run(name, (c) => c.request('GET', path, accept ? { accept } : {})),
  };
}

/** A GET that accepts an optional free-form `query` object of vendor query parameters. */
export function queryEntry(name: string, description: string, path: string, accept?: 'text/plain'): Entry {
  return {
    tool: readOnlyTool({
      name,
      description,
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'object', description: 'Optional vendor query parameters as a flat object, e.g. {"limit": 100}. Ground names with sonicwall_navigate.' },
        },
      },
    }),
    run: (args) => run(name, (c) => c.request('GET', path, { query: toQuery(args.query), ...(accept ? { accept } : {}) })),
  };
}

export function toQuery(raw: unknown): Record<string, string | number | boolean> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/** Local guard: reject a method the endpoint inventory does not list for this route, before any network call. */
export function hasOpOrInvalid(method: string, templatePath: string, tool: string): CallToolResult | undefined {
  if (hasOp(method, templatePath)) return undefined;
  return invalid(
    `${tool}: the SonicOS inventory has no ${method} for ${templatePath}.`,
    method === 'PATCH' ? 'This resource has no PATCH; call again without patch: true (PUT replaces the whole object).' : undefined,
  );
}
