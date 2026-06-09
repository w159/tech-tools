import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '../utils/types.js';

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
  toolErrorFromCatch,
  missingCredsError,
} from '@shared/error-envelope.js';

export {
  resolveBaseUrl,
  describeBaseUrl,
} from '@shared/base-url.js';

/** Legacy thin wrapper kept for navigate/status inline responses in server.ts. */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Legacy thin wrapper; prefer toolErrorFromCatch in domain handlers. */
export function errorResult(msg: string): CallToolResult {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

/** Common pagination args shared by every *_list tool. */
export const paginationProps = {
  pageSize: { type: 'number', description: 'Page size (default 25, max usually 100).' },
  pageCursor: { type: 'string', description: 'Opaque cursor returned by a previous page as endCursor.' },
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

export function getTool(name: string, description: string, idName = 'id', idDesc = 'Resource ID'): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object' as const,
      properties: {
        [idName]: { type: 'string', description: idDesc },
      },
      required: [idName],
    },
  };
}
