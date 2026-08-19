/**
 * Automation resource operations
 *
 * Script catalog, built-in actions, active jobs, and scheduled tasks.
 * Paths verified against the NinjaRMM v2 OpenAPI spec
 * (NinjaRMM-API-v2.json: getAutomationScripts, getActiveJobs, getScheduledTasks).
 *
 * Response field names are not documented in the spec, so results are returned
 * raw/unshaped rather than typed against guessed fields.
 */

import type { HttpClient } from '../http.js';

/** Query params for GET /v2/jobs. */
export interface JobListParams {
  /** Job Type filter (e.g. SCRIPTING, PATCH_MANAGEMENT). */
  jobType?: string;
  /** Device filter expression, e.g. "org = 12" or "class = WINDOWS_SERVER". */
  df?: string;
  /** Language tag for localized job/status labels. */
  lang?: string;
  /** IANA time zone for returned timestamps. */
  tz?: string;
  [key: string]: string | number | boolean | undefined;
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
   * List the automation script catalog and built-in actions:
   * GET /v2/automation/scripts
   *
   * Note the path: /v2/scripts does not exist and returns HTTP 404.
   */
  async listScripts(lang?: string): Promise<Record<string, unknown>[]> {
    return this.httpClient.request<Record<string, unknown>[]>('/v2/automation/scripts', {
      params: lang ? { lang } : {},
    });
  }

  /**
   * List currently active (running/queued) jobs: GET /v2/jobs
   */
  async listJobs(params?: JobListParams): Promise<Record<string, unknown>[]> {
    return this.httpClient.request<Record<string, unknown>[]>('/v2/jobs', {
      params: buildParams(params),
    });
  }

  /**
   * List scheduled tasks: GET /v2/tasks
   */
  async listTasks(): Promise<Record<string, unknown>[]> {
    return this.httpClient.request<Record<string, unknown>[]>('/v2/tasks');
  }
}

function buildParams(
  params?: Record<string, string | number | boolean | undefined>
): Record<string, string | number | boolean | undefined> {
  if (!params) return {};
  const result: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}
