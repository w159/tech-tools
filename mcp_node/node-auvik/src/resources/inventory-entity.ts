import type { HttpClient } from '../http.js';
import type { JsonApiResponse, Page, PaginationOptions } from '../types/json-api.js';
import type { EntityNote, EntityAudit } from '../types/entity.js';
import { paginate, fetchPage } from '../pagination.js';

export class InventoryEntityResource {
  constructor(private getClient: () => Promise<HttpClient>) {}

  async listNotes(options: PaginationOptions = {}): Promise<Page<EntityNote>> {
    const client = await this.getClient();
    return fetchPage<EntityNote>(client, '/inventory/entity/note', options);
  }

  async *listNotesAll(filters: Record<string, string> = {}): AsyncIterable<EntityNote> {
    const client = await this.getClient();
    for await (const page of paginate<EntityNote>(client, '/inventory/entity/note', filters)) {
      for (const note of page.data) {
        yield note;
      }
    }
  }

  async getNote(id: string): Promise<EntityNote> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<EntityNote>>(`/inventory/entity/note/${id}`);
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return { id: data.id, ...data.attributes } as any;
  }

  async listAudits(options: PaginationOptions = {}): Promise<Page<EntityAudit>> {
    const client = await this.getClient();
    return fetchPage<EntityAudit>(client, '/inventory/entity/audit', options);
  }

  async *listAuditsAll(filters: Record<string, string> = {}): AsyncIterable<EntityAudit> {
    const client = await this.getClient();
    for await (const page of paginate<EntityAudit>(client, '/inventory/entity/audit', filters)) {
      for (const audit of page.data) {
        yield audit;
      }
    }
  }

  async getAudit(id: string): Promise<EntityAudit> {
    const client = await this.getClient();
    const response = await client.request<JsonApiResponse<EntityAudit>>(`/inventory/entity/audit/${id}`);
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return { id: data.id, ...data.attributes } as any;
  }
}