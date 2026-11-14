import { RateLimiter } from './rate-limiter.js';
import { resilientFetch } from './net.js';
import { VantaAuthManager } from './auth.js';
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
  auth: VantaAuthManager;
  maxRetries: number;
  rateLimiter: RateLimiter;
}

export interface RequestOptions {
  method?: string;
  params?: Record<string, unknown>;
  body?: unknown;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly auth: VantaAuthManager;
  private readonly maxRetries: number;
  private readonly rateLimiter: RateLimiter;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl;
    this.auth = config.auth;
    this.maxRetries = config.maxRetries;
    this.rateLimiter = config.rateLimiter;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;

    let url = `${this.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const v of value) searchParams.append(key, String(v));
        } else {
          searchParams.set(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    let didRefreshAuth = false;

    // A second pass happens only after a 401 forces a token refresh; every
    // other retry (429, 5xx, ECONNRESET) lives in resilientFetch.
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.rateLimiter.acquire();

      const token = await this.auth.getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      };
      if (body) headers['Content-Type'] = 'application/json';

      // Per-attempt timeout, clear network errors, and bounded retries for
      // idempotent requests only (see net.ts).
      const response = await resilientFetch(
        url,
        { method, headers, body: body ? JSON.stringify(body) : undefined },
        { maxRetries: this.maxRetries },
      );

      if (response.ok) {
        if (response.status === 204) return {} as T;
        const ct = response.headers.get('content-type');
        if (ct?.includes('application/json')) return response.json() as Promise<T>;
        return {} as T;
      }

      let responseBody: unknown;
      const rawText = await response.text();
      try { responseBody = JSON.parse(rawText); }
      catch { responseBody = rawText; }

      switch (response.status) {
        case 400:
          throw new ValidationError('Bad request', [], responseBody);
        case 401:
          // Could be an expired/revoked token. Try one forced refresh.
          if (!didRefreshAuth) {
            didRefreshAuth = true;
            await this.auth.refresh();
            continue;
          }
          throw new AuthenticationError('Authentication failed', responseBody);
        case 403:
          throw new ForbiddenError('Forbidden', responseBody);
        case 404:
          throw new NotFoundError('Resource not found', responseBody);
        case 429: {
          const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10);
          throw new RateLimitError('Rate limit exceeded', retryAfter, responseBody);
        }
        default:
          if (response.status >= 500) {
            throw new ServerError(`Server error: ${response.status}`, responseBody);
          }
          throw new ServiceError(`HTTP ${response.status}`, response.status, responseBody);
      }
    }

    throw new Error('Request failed after token refresh');
  }
}
