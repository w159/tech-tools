import type { CallToolResult } from '../utils/types.js';

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
  missingCredsError,
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
