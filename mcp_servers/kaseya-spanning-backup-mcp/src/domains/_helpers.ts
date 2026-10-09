import type { CallToolResult } from '../utils/types.js';
import { SHAPE_PROPS } from '../../../_shared/response-shaper.js';
import { toolError } from '../../../_shared/error-envelope.js';

// ---------------------------------------------------------------------------
// Shared response-quality modules — re-exported so domain files have one
// import target instead of reaching directly into _shared/.
// ---------------------------------------------------------------------------

export {
  shapeList,
  shapeItem,
  shapeRaw,
  extractShapeArgs,
  SHAPE_PROPS,
  type SummaryFn,
  type ShapeArgs,
} from '../../../_shared/response-shaper.js';

export {
  toolError,
  toolErrorFromCatch,
} from '../../../_shared/error-envelope.js';

export {
  resolveBaseUrl,
  describeBaseUrl,
} from '../../../_shared/base-url.js';

// ---------------------------------------------------------------------------
// Convenience helpers shared across Spanning domain handlers.
// ---------------------------------------------------------------------------

/** Fallback for unknown tool names within a domain handler. */
export function unknownTool(name: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  };
}

/** Pull the item array out of a list response that is either a bare array or `{ [key]: [...] }` / `{ items: [...] }`. */
export function extractItems(result: unknown, key: string): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const body = result as Record<string, unknown>;
  return (body[key] ?? body['items'] ?? []) as Record<string, unknown>[];
}

/** Input schema for a tool whose only required argument is `userId`. */
export function userIdInputSchema() {
  return {
    type: 'object' as const,
    properties: {
      ...SHAPE_PROPS,
      userId: { type: 'string', description: 'Spanning user ID (required) — opaque string from spanning_users_list.' },
    },
    required: ['userId'],
  };
}

/** Error result for a missing `userId` argument. */
export function missingUserIdError(): CallToolResult {
  return toolError('INVALID_ARGS', 'userId is required.', {
    hint: 'Pass the opaque userId string returned by spanning_users_list.',
  });
}
