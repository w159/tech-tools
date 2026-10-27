// ---------------------------------------------------------------------------
// Shared response-quality modules — re-exported so domain files have one
// import target for both old helpers and new shaped variants.
// ---------------------------------------------------------------------------

export {
  shapeList,
  shapeItem,
  extractShapeArgs,
  SHAPE_PROPS,
  type SummaryFn,
} from '../../../_shared/response-shaper.js';

export {
  toolError,
  toolErrorFromCatch,
} from '../../../_shared/error-envelope.js';

export {
  describeBaseUrl,
} from '../../../_shared/base-url.js';
