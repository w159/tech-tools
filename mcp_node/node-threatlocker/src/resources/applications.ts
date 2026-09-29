import type { HttpClient } from '../http.js';
import type { Application, ApplicationListParams, PaginatedResponse } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

// Source: https://threatlocker.kb.help/portalapiapplication/ and live swagger
// portalapi.b.threatlocker.com/swagger/public/swagger.json (ApplicationApplicationGetByParameters).

export class ApplicationsResource {
  constructor(private readonly http: HttpClient) { }

  async list(params: ApplicationListParams = {}): Promise<PaginatedResponse<Application>> {
    const body = {
      orderBy: params.orderBy ?? 'name',
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 25,
      searchBy: params.searchBy ?? 'app',
      category: params.category,
      countries: params.countries,
      categories: params.categories,
      includeChildOrganizations: params.includeChildOrganizations,
      isAscending: params.isAscending,
      isHidden: params.isHidden,
      osType: params.osType,
      permittedApplications: params.permittedApplications,
      searchText: params.searchText,
    };
    // Response is a bare array (swagger ApplicationApplicationGetByParameters).
    const response = await this.http.request<Application[]>('/Application/ApplicationGetByParameters', {
      method: 'POST',
      body,
    });
    return unwrapPaginatedResponse<Application>(response, body.pageNumber, body.pageSize);
  }

  async get(applicationId: string): Promise<Application> {
    return this.http.request<Application>('/Application/ApplicationGetById', { params: { applicationId } });
  }
}