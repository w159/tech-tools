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
