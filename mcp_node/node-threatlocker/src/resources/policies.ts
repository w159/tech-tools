import type { HttpClient } from '../http.js';
import type { Policy, PolicyListParams, PaginatedResponse } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

// Source: https://threatlocker.kb.help/portalapipolicy/ and live swagger
// portalapi.b.threatlocker.com/swagger/public/swagger.json (PolicyPolicyGetByParameters).

export class PoliciesResource {
  constructor(private readonly http: HttpClient) { }

  async list(params: PolicyListParams = {}): Promise<PaginatedResponse<Policy>> {
    const body = {
      computerGroupId: params.computerGroupId ?? '00000000-0000-0000-0000-000000000000',
      filter: params.filter ?? '',
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 25,
      activeOnly: params.activeOnly,
      osType: params.osType,
      searchText: params.searchText,
      showAllPolicies: params.showAllPolicies,
    };
    // Response is a bare array (swagger PolicyPolicyGetByParameters).
    const response = await this.http.request<Policy[]>('/Policy/PolicyGetByParameters', {
      method: 'POST',
      body,
    });
    return unwrapPaginatedResponse<Policy>(response, body.pageNumber, body.pageSize);
  }

  async get(policyId: string): Promise<Policy> {
    return this.http.request<Policy>('/Policy/PolicyGetById', { params: { policyId } });
  }
}