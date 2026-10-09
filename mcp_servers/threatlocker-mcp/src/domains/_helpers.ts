import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '../utils/types.js';

// Re-export the shared response-quality modules so every domain handler
// only needs to import from './_helpers.js'.
// The @shared alias is resolved by tsup's esbuildOptions alias to mcp_servers/_shared/.
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
import { toolErrorFromCatch as sharedToolErrorFromCatch } from '@shared/error-envelope.js';

/**
 * ThreatLocker answers HTTP 440 {"error":"TOKEN_REVOKED"} for ANY token it does
 * not recognize (a zero-filled token gets the same body), so the vendor wording
 * does not mean the key was revoked. The per-call-site "verify env vars are set"
 * hint is wrong here: the vars are set, the value is not a live API User token.
 */
export const TOKEN_NOT_RECOGNIZED_HINT =
  'HTTP 440 TOKEN_REVOKED: the ThreatLocker instance at THREATLOCKER_BASE_URL does not recognize this token. ' +
  'It returns this for any unknown value, so it means one of: the token belongs to a different instance ' +
  '(the letter in your portal URL, e.g. portal.h.threatlocker.com; the default base URL assumes "g"), ' +
  'the API User token expired (they expire after the configured inactivity window), was deleted, was mistyped, ' +
  'or the organization Auth Key (agent install key) was pasted instead of an API User token. ' +
  'First call threatlocker_status: it probes every instance and names the one that accepts the key. ' +
  'If none does: Portal > Manage > Users > API Users > New API User with a role, copy the token, enter it where ' +
  'Claude Code reads this plugin\'s sensitive settings (the plugin configure prompt; for the atlas plugin that is ' +
  'Keychain-backed, not settings.json or a repo .env), restart Claude Code, then call threatlocker_status again.';

export function toolErrorFromCatch(
  operation: string,
  err: unknown,
  ctx: { detail?: string; hint?: string } = {},
): CallToolResult {
  const statusCode = (err as { statusCode?: unknown } | null)?.statusCode;
  const hint = statusCode === 440 ? TOKEN_NOT_RECOGNIZED_HINT : ctx.hint;
  return sharedToolErrorFromCatch(operation, err, { ...ctx, hint }) as CallToolResult;
}

export {
  resolveBaseUrl,
  describeBaseUrl,
} from '@shared/base-url.js';

// ---------------------------------------------------------------------------
// Human-readable translations of the PortalAPI enums
// ---------------------------------------------------------------------------

/** statusId values from threatlocker.kb.help/portalapiapprovalrequest/. */
export const APPROVAL_STATUS_BY_NAME: Record<string, number> = {
  pending: 1,
  approved: 4,
  'not learned': 6,
  rejected: 10,
  denied: 10, // common wording; the API calls it Rejected
  'added to application': 12,
  escalated: 13,
  'self-approved': 16,
};
export const APPROVAL_STATUS_NAME: Record<number, string> = {
  1: 'Pending', 4: 'Approved', 6: 'Not Learned', 10: 'Rejected',
  12: 'Added to Application', 13: 'Escalated from the Cyber Heroes', 16: 'Self-Approved',
};

/** osType values from threatlocker.kb.help/portalapicomputergroup/. */
export const OS_TYPE_NAME: Record<number, string> = { 0: 'All', 1: 'Windows', 2: 'macOS', 3: 'Linux', 5: 'Windows XP' };
export const OS_TYPE_BY_NAME: Record<string, number> = { all: 0, windows: 1, mac: 2, macos: 2, linux: 3, 'windows xp': 5 };

export function approvalStatusId(name: string | undefined): number {
  if (!name) return 1;
  const id = APPROVAL_STATUS_BY_NAME[name.trim().toLowerCase()];
  if (id === undefined) {
    throw new Error(`Unknown approval status "${name}". Use one of: ${Object.keys(APPROVAL_STATUS_NAME).map(k => APPROVAL_STATUS_NAME[Number(k)]).join(', ')}.`);
  }
  return id;
}

/** "YYYY-MM-DDTHH:MM:SSZ": ThreatLocker rejects fractional seconds. */
export function toPortalDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${String(value)}`);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Prefix a list result with a one-line summary object (counts, filters) so the
 * answer to "how many" is at the top instead of buried in per-row fields.
 */
export function withSummary(result: CallToolResult, summary: Record<string, unknown>): CallToolResult {
  const [first, ...rest] = result.content;
  const text = `${JSON.stringify(summary)}\n${first?.type === 'text' ? first.text : ''}`;
  return { ...result, content: [{ type: 'text', text }, ...rest] };
}

/** Thin wrapper kept for navigate/status inline responses in server.ts. */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Common pagination args shared by list tools. */
export const paginationProps = {
  pageNumber: { type: 'number', description: 'Page number for pagination (default: 1).' },
  pageSize:   { type: 'number', description: 'Records per page (default: 50).' },
};

export function listTool(name: string, description: string, extraProps: Record<string, unknown> = {}): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object' as const,
      properties: { ...paginationProps, ...extraProps },
    },
  };
}
