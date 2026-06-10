import type { HttpClient } from '../http.js';
import type { Page, PaginationOptions } from '../types/json-api.js';
import type { ComponentInfo } from '../types/component.js';
import { paginate, fetchPage } from '../pagination.js';

export class InventoryComponentResource {
  constructor(private getClient: () => Promise<HttpClient>) {}

  async listInfo(options: PaginationOptions = {}): Promise<Page<ComponentInfo>> {
    const client = await this.getClient();
    return fetchPage<ComponentInfo>(client, '/inventory/component/info', options);
  }

  async *listInfoAll(filters: Record<string, string> = {}): AsyncIterable<ComponentInfo> {
    const client = await this.getClient();
    for await (const page of paginate<ComponentInfo>(client, '/inventory/component/info', filters)) {
      for (const component of page.data) {
        yield component;
      }
    }
  }
}