/**
 * Webhooks resource operations
 */

import type { HttpClient } from '../http.js';
import type {
  Webhook,
  WebhookCreateData,
  WebhookUpdateData,
} from '../types/webhooks.js';

/**
 * Webhooks resource operations
 */
export class WebhooksResource {
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List all webhooks
   */
  async list(): Promise<Webhook[]> {
    return this.httpClient.request<Webhook[]>('/v2/webhook');
  }

  /**
   * Get a single webhook by ID
   */
  async get(id: number): Promise<Webhook> {
    return this.httpClient.request<Webhook>(`/v2/webhook/${id}`);
  }

  /**
   * Create a new webhook
   */
  async create(data: WebhookCreateData): Promise<Webhook> {
    return this.httpClient.request<Webhook>('/v2/webhook', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Update an existing webhook
   */
  async update(id: number, data: WebhookUpdateData): Promise<Webhook> {
    return this.httpClient.request<Webhook>(`/v2/webhook/${id}`, {
      method: 'PUT',
      body: data,
    });
  }

  /**
   * Delete a webhook
   */
  async delete(id: number): Promise<void> {
    await this.httpClient.request<void>(`/v2/webhook/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * Test a webhook by sending a test payload
   */
  async test(id: number): Promise<{ success: boolean; statusCode?: number; message?: string }> {
    return this.httpClient.request(`/v2/webhook/${id}/test`, {
      method: 'POST',
    });
  }
}
