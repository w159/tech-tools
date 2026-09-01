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
  'HTTP 440 TOKEN_REVOKED: ThreatLocker does not recognize this token. It returns this for any ' +
  'unknown value, so it means one of: the API User token expired (they expire after the configured ' +
  'inactivity window), was deleted, was mistyped, or the organization Auth Key (agent install key) ' +
  'was pasted instead of an API User token. Fix: Portal > Manage > Users > API Users > New API User ' +
  'with a role, copy the token, enter it where Claude Code reads this plugin\'s sensitive settings ' +
  '(the plugin configure prompt; for the atlas plugin that is Keychain-backed, not settings.json or a repo .env), ' +
  'confirm THREATLOCKER_BASE_URL matches the instance letter shown under Help in the Portal, restart Claude Code, ' +
  'then call threatlocker_status and confirm the key prefix it prints is the new token.';

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
