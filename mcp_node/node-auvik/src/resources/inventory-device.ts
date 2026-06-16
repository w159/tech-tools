import type { HttpClient } from '../http.js';
import type { JsonApiResponse, Page, PaginationOptions } from '../types/json-api.js';
import type { DeviceInfo, DeviceDetails, DeviceWarranty, DeviceLifecycle } from '../types/devices.js';
import { paginate, fetchPage } from '../pagination.js';

export class InventoryDeviceResource {
  constructor(private getClient: () => Promise<HttpClient>) {}

  // Device Info (v2 preferred)
  async listInfo(options: PaginationOptions = {}): Promise<Page<DeviceInfo>> {
    const client = await this.getClient();
    return fetchPage<DeviceInfo>(client, '/inventory/device/info', options);
  }

  async *listInfoAll(filters: Record<string, string> = {}): AsyncIterable<DeviceInfo> {
    const client = await this.getClient();
    for await (const page of paginate<DeviceInfo>(client, '/inventory/device/info', filters)) {
      for (const device of page.data) {
        yield device;
      }
    }
  }

  async getInfo(id: string): Promise<DeviceInfo> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<DeviceInfo>>(`/inventory/device/info/${id}`);
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return { id: data.id, ...data.attributes } as any;
  }

  // Device Extended Details (v2). Auvik path is /inventory/device/detail/extended.
  async listExtendedDetails(options: PaginationOptions = {}): Promise<Page<DeviceDetails>> {
    const client = await this.getClient();
    return fetchPage<DeviceDetails>(client, '/inventory/device/detail/extended', options);
  }

  async *listExtendedDetailsAll(filters: Record<string, string> = {}): AsyncIterable<DeviceDetails> {
    const client = await this.getClient();
    for await (const page of paginate<DeviceDetails>(client, '/inventory/device/detail/extended', filters)) {
      for (const device of page.data) {
        yield device;
      }
    }
  }

  // Device Details. Auvik path is the singular /inventory/device/detail.
  async listDetails(options: PaginationOptions = {}): Promise<Page<DeviceDetails>> {
    const client = await this.getClient();
    return fetchPage<DeviceDetails>(client, '/inventory/device/detail', options);
  }

  async *listDetailsAll(filters: Record<string, string> = {}): AsyncIterable<DeviceDetails> {
    const client = await this.getClient();
    for await (const page of paginate<DeviceDetails>(client, '/inventory/device/detail', filters)) {
      for (const device of page.data) {
        yield device;
      }
    }
  }

  async getDetails(id: string): Promise<DeviceDetails> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<DeviceDetails>>(`/inventory/device/detail/${id}`);
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return { id: data.id, ...data.attributes } as any;
  }

  // Device Warranty
  async listWarranty(options: PaginationOptions = {}): Promise<Page<DeviceWarranty & { deviceId: string }>> {
    const client = await this.getClient();
    return fetchPage<DeviceWarranty, DeviceWarranty & { deviceId: string }>(
      client,
      '/inventory/device/warranty',
      options,
      item => ({ deviceId: item.id, id: item.id, ...item.attributes }) as DeviceWarranty & { deviceId: string },
    );
  }

  async *listWarrantyAll(filters: Record<string, string> = {}): AsyncIterable<DeviceWarranty & { deviceId: string }> {
    const client = await this.getClient();
    for await (const page of paginate<DeviceWarranty>(client, '/inventory/device/warranty', filters)) {
      for (const warranty of page.data) {
        yield { ...warranty, deviceId: warranty.id };
      }
    }
  }

  async getWarranty(id: string): Promise<DeviceWarranty & { deviceId: string }> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<DeviceWarranty>>(`/inventory/device/warranty/${id}`);
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return { deviceId: data.id, id: data.id, ...data.attributes } as DeviceWarranty & { deviceId: string };
  }

  // Device Lifecycle
  async listLifecycle(options: PaginationOptions = {}): Promise<Page<DeviceLifecycle & { deviceId: string }>> {
    const client = await this.getClient();
    return fetchPage<DeviceLifecycle, DeviceLifecycle & { deviceId: string }>(
      client,
      '/inventory/device/lifecycle',
      options,
      item => ({ deviceId: item.id, id: item.id, ...item.attributes }) as DeviceLifecycle & { deviceId: string },
    );
  }

  async *listLifecycleAll(filters: Record<string, string> = {}): AsyncIterable<DeviceLifecycle & { deviceId: string }> {
    const client = await this.getClient();
    for await (const page of paginate<DeviceLifecycle>(client, '/inventory/device/lifecycle', filters)) {
      for (const lifecycle of page.data) {
        yield { ...lifecycle, deviceId: lifecycle.id };
      }
    }
  }

  async getLifecycle(id: string): Promise<DeviceLifecycle & { deviceId: string }> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<DeviceLifecycle>>(`/inventory/device/lifecycle/${id}`);
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return { deviceId: data.id, id: data.id, ...data.attributes } as DeviceLifecycle & { deviceId: string };
  }
}