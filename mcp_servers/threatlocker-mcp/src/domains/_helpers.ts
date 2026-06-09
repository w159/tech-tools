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
  toolErrorFromCatch,
  missingCredsError,
} from '@shared/error-envelope.js';

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
