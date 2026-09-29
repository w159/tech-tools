import type { HttpClient } from '../http.js';
import type { CMConfigurationCheck, CMPolicy, CMPolicyListParams, PaginatedResponse } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

// Source: https://threatlocker.kb.help/portalapicmconfiguration/ and
// https://threatlocker.kb.help/portalapicmpolicy/ (Config Manager device configurations).

export class ConfigManagerResource {
  constructor(private readonly http: HttpClient) { }

  /** Catalog of available device-configuration checks (category + integer value). */
  async listConfigurations(): Promise<CMConfigurationCheck[]> {
    const response = await this.http.request<CMConfigurationCheck[]>(
      '/CMConfiguration/CMConfigurationGetWithCategoryByIsEnabled'
    );
    return Array.isArray(response) ? response : [];
  }

  /** Config Manager policies applied to an org/group/computer ("device configurations"). */
  async listPolicies(params: CMPolicyListParams = {}): Promise<PaginatedResponse<CMPolicy>> {
    const body = {
      appliesTo: params.appliesTo ?? '00000000-0000-0000-0000-000000000000',
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 25,
      status: params.status ?? 99,
      searchText: params.searchText,
    };
    // Response is a bare array (swagger CMPolicyGetbyParameters).
    const response = await this.http.request<CMPolicy[]>('/CMPolicy/CMPolicyGetbyParameters', {
      method: 'POST',
      body,
    });
    return unwrapPaginatedResponse<CMPolicy>(response, body.pageNumber, body.pageSize);
  }
}