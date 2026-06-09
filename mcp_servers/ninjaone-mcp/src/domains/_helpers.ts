/**
 * _helpers.ts — shared response-quality re-exports for NinjaOne domain handlers.
 *
 * All domain files import from here rather than directly from _shared/ so there
 * is one canonical import path and the tsconfig widening is contained.
 *
 * Relative path to _shared/ from src/domains/: ../../../_shared/
 * (ninjaone-mcp/src/domains/ -> ninjaone-mcp/ -> mcp_servers/ -> mcp_servers/_shared/)
 */

export {
  shapeList,
  shapeItem,
  shapeRaw,
  extractShapeArgs,
  SHAPE_PROPS,
  type SummaryFn,
  type ShapeArgs,
} from "../../../_shared/response-shaper.js";

export {
  toolError,
  toolErrorFromCatch,
  missingCredsError,
} from "../../../_shared/error-envelope.js";

export {
  resolveBaseUrl,
  describeBaseUrl,
} from "../../../_shared/base-url.js";
