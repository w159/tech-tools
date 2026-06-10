import type { HttpClient } from '../http.js';
import type { Page, PaginationOptions } from '../types/json-api.js';
import type { BillingUsageClient, BillingUsageDevice } from '../types/billing.js';
import { paginate, fetchPage } from '../pagination.js';

export class BillingResource {
  constructor(private getClient: () => Promise<HttpClient>) {}

  async listUsageClient(options: PaginationOptions = {}): Promise<Page<BillingUsageClient>> {
    const client = await this.getClient();
    return fetchPage<BillingUsageClient>(client, '/billing/usage/client', options);
  }

  async *listUsageClientAll(filters: Record<string, string> = {}): AsyncIterable<BillingUsageClient> {
    const client = await this.getClient();
    for await (const page of paginate<BillingUsageClient>(client, '/billing/usage/client', filters)) {
      for (const usage of page.data) {
        yield usage;
      }
    }
  }

  async listUsageDevice(options: PaginationOptions = {}): Promise<Page<BillingUsageDevice>> {
    const client = await this.getClient();
    return fetchPage<BillingUsageDevice>(client, '/billing/usage/device', options);
  }

  async *listUsageDeviceAll(filters: Record<string, string> = {}): AsyncIterable<BillingUsageDevice> {
    const client = await this.getClient();
    for await (const page of paginate<BillingUsageDevice>(client, '/billing/usage/device', filters)) {
      for (const usage of page.data) {
        yield usage;
      }
    }
  }
}