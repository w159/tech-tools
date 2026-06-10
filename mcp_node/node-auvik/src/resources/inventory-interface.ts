import type { HttpClient } from '../http.js';
import type { JsonApiResponse, Page, PaginationOptions } from '../types/json-api.js';
import type { InterfaceInfo } from '../types/interfaces.js';
import { paginate, fetchPage } from '../pagination.js';

export class InventoryInterfaceResource {
  constructor(private getClient: () => Promise<HttpClient>) {}

  async listInfo(options: PaginationOptions = {}): Promise<Page<InterfaceInfo>> {
    const client = await this.getClient();
    return fetchPage<InterfaceInfo>(client, '/inventory/interface/info', options);
  }

  async *listInfoAll(filters: Record<string, string> = {}): AsyncIterable<InterfaceInfo> {
    const client = await this.getClient();
    for await (const page of paginate<InterfaceInfo>(client, '/inventory/interface/info', filters)) {
      for (const networkInterface of page.data) {
        yield networkInterface;
      }
    }
  }

  async getInfo(id: string): Promise<InterfaceInfo> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<InterfaceInfo>>(`/inventory/interface/info/${id}`);
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return { id: data.id, ...data.attributes } as any;
  }
}