import type { HttpClient } from '../http.js';
import type {
  Integration,
  IntegrationResource as IntegrationResourceObj,
  IntegrationResourceKind,
  ListParams,
  NormalizedList,
} from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

export class IntegrationsResource {
  constructor(private readonly http: HttpClient) {}

  async list(params: ListParams = {}): Promise<NormalizedList<Integration>> {
    const response = await this.http.request<unknown>('/integrations', { params });
    return unwrapPaginatedResponse<Integration>(response);
  }

  async get(integrationId: string): Promise<Integration> {
    return this.http.request<Integration>(
      `/integrations/${encodeURIComponent(integrationId)}`
    );
  }

  async listResourceKinds(
    integrationId: string,
    params: ListParams = {}
  ): Promise<NormalizedList<IntegrationResourceKind>> {
    const response = await this.http.request<unknown>(
      `/integrations/${encodeURIComponent(integrationId)}/resource-kinds`,
      { params }
    );
    return unwrapPaginatedResponse<IntegrationResourceKind>(response);
  }

  async listResources(
    integrationId: string,
    resourceKind: string,
    params: ListParams = {}
  ): Promise<NormalizedList<IntegrationResourceObj>> {
    const response = await this.http.request<unknown>(
      `/integrations/${encodeURIComponent(integrationId)}/resource-kinds/${encodeURIComponent(resourceKind)}/resources`,
      { params }
    );
    return unwrapPaginatedResponse<IntegrationResourceObj>(response);
  }

  async getResource(
    integrationId: string,
    resourceKind: string,
    resourceId: string
  ): Promise<IntegrationResourceObj> {
    return this.http.request<IntegrationResourceObj>(
      `/integrations/${encodeURIComponent(integrationId)}/resource-kinds/${encodeURIComponent(resourceKind)}/resources/${encodeURIComponent(resourceId)}`
    );
  }
}
