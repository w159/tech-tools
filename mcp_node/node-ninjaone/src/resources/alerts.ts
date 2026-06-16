/**
 * Alerts resource operations
 */

import type { HttpClient } from '../http.js';
import type {
  Alert,
  AlertListParams,
  AlertActionResult,
} from '../types/alerts.js';

/**
 * Alerts resource operations
 */
export class AlertsResource {
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List all alerts
   */
  async list(params?: AlertListParams): Promise<Alert[]> {
    const response = await this.httpClient.request<Alert[]>('/v2/alerts', {
      params: this.buildListParams(params),
    });
    return response;
  }

  /**
   * List alerts for a specific device
   */
  async listByDevice(deviceId: number, params?: Omit<AlertListParams, 'deviceId'>): Promise<Alert[]> {
    const response = await this.httpClient.request<Alert[]>(`/v2/device/${deviceId}/alerts`, {
      params: this.buildListParams(params),
    });
    return response;
  }

  /**
   * List alerts for a specific organization
   */
  async listByOrganization(organizationId: number, params?: Omit<AlertListParams, 'organizationId'>): Promise<Alert[]> {
    const response = await this.httpClient.request<Alert[]>(`/v2/organization/${organizationId}/alerts`, {
      params: this.buildListParams(params),
    });
    return response;
  }

  /**
   * Get a single alert by UID
   */
  async get(uid: string): Promise<Alert> {
    return this.httpClient.request<Alert>(`/v2/alert/${uid}`);
  }

  /**
   * Delete/reset an alert by UID
   */
  async delete(uid: string): Promise<void> {
    await this.httpClient.request<void>(`/v2/alert/${uid}`, {
      method: 'DELETE',
    });
  }

  /**
   * Reset an alert by UID
   */
  async reset(uid: string): Promise<void> {
    await this.httpClient.request<void>(`/v2/alert/${uid}/reset`, {
      method: 'POST',
    });
  }

  /**
   * Reset all alerts for a device
   */
  async resetByDevice(deviceId: number): Promise<AlertActionResult> {
    return this.httpClient.request<AlertActionResult>(`/v2/device/${deviceId}/alerts/reset`, {
      method: 'POST',
    });
  }

  /**
   * Reset all alerts for an organization
   */
  async resetByOrganization(organizationId: number): Promise<AlertActionResult> {
    return this.httpClient.request<AlertActionResult>(`/v2/organization/${organizationId}/alerts/reset`, {
      method: 'POST',
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
