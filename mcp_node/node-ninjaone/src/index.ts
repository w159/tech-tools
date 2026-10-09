/**
 * node-ninjaone
 * Comprehensive, fully-typed Node.js/TypeScript library for the NinjaOne/NinjaRMM API
 */

// Main client
export { NinjaOneClient } from './client.js';

// Configuration
export type { NinjaOneConfig, RateLimitConfig, NinjaOneRegion, NinjaOneScope } from './config.js';
export { DEFAULT_RATE_LIMIT_CONFIG, REGION_URLS } from './config.js';

// Error classes
export {
  NinjaOneError,
  NinjaOneAuthenticationError,
  NinjaOneForbiddenError,
  NinjaOneNotFoundError,
  NinjaOneValidationError,
  NinjaOneRateLimitError,
  NinjaOneServerError,
} from './errors.js';

// Request/response types owned by resource modules
export type {
  RebootMode,
  ServiceAction,
  PatchType,
  PatchAction,
  RunScriptBody,
  MaintenanceWindow,
} from './resources/devices.js';
export type { JobListParams } from './resources/automation.js';

// Types
export * from './types/index.js';
