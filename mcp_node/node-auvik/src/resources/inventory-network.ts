import type { HttpClient } from '../http.js';
import type { JsonApiResponse, Page, PaginationOptions } from '../types/json-api.js';
import type { NetworkInfo, NetworkDetails } from '../types/networks.js';
import { paginate, fetchPage } from '../pagination.js';

export class InventoryNetworkResource {
  constructor(private getClient: () => Promise<HttpClient>) {}

  async listInfo(options: PaginationOptions = {}): Promise<Page<NetworkInfo>> {
    const client = await this.getClient();
    return fetchPage<NetworkInfo>(client, '/inventory/network/info', options);
  }

  async *listInfoAll(filters: Record<string, string> = {}): AsyncIterable<NetworkInfo> {
    const client = await this.getClient();
    for await (const page of paginate<NetworkInfo>(client, '/inventory/network/info', filters)) {
      for (const network of page.data) {
        yield network;
      }
    }
  }

  async getInfo(id: string): Promise<NetworkInfo> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<NetworkInfo>>(`/inventory/network/info/${id}`);
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return { id: data.id, ...data.attributes } as any;
  }

  async listDetails(options: PaginationOptions = {}): Promise<Page<NetworkDetails>> {
    const client = await this.getClient();
    return fetchPage<NetworkDetails>(client, '/inventory/network/detail', options);
  }

  async *listDetailsAll(filters: Record<string, string> = {}): AsyncIterable<NetworkDetails> {
    const client = await this.getClient();
    for await (const page of paginate<NetworkDetails>(client, '/inventory/network/detail', filters)) {
      for (const network of page.data) {
        yield network;
      }
    }
  }

  async getDetails(id: string): Promise<NetworkDetails> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<NetworkDetails>>(`/inventory/network/detail/${id}`);
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return { id: data.id, ...data.attributes } as any;
  }
}