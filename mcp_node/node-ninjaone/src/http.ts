/**
 * HTTP layer for the NinjaOne API
 */

import type { ResolvedConfig } from './config.js';
import type { AuthManager } from './auth.js';
import type { RateLimiter } from './rate-limiter.js';
import { DEFAULT_MAX_RETRY_AFTER_MS, resilientFetch } from './net.js';
import {
  NinjaOneError,
  NinjaOneAuthenticationError,
  NinjaOneForbiddenError,
  NinjaOneNotFoundError,
  NinjaOneValidationError,
  NinjaOneRateLimitError,
  NinjaOneServerError,
} from './errors.js';

/**
 * HTTP request options
 */
export interface RequestOptions {
  /** HTTP method */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Request body (will be JSON stringified) */
  body?: unknown;
  /** URL query parameters */
  params?: Record<string, string | number | boolean | undefined>;
  /** Skip authentication (for token endpoint) */
  skipAuth?: boolean;
}

/**
 * HTTP client for making authenticated requests to the NinjaOne API
 */
export class HttpClient {
  private readonly config: ResolvedConfig;
  private readonly authManager: AuthManager;
  private readonly rateLimiter: RateLimiter;

  constructor(config: ResolvedConfig, authManager: AuthManager, rateLimiter: RateLimiter) {
    this.config = config;
    this.authManager = authManager;
    this.rateLimiter = rateLimiter;
  }

  /**
   * Make an authenticated request to the API
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, params, skipAuth = false } = options;

    // Build the URL
    let url = `${this.config.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      }
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    return this.executeRequest<T>(url, method, body, skipAuth);
  }

  /**
   * Make a request to a full URL (for pagination)
   */
  async requestUrl<T>(url: string): Promise<T> {
    return this.executeRequest<T>(url, 'GET', undefined, false);
  }

  /**
   * Execute the request with retry logic
   */
  private async executeRequest<T>(
    url: string,
    method: string,
    body: unknown,
    skipAuth: boolean,
    retryCount: number = 0,
    isRetryAfter401: boolean = false
  ): Promise<T> {
    // Wait for a rate limit slot
    await this.rateLimiter.waitForSlot();

    // Get the auth token
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (!skipAuth) {
      const token = await this.authManager.getToken();
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Record the request
    this.rateLimiter.recordRequest();

    // Per-attempt timeout and clear network errors (see net.ts). Retries for
    // 429 / 5xx stay in handleResponse, which also feeds the rate limiter.
    const response = await resilientFetch(
      url,
      { method, headers, body: body ? JSON.stringify(body) : undefined },
      { maxRetries: 0 },
    );

    // Handle the response
    return this.handleResponse<T>(response, url, method, body, skipAuth, retryCount, isRetryAfter401);
  }

  /**
   * Handle the response and errors
   */
  private async handleResponse<T>(
    response: Response,
    url: string,
    method: string,
    body: unknown,
    skipAuth: boolean,
    retryCount: number,
    isRetryAfter401: boolean
  ): Promise<T> {
    if (response.ok) {
      // Handle empty responses (204 No Content)
      if (response.status === 204) {
        return {} as T;
      }
      // Always try to parse response body as JSON.
      // Some APIs (including NinjaOne) may omit or vary the Content-Type
      // header, so relying solely on content-type check causes silent
      // data loss — returning {} instead of the actual response.
      const text = await response.text();
      if (!text || text.trim().length === 0) {
        return {} as T;
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        // If JSON parsing fails, return empty object for non-JSON responses
        return {} as T;
      }
    }

    // Read body as text first, then try to parse as JSON.
    // Response.body is a stream that can only be consumed once —
    // if response.json() fails mid-parse, response.text() would throw
    // "Body is unusable: Body has already been read".
    let responseBody: unknown;
    const rawText = await response.text();
    try {
      responseBody = JSON.parse(rawText);
    } catch {
      responseBody = rawText;
    }

    switch (response.status) {
      case 400:
        // Could be bad credentials on token request or validation error
        if (this.isValidationError(responseBody)) {
          const errors = this.parseValidationErrors(responseBody);
          throw new NinjaOneValidationError('Validation error', errors, responseBody);
        }
        throw new NinjaOneAuthenticationError(
          'Bad request - invalid credentials or parameters',
          400,
          responseBody
        );

      case 401:
        // If this is already a retry after 401, don't retry again
        if (isRetryAfter401) {
          throw new NinjaOneAuthenticationError(
            'Authentication failed after token refresh',
            401,
            responseBody
          );
        }
        // Try to refresh the token and retry once
        await this.authManager.refreshToken();
        return this.executeRequest<T>(url, method, body, skipAuth, retryCount, true);

      case 403:
        throw new NinjaOneForbiddenError('Access forbidden - insufficient permissions', responseBody);

      case 404:
        throw new NinjaOneNotFoundError('Resource not found', responseBody);

      case 429:
        // Rate limited - retry idempotent requests with backoff, but never sit through a long Retry-After
        if (method !== 'POST' && method !== 'PATCH' && this.rateLimiter.shouldRetry(retryCount)
          && this.rateLimiter.parseRetryAfter(response.headers.get('Retry-After')) <= DEFAULT_MAX_RETRY_AFTER_MS) {
          const retryAfterHeader = response.headers.get('Retry-After');
          const delay = this.rateLimiter.parseRetryAfter(retryAfterHeader);
          this.rateLimiter.handleRateLimitError(retryCount);
          await this.sleep(delay);
          return this.executeRequest<T>(url, method, body, skipAuth, retryCount + 1, isRetryAfter401);
        }
        throw new NinjaOneRateLimitError(
          'Rate limit exceeded and max retries reached',
          this.config.rateLimit.retryAfterMs,
          responseBody
        );

      default:
        if (response.status >= 500) {
          // Server error - retry once, idempotent requests only
          if (retryCount === 0 && method !== 'POST' && method !== 'PATCH') {
            await this.sleep(1000);
            return this.executeRequest<T>(url, method, body, skipAuth, 1, isRetryAfter401);
          }
          throw new NinjaOneServerError(
            `Server error: ${response.status} ${response.statusText}`,
            response.status,
            responseBody
          );
        }
        throw new NinjaOneError(
          `Request failed: ${response.status} ${response.statusText}`,
          response.status,
          responseBody
        );
    }
  }

  /**
   * Check if a response body indicates a validation error
   */
  private isValidationError(responseBody: unknown): boolean {
    if (typeof responseBody === 'object' && responseBody !== null) {
      const body = responseBody as Record<string, unknown>;
      // NinjaOne validation errors typically have an errors array or error field
      return Array.isArray(body['errors']) || typeof body['error'] === 'object';
    }
    return false;
  }

  /**
   * Parse validation errors from response body
   */
  private parseValidationErrors(responseBody: unknown): Array<{ field: string; message: string }> {
    if (typeof responseBody === 'object' && responseBody !== null) {
      const body = responseBody as Record<string, unknown>;
      const errors = body['errors'] as unknown;

      if (Array.isArray(errors)) {
        return errors.map((err: unknown) => {
          if (typeof err === 'object' && err !== null) {
            const e = err as Record<string, unknown>;
            return {
              field: String(e['field'] ?? e['property'] ?? 'unknown'),
              message: String(e['message'] ?? e['error'] ?? 'Unknown error'),
            };
          }
          return { field: 'unknown', message: String(err) };
        });
      }
    }
    return [];
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
