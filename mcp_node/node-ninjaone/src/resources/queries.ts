/**
 * Queries resource operations (GET /v2/queries/*)
 *
 * Cross-org fleet-reporting endpoints. All accept `df` (device filter),
 * `pageSize`, `cursor` and return `{ cursor: { name, offset, expires }, results: [...] }`
 * (docs/vendors/ninjaone/api-reference.md:118-136).
 */

import type { HttpClient } from '../http.js';

/** Query params shared by every /v2/queries/* endpoint, plus passthrough extras. */
export interface QueryParams {
  df?: string;
  pageSize?: number;
  cursor?: string;
  [key: string]: string | number | boolean | undefined;
}

/** Raw shape documented for every /v2/queries/* response. Fields are left unshaped. */
export interface QueryResponse {
  cursor: { name: string; offset: number; expires: number };
  results: Record<string, unknown>[];
}

/**
 * Queries resource operations
 */
export class QueriesResource {
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * Run a cross-org fleet-reporting query: GET /v2/queries/{query}
   */
  async run(query: string, params?: QueryParams): Promise<QueryResponse> {
    return this.httpClient.request<QueryResponse>(`/v2/queries/${query}`, {
      params: this.buildParams(params),
    });
  }

  /**
   * Device-scoped patch install history: GET /v2/device/{id}/os-patch-installs
   */
  async osPatchInstallsForDevice(deviceId: number, params?: QueryParams): Promise<unknown> {
    return this.httpClient.request<unknown>(`/v2/device/${deviceId}/os-patch-installs`, {
      params: this.buildParams(params),
    });
  }

  private buildParams(params?: QueryParams): Record<string, string | number | boolean | undefined> {
    if (!params) return {};
    const result: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }
}
