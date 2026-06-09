import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '../utils/types.js';

// ---------------------------------------------------------------------------
// Shared response-quality modules — re-exported so domain files have one
// import target for both old helpers and new shaped variants.
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
// Legacy helpers — kept for any call site not yet on the shaped path.
// ---------------------------------------------------------------------------

/** @deprecated Use shapeRaw from response-shaper instead. */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** @deprecated Use toolError from error-envelope instead. */
export function errorResult(msg: string): CallToolResult {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

/**
 * Modern (CoreHR / API Hub) pagination args shared by every modern *_list
 * tool. Paylocity caps `limit` at 20.
 */
export const modernPaginationProps = {
  limit: {
    type: 'number',
    description: 'Page size (max 20 for Paylocity cursor endpoints).',
  },
  nextToken: {
    type: 'string',
    description: 'Opaque cursor from the previous page (pagination.nextToken).',
  },
};

/** Optional companyId override common to every tool. */
export const companyIdProp = {
  companyId: {
    type: 'string',
    description:
      'Override the default companyId for this call (defaults to PAYLOCITY_COMPANY_ID env var).',
  },
};

export function modernListTool(
  name: string,
  description: string,
  extraProps: Record<string, unknown> = {}
): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...modernPaginationProps,
        ...companyIdProp,
        ...extraProps,
      },
    },
  };
}

export function legacyListTool(
  name: string,
  description: string,
  extraProps: Record<string, unknown> = {}
): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...companyIdProp,
        ...extraProps,
      },
    },
  };
}

export function getTool(
  name: string,
  description: string,
  extraProps: Record<string, unknown> = {},
  required: string[] = []
): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...companyIdProp,
        ...extraProps,
      },
      required,
    },
  };
}
