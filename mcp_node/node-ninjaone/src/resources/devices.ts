/**
 * Devices resource operations
 */

import type { HttpClient } from '../http.js';
import type {
  Device,
  DeviceListParams,
  DeviceUpdateData,
  DeviceActivity,
  DeviceActivityListResponse,
  DeviceService,
  DeviceSoftware,
  DeviceInventory,
} from '../types/devices.js';

/**
 * Devices resource operations
 */
export class DevicesResource {
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List all devices
   */
  async list(params?: DeviceListParams): Promise<Device[]> {
    const response = await this.httpClient.request<Device[]>('/v2/devices', {
      params: this.buildListParams(params),
    });
    return response;
  }

  /**
   * List devices for a specific organization
   */
  async listByOrganization(organizationId: number, params?: Omit<DeviceListParams, 'organizationId'>): Promise<Device[]> {
    const response = await this.httpClient.request<Device[]>(`/v2/organization/${organizationId}/devices`, {
      params: this.buildListParams(params),
    });
    return response;
  }

  /**
   * Get a single device by ID
   */
  async get(id: number): Promise<Device> {
    return this.httpClient.request<Device>(`/v2/device/${id}`);
  }

  /**
   * Update a device
   */
  async update(id: number, data: DeviceUpdateData): Promise<Device> {
    return this.httpClient.request<Device>(`/v2/device/${id}`, {
      method: 'PATCH',
      body: data,
    });
  }

  /**
   * Approve a pending device
   */
  async approve(id: number): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/approval/APPROVED`, {
      method: 'POST',
    });
  }

  /**
   * Reject a pending device
   */
  async reject(id: number): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/approval/REJECTED`, {
      method: 'POST',
    });
  }

  /**
   * Reboot a device
   */
  async reboot(id: number, reason?: string): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/reboot`, {
      method: 'POST',
      body: reason ? { reason } : undefined,
    });
  }

  /**
   * Get device activities
   */
  async getActivities(id: number, params?: { after?: number; before?: number; pageSize?: number }): Promise<DeviceActivityListResponse> {
    return this.httpClient.request<DeviceActivityListResponse>(`/v2/device/${id}/activities`, {
      params: this.buildListParams(params),
    });
  }

  /**
   * Get all activities for all devices (optionally filtered by organization)
   */
  async listActivities(params?: { organizationId?: number; after?: number; before?: number; pageSize?: number }): Promise<DeviceActivity[]> {
    return this.httpClient.request<DeviceActivity[]>('/v2/activities', {
      params: this.buildListParams(params),
    });
  }

  /**
   * Get device services (Windows only)
   */
  async getServices(id: number): Promise<DeviceService[]> {
    return this.httpClient.request<DeviceService[]>(`/v2/device/${id}/windows-services`);
  }

  /**
   * Start a Windows service
   */
  async startService(id: number, serviceName: string): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/windows-service/${encodeURIComponent(serviceName)}/start`, {
      method: 'POST',
    });
  }

  /**
   * Stop a Windows service
   */
  async stopService(id: number, serviceName: string): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/windows-service/${encodeURIComponent(serviceName)}/stop`, {
      method: 'POST',
    });
  }

  /**
   * Restart a Windows service
   */
  async restartService(id: number, serviceName: string): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/windows-service/${encodeURIComponent(serviceName)}/restart`, {
      method: 'POST',
    });
  }

  /**
   * Get device software inventory
   */
  async getSoftware(id: number): Promise<DeviceSoftware[]> {
    return this.httpClient.request<DeviceSoftware[]>(`/v2/device/${id}/software`);
  }

  /**
   * Get device hardware inventory
   */
  async getInventory(id: number): Promise<DeviceInventory> {
    return this.httpClient.request<DeviceInventory>(`/v2/device/${id}/inventory`);
  }

  /**
   * Get device custom fields
   */
  async getCustomFields(id: number): Promise<Record<string, unknown>> {
    return this.httpClient.request<Record<string, unknown>>(`/v2/device/${id}/custom-fields`);
  }

  /**
   * Update device custom fields
   */
  async updateCustomFields(id: number, fields: Record<string, unknown>): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/custom-fields`, {
      method: 'PATCH',
      body: fields,
    });
  }

  /**
   * Delete a device
   */
  async delete(id: number): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * Build query parameters from list params
   */
  private buildListParams<T extends object>(params?: T): Record<string, string | number | boolean | undefined> {
    if (!params) return {};

    const result: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        result[key] = value as string | number | boolean;
      }
    }
    return result;
  }
}
