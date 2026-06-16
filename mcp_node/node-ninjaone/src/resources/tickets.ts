/**
 * Tickets resource operations
 *
 * NinjaOne's ticketing API uses a board-based query model:
 * - Listing tickets requires POST to /v2/ticketing/trigger/board/{boardId}/run
 * - Comments/activity are accessed via /log-entry (not /comment)
 */

import type { HttpClient } from '../http.js';
import type {
  Ticket,
  TicketListParams,
  TicketListResponse,
  TicketCreateData,
  TicketUpdateData,
  TicketComment,
  TicketCommentCreateData,
  TicketAttachment,
  TicketForm,
} from '../types/tickets.js';

/**
 * Tickets resource operations
 */
export class TicketsResource {
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List tickets for a board.
   *
   * NinjaOne requires querying tickets via a board. The default board ID
   * is typically 1 (the system "All Tickets" board). You can discover
   * boards via listBoards().
   */
  async list(params?: TicketListParams): Promise<TicketListResponse> {
    const boardId = params?.boardId ?? 1;
    const body: Record<string, unknown> = {
      sortBy: [] as unknown[],
      filters: [] as unknown[],
      pageSize: params?.pageSize ?? 50,
      lastCursorId: params?.lastCursorId ?? 0,
    };

    // Build sort criteria
    if (params?.sortBy) {
      body.sortBy = [{ field: params.sortBy, direction: params.sortOrder ?? 'desc' }];
    }

    // Build filter criteria from params
    const filters: Array<{ field: string; operator: string; value: unknown }> = [];
    if (params?.status) {
      filters.push({ field: 'status', operator: 'is', value: params.status });
    }
    if (params?.priority) {
      filters.push({ field: 'priority', operator: 'is', value: params.priority });
    }
    if (params?.organizationId) {
      filters.push({ field: 'organizationId', operator: 'is', value: params.organizationId });
    }
    if (params?.deviceId) {
      filters.push({ field: 'nodeId', operator: 'is', value: params.deviceId });
    }
    if (filters.length > 0) {
      body.filters = filters;
    }

    const response = await this.httpClient.request<Ticket[] | TicketListResponse>(
      `/v2/ticketing/trigger/board/${boardId}/run`,
      { method: 'POST', body }
    );

    // Normalize response — API may return a raw array or wrapped object
    if (Array.isArray(response)) {
      return { tickets: response };
    }
    return response;
  }

  /**
   * Get a single ticket by ID
   */
  async get(id: number): Promise<Ticket> {
    return this.httpClient.request<Ticket>(`/v2/ticketing/ticket/${id}`);
  }

  /**
   * Create a new ticket
   */
  async create(data: TicketCreateData): Promise<Ticket> {
    return this.httpClient.request<Ticket>('/v2/ticketing/ticket', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Update an existing ticket
   */
  async update(id: number, data: TicketUpdateData): Promise<Ticket> {
    return this.httpClient.request<Ticket>(`/v2/ticketing/ticket/${id}`, {
      method: 'PUT',
      body: data,
    });
  }

  /**
   * Delete a ticket
   */
  async delete(id: number): Promise<void> {
    await this.httpClient.request<void>(`/v2/ticketing/ticket/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get ticket log entries (comments and activity).
   *
   * The NinjaOne API uses /log-entry for ticket comments/activity.
   * Filter by type to get only comments: type=COMMENT
   */
  async getComments(ticketId: number, type?: string): Promise<TicketComment[]> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (type) {
      params.type = type;
    }
    return this.httpClient.request<TicketComment[]>(
      `/v2/ticketing/ticket/${ticketId}/log-entry`,
      { params }
    );
  }

  /**
   * Add a comment to a ticket
   */
  async addComment(ticketId: number, data: TicketCommentCreateData): Promise<TicketComment> {
    return this.httpClient.request<TicketComment>(`/v2/ticketing/ticket/${ticketId}/comment`, {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Get ticket attachments
   */
  async getAttachments(ticketId: number): Promise<TicketAttachment[]> {
    return this.httpClient.request<TicketAttachment[]>(`/v2/ticketing/ticket/${ticketId}/attachment`);
  }

  /**
   * List available ticket boards
   */
  async listBoards(): Promise<unknown[]> {
    return this.httpClient.request<unknown[]>('/v2/ticketing/trigger/board');
  }

  /**
   * List available ticket forms
   */
  async listForms(): Promise<TicketForm[]> {
    return this.httpClient.request<TicketForm[]>('/v2/ticketing/ticket-form');
  }

  /**
   * Get a specific ticket form
   */
  async getForm(id: number): Promise<TicketForm> {
    return this.httpClient.request<TicketForm>(`/v2/ticketing/ticket-form/${id}`);
  }
}
