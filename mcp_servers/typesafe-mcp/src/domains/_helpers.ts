import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { TypeSafeApiError } from 'node-typesafe';
import { READ_ONLY_ANNOTATIONS } from '../annotate-tool.js';

// Re-export the shared response-quality modules so every domain handler only
// needs to import from './_helpers.js'.
// The @shared alias is resolved by tsup's esbuildOptions alias to mcp_servers/_shared/.
export {
  shapeRaw,
  shapeList,
  shapeItem,
  extractShapeArgs,
  SHAPE_PROPS,
  type SummaryFn,
  type ShapeArgs,
} from '@shared/response-shaper.js';

export {
  toolError,
  missingCredsError,
  type ErrorCode,
} from '@shared/error-envelope.js';

import { toolError, toolErrorFromCatch } from '@shared/error-envelope.js';
import type { ErrorCode, ErrorContext, ToolResult } from '@shared/error-envelope.js';

export type CallToolResult = ToolResult;

/** A tool that only reads state: no DESTRUCTIVE/VISIBLE-TO-OTHERS marker, readOnlyHint true. */
export function readOnlyTool(tool: Tool): Tool {
  return { ...tool, annotations: { ...tool.annotations, ...READ_ONLY_ANNOTATIONS } };
}

/**
 * Every typesafe domain reports failures through this instead of the generic
 * @shared toolErrorFromCatch directly: TypeSafeApiError already carries a
 * code in the same ErrorCode vocabulary (MISSING_CREDENTIALS, FORBIDDEN,
 * RATE_LIMITED, ...), so reading it straight through is both simpler and more
 * accurate than the generic .status/.statusCode classifier, which would
 * misread the credential/network sentinel status of 0.
 */
export function typesafeToolError(toolName: string, err: unknown, ctx: ErrorContext = {}): ToolResult {
  if (err instanceof TypeSafeApiError) {
    return toolError(err.code as ErrorCode, `${toolName} failed: ${err.message}`, {
      detail: ctx.detail ?? err.body,
      hint: ctx.hint,
    });
  }
  return toolErrorFromCatch(toolName, err, ctx);
}
