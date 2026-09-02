import type { HttpClient } from '../http.js';
import type { Organization, OrganizationListParams, AuthKey, LabelValue, PaginatedResponse } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

export class OrganizationsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Direct child organizations. Documented in the KB (Organization article) but
   * absent from the public swagger; a single-organization tenant gets [].
   */
  async listChildren(params: OrganizationListParams = {}): Promise<PaginatedResponse<Organization>> {
    const body = {
      orderBy: params.orderBy ?? 'name',
      isAscending: params.isAscending ?? true,
      searchText: params.searchText ?? '',
      includeAllChildren: params.includeAllChildren ?? false,
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 25,
    };
    const response = await this.http.request<Organization[]>('/Organization/OrganizationGetChildOrganizationsByParameters', { method: 'POST', body });
    return unwrapPaginatedResponse<Organization>(response, body.pageNumber, body.pageSize);
  }

  async getAuthKey(): Promise<AuthKey> {
    return this.http.request<AuthKey>('/Organization/OrganizationGetAuthKeyById');
  }

  /** Organizations the key can act on, as {label, value} (verified live: the managed org itself is included). */
  async listForMoveComputers(searchText = ''): Promise<LabelValue[]> {
    const response = await this.http.request<LabelValue[]>('/Organization/OrganizationGetForMoveComputers', { params: { searchText } });
    return Array.isArray(response) ? response : [];
  }
}
