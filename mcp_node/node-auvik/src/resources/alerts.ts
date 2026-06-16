import type { HttpClient } from '../http.js';
import type { JsonApiResponse, Page, PaginationOptions } from '../types/json-api.js';
import type { AlertHistory, DismissAlertRequest } from '../types/alerts.js';
import { paginate, fetchPage } from '../pagination.js';

export class AlertsResource {
  constructor(private getClient: () => Promise<HttpClient>) {}

  async listHistory(options: PaginationOptions = {}): Promise<Page<AlertHistory>> {
    const client = await this.getClient();
    return fetchPage<AlertHistory>(client, '/alert/history/info', options);
  }

  async *listHistoryAll(filters: Record<string, string> = {}): AsyncIterable<AlertHistory> {
    const client = await this.getClient();
    for await (const page of paginate<AlertHistory>(client, '/alert/history/info', filters)) {
      for (const alert of page.data) {
        yield alert;
      }
    }
  }

  async getHistory(id: string): Promise<AlertHistory> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<AlertHistory>>(`/alert/history/info/${id}`);
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return { id: data.id, ...data.attributes } as AlertHistory;
  }

  async dismiss(id: string, request: DismissAlertRequest = {}): Promise<void> {
    const client = await this.getClient();
    // Auvik dismiss endpoint is POST /alert/dismiss/{id}.
    await client.request(`/alert/dismiss/${id}`, {
      method: 'POST',
      body: request,
    });
  }
}