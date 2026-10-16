/**
 * Configuration types and defaults for the Spanning Cloud Backup client.
 */

/**
 * Supported Spanning platforms.
 *
 * Spanning Cloud Backup is split across three independent platforms — each
 * with its own base URL. An API token issued for one platform CANNOT call
 * another platform's endpoints. Choose the platform that matches the token
 * you provisioned in the Spanning admin console.
 */
export type SpanningPlatform = 'm365' | 'gws' | 'salesforce';

/**
 * Per-platform base URLs.
 *
 * Note: unlike many SaaS backup vendors, Spanning's split is by **product**,
 * not by region. There is no separate US / EU base URL.
 */
export const PLATFORM_BASE_URLS: Readonly<Record<SpanningPlatform, string>> = {
  m365: 'https://o365-api.spanningbackup.com/external',
  gws: 'https://api.spanningbackup.com/external',
  salesforce: 'https://salesforce-api.spanningbackup.com',
};

/** Default platform if none is supplied. */
export const DEFAULT_PLATFORM: SpanningPlatform = 'm365';

/**
 * Rate limiting configuration.
 *
 * Spanning enforces 100 requests/minute per token. The defaults here cap
 * concurrency at 4 and back off aggressively on 429.
 */
export interface RateLimitConfig {
  /** Whether rate limiting is enabled (default: true) */
  enabled: boolean;
  /** Maximum requests per window (default: 100) */
  maxRequests: number;
  /** Window duration in milliseconds (default: 60000) */
  windowMs: number;
  /** Threshold percentage to start throttling (default: 0.8 = 80%) */
  throttleThreshold: number;
  /** Default delay between retries on 429 (default: 5000ms) */
  retryAfterMs: number;
  /** Maximum retry attempts on rate limit errors (default: 3) */
  maxRetries: number;
  /** Maximum concurrent in-flight requests (default: 4) */
  maxConcurrency: number;
}

/**
 * Default rate limit configuration tuned for Spanning (100/min).
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  enabled: true,
  maxRequests: 100,
  windowMs: 60_000,
  throttleThreshold: 0.8,
  retryAfterMs: 5_000,
  maxRetries: 3,
  maxConcurrency: 4,
};

/**
 * Configuration for the Spanning client.
 */
export interface SpanningConfig {
  /**
   * Admin email address that the API token is bound to.
   *
   * Spanning ties tokens to a specific admin account — both the email AND the
   * token must match what was issued, or the API returns a generic 401.
   */
  adminEmail: string;
  /** Spanning API token issued from the admin console for {@link adminEmail}. */
  apiToken: string;
  /** Platform to target — m365, gws (Google Workspace), or salesforce. */
  platform?: SpanningPlatform;
  /**
   * Override the API base URL. When set, this takes precedence over `platform`.
   * Provided for forward-compatibility / staging.
   */
  apiUrl?: string;
  /** Rate limiting configuration overrides. */
  rateLimit?: Partial<RateLimitConfig>;
}

/**
 * Resolved configuration with defaults applied.
 */
export interface ResolvedConfig {
  adminEmail: string;
  apiToken: string;
  platform: SpanningPlatform;
  apiUrl: string;
  rateLimit: RateLimitConfig;
}

/**
 * Resolve a {@link SpanningConfig} by applying defaults.
 */
// Linear scan; a /\/+$/ regex backtracks quadratically on long slash runs.
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === '/') end--;
  return s.slice(0, end);
}

export function resolveConfig(config: SpanningConfig): ResolvedConfig {
  if (!config.adminEmail) {
    throw new Error('adminEmail must be provided');
  }
  if (!config.apiToken) {
    throw new Error('apiToken must be provided');
  }
  const platform = config.platform ?? DEFAULT_PLATFORM;
  if (platform !== 'm365' && platform !== 'gws' && platform !== 'salesforce') {
    throw new Error(
      `Unsupported platform: ${String(platform)} (expected "m365", "gws", or "salesforce")`
    );
  }
  const baseFromPlatform = PLATFORM_BASE_URLS[platform];
  const apiUrl = stripTrailingSlashes(config.apiUrl ?? baseFromPlatform);
  return {
    adminEmail: config.adminEmail,
    apiToken: config.apiToken,
    platform,
    apiUrl,
    rateLimit: {
      ...DEFAULT_RATE_LIMIT_CONFIG,
      ...config.rateLimit,
    },
  };
}
