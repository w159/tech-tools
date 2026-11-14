/**
 * HTTP layer for the Spanning Cloud Backup API.
 *
 * Authentication uses HTTP Basic auth per the public Spanning O365
 * OpenAPI spec (http://o365-docs.spanningbackup.com/swagger/json):
 *   Authorization: Basic base64(<adminEmail>:<apiToken>)
 *
 * The admin email and API token are pair-bound — both must match the
 * pair on file in the Spanning admin console or the API returns 401.
 *
 * Pagination is cursor-based (see {@link ./pagination.ts}).
 */

import type { ResolvedConfig } from './config.js';
import type { RateLimiter } from './rate-limiter.js';
import { DEFAULT_MAX_RETRY_AFTER_MS, resilientFetch } from './net.js';
import {
  SpanningError,
  SpanningAuthenticationError,
  SpanningConflictError,
  SpanningForbiddenError,
  SpanningNotFoundError,
  SpanningRateLimitError,
  SpanningServerError,
} from './errors.js';

/**
 * Options for an HTTP request.
 */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Authenticated HTTP client for the Spanning API.
 */
export class HttpClient {
  private readonly config: ResolvedConfig;
  private readonly rateLimiter: RateLimiter;

  constructor(config: ResolvedConfig, rateLimiter: RateLimiter) {
    this.config = config;
    this.rateLimiter = rateLimiter;
  }

  /**
   * Make an authenticated request.
   *
   * @param path - API path beginning with "/", relative to the configured base URL
   *               (e.g. "/users").
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = buildUrl(this.config.apiUrl, path, params);
    const bodyString = body === undefined ? '' : JSON.stringify(body);
    return this.executeRequest<T>(url, method, bodyString, 0);
  }

  /** Make a JSON GET. */
  async get<T>(path: string, params?: RequestOptions['params']): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  /** Make a JSON POST. */
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  private async executeRequest<T>(
    url: string,
    method: string,
    bodyString: string,
    retryCount: number
  ): Promise<T> {
    await this.rateLimiter.waitForSlot();

    const basicAuth = Buffer.from(
      `${this.config.adminEmail}:${this.config.apiToken}`
    ).toString('base64');
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Basic ${basicAuth}`,
    };
    if (bodyString) headers['Content-Type'] = 'application/json';

    this.rateLimiter.recordRequest();

    let response: Response;
    try {
      // Per-attempt timeout and clear network errors (see net.ts). Retries for
      // 429 / 5xx stay in handleResponse, which also feeds the rate limiter.
      response = await resilientFetch(
        url,
        { method, headers, body: bodyString || undefined },
        { maxRetries: 0 },
      );
    } finally {
      this.rateLimiter.release();
    }

    return this.handleResponse<T>(response, url, method, bodyString, retryCount);
  }

  private async handleResponse<T>(
    response: Response,
    url: string,
    method: string,
    bodyString: string,
    retryCount: number
  ): Promise<T> {
    if (response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return (await response.json()) as T;
      }
      const text = await response.text();
      return (text === '' ? ({} as T) : (text as unknown as T));
    }

    let responseBody: unknown;
    try {
      responseBody = await response.clone().json();
    } catch {
      try {
        responseBody = await response.text();
      } catch {
        responseBody = undefined;
      }
    }

    switch (response.status) {
      case 401:
        throw new SpanningAuthenticationError(
          `Authentication failed (401). Spanning tokens are bound to a specific admin email — verify BOTH the admin email ("${this.config.adminEmail}") AND the API token are correct and were issued together for the "${this.config.platform}" platform. Spanning surfaces any mismatch as a generic 401.`,
          401,
          responseBody
        );
      case 403:
        throw new SpanningForbiddenError(
          'Access forbidden — token is out of scope for this resource',
          responseBody
        );
      case 404:
        throw new SpanningNotFoundError('Resource not found', responseBody);
      case 409:
        throw new SpanningConflictError(
          'Conflict (409) — a restore may already be in flight for the same items',
          responseBody
        );
      case 429: {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
        // Retry only idempotent requests, and only when the wait is short enough to sit through.
        const waitable = retryAfterSeconds === undefined || retryAfterSeconds * 1000 <= DEFAULT_MAX_RETRY_AFTER_MS;
        if (this.rateLimiter.shouldRetry(retryCount) && waitable && method !== 'POST') {
          const delay = this.rateLimiter.calculateRetryDelay(retryCount, retryAfterSeconds);
          await this.sleep(delay);
          return this.executeRequest<T>(url, method, bodyString, retryCount + 1);
        }
        throw new SpanningRateLimitError(
          'Rate limit exceeded and max retries reached',
          (retryAfterSeconds ?? 5) * 1000,
          responseBody
        );
      }
      default:
        if (response.status >= 500 && response.status <= 599) {
          if (retryCount === 0 && method !== 'POST') {
            await this.sleep(1000);
            return this.executeRequest<T>(url, method, bodyString, 1);
          }
          throw new SpanningServerError(
            `Server error: ${response.status} ${response.statusText}`,
            response.status,
            responseBody
          );
        }
        throw new SpanningError(
          `Request failed: ${response.status} ${response.statusText}`,
          response.status,
          responseBody
        );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Build a full URL from a base URL, path, and optional query params.
 * Skips parameters whose value is `undefined`.
 */
export function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  const base = `${baseUrl}${path}`;
  if (!params) return base;
  const search = new URLSearchParams();
  let any = false;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.append(key, String(value));
    any = true;
  }
  return any ? `${base}?${search.toString()}` : base;
}
