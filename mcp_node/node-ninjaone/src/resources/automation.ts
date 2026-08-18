/**
 * Automation resource operations (GET /v2/scripts, GET /v2/jobs)
 *
 * Script catalog and job visibility (docs/vendors/ninjaone/api-reference.md:148-149).
 * Response field names are not documented anywhere reachable, so results are
 * returned raw/unshaped rather than typed against guessed fields.
 */

import type { HttpClient } from '../http.js';

/** Query params for GET /v2/jobs. */
export interface JobListParams {
  df?: string;
  pageSize?: number;
  cursor?: string;
}

/**
 * Automation resource operations
 */
export class AutomationResource {
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List the script catalog: GET /v2/scripts
   */
  async listScripts(): Promise<Record<string, unknown>[]> {
    return this.httpClient.request<Record<string, unknown>[]>('/v2/scripts');
  }

  /**
   * List scheduled and running jobs: GET /v2/jobs
   */
  async listJobs(params?: JobListParams): Promise<Record<string, unknown>[]> {
    return this.httpClient.request<Record<string, unknown>[]>('/v2/jobs', {
      params: this.buildParams(params),
    });
  }

  private buildParams(params?: JobListParams): Record<string, string | number | boolean | undefined> {
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
