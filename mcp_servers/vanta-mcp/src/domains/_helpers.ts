import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Re-export the shared response-quality modules so every domain handler
// only needs to import from './_helpers.js'.
// The @shared alias is resolved by tsup's alias config to mcp_servers/_shared/.
export {
  shapeList,
  shapeItem,
  extractShapeArgs,
  SHAPE_PROPS,
  type SummaryFn,
} from '@shared/response-shaper.js';

export {
  toolErrorFromCatch,
} from '@shared/error-envelope.js';

export {
  describeBaseUrl,
} from '@shared/base-url.js';

/** Common pagination args shared by every *_list tool. */
const paginationProps = {
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
