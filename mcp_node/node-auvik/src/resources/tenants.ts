import type { HttpClient } from '../http.js';
import type { JsonApiResponse, Page, PaginationOptions } from '../types/json-api.js';
import type { Tenant, TenantDetail } from '../types/tenants.js';
import { paginate, fetchPage } from '../pagination.js';

export class TenantsResource {
  constructor(private getClient: () => Promise<HttpClient>) {}

  async list(options: PaginationOptions = {}): Promise<Page<Tenant>> {
    const client = await this.getClient();
    return fetchPage<Tenant>(client, '/tenants', options);
  }

  async *listAll(filters: Record<string, string> = {}): AsyncIterable<Tenant> {
    const client = await this.getClient();
    for await (const page of paginate<Tenant>(client, '/tenants', filters)) {
      for (const tenant of page.data) {
        yield tenant;
      }
    }
  }

  async listDetail(options: PaginationOptions = {}): Promise<Page<TenantDetail>> {
    const client = await this.getClient();
    return fetchPage<TenantDetail>(client, '/tenants/detail', options);
  }

  async *listDetailAll(filters: Record<string, string> = {}): AsyncIterable<TenantDetail> {
    const client = await this.getClient();
    for await (const page of paginate<TenantDetail>(client, '/tenants/detail', filters)) {
      for (const tenant of page.data) {
        yield tenant;
      }
    }
  }

  async get(id: string): Promise<TenantDetail> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<TenantDetail>>(`/tenants/${id}`);
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return { id: data.id, ...data.attributes } as TenantDetail;
  }
}
