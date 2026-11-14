import { RateLimiter } from './rate-limiter.js';
import { resilientFetch } from './net.js';
import {
  ServiceError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from './errors.js';

export interface HttpClientConfig {
  baseUrl: string;
  apiKey: string;
  organizationId?: string;
  maxRetries: number;
  rateLimiter: RateLimiter;
}

export interface RequestOptions {
  method?: string;
  params?: Record<string, unknown>;
  body?: unknown;
  /** Extra per-request headers (e.g. `usenewsearch: true` for ActionLog V2). */
  headers?: Record<string, string>;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly organizationId?: string;
  private readonly maxRetries: number;
  private readonly rateLimiter: RateLimiter;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.organizationId = config.organizationId;
    this.maxRetries = config.maxRetries;
    this.rateLimiter = config.rateLimiter;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers: extraHeaders } = options;

    let url = `${this.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            for (const v of value) {
              searchParams.append(`${key}[]`, String(v));
            }
          } else {
            searchParams.set(key, String(value));
          }
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    await this.rateLimiter.acquire();

    const headers: Record<string, string> = {
      'Authorization': this.apiKey, // Raw API key, no Bearer prefix
      'Accept': 'application/json',
    };

    // ThreatLocker Portal API uses `managedOrganizationId` (camelCase) to
    // scope a request to a managed/child org. Optional — only required
    // when the API user is acting on an organization other than its own.
    // The previous header name `OrganizationId` is silently rejected as 403.
    // Source: https://threatlocker.kb.help/api-documentation/
    if (this.organizationId) {
      headers['managedOrganizationId'] = this.organizationId;
    }

    if (body) headers['Content-Type'] = 'application/json';
    Object.assign(headers, extraHeaders);

    // Per-attempt timeout, clear network errors, and bounded retries for
    // idempotent requests only (see net.ts).
    const response = await resilientFetch(
      url,
      { method, headers, body: body ? JSON.stringify(body) : undefined },
      { maxRetries: this.maxRetries },
    );

    if (response.ok) {
      if (response.status === 204) return {} as T;
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) return response.json() as Promise<T>;
      return {} as T;
    }

    // Read body safely (text first, then parse)
    let responseBody: unknown;
    const rawText = await response.text();
    try { responseBody = JSON.parse(rawText); }
    catch { responseBody = rawText; }

    switch (response.status) {
      case 400:
        throw new ValidationError('Bad request', [], responseBody);
      case 401:
        throw new AuthenticationError('Authentication failed', responseBody);
      case 403:
        throw new ForbiddenError('Forbidden', responseBody);
      case 404:
        throw new NotFoundError('Resource not found', responseBody);
      case 429: {
        const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
        throw new RateLimitError('Rate limit exceeded', retryAfter, responseBody);
      }
      default:
        if (response.status >= 500) {
          throw new ServerError(`Server error: ${response.status}`, responseBody);
        }
        throw new ServiceError(`HTTP ${response.status}`, response.status, responseBody);
    }
  }
}