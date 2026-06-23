import type { HttpClient } from '../http.js';
import type { ApprovalRequest, ApprovalRequestListParams, PermitApplication, PaginatedResponse } from '../types/index.js';
import { buildSearchBody } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

export class ApprovalRequestsResource {
  constructor(private readonly http: HttpClient) {}

  async list(params: ApprovalRequestListParams = {}): Promise<PaginatedResponse<ApprovalRequest>> {
    const body = buildSearchBody(params);
    const response = await this.http.request<any>('/ApprovalRequest/ApprovalRequestGetByParameters', {
      method: 'POST',
      body,
    });
    return unwrapPaginatedResponse<ApprovalRequest>(response, body.pageNumber, body.pageSize);
  }

  async get(id: number): Promise<ApprovalRequest> {
    return this.http.request<ApprovalRequest>('/ApprovalRequest/ApprovalRequestGetById', {
      params: { approvalRequestId: id },
    });
  }

  async getPendingCount(): Promise<number> {
    const response = await this.http.request<{ count: number }>('/ApprovalRequest/ApprovalRequestGetCount');
    return response.count;
  }

  async getPermitApplication(id: number): Promise<PermitApplication> {
    return this.http.request<PermitApplication>('/ApprovalRequest/ApprovalRequestGetPermitApplicationById', {
      params: { approvalRequestId: id },
    });
  }

  // Source: https://threatlocker.kb.help/portalapiapprovalrequest/ > ApprovalRequestPermitApplication
  // Body: { approvalRequest: { approvalRequestId, json, comments?, requestorEmailAddress? } }
  // The `json` field must be the complete JSON object returned by getPermitApplication().
  async approve(params: {
    approvalRequestId: string;
    json: unknown;
    comments?: string;
    requestorEmailAddress?: string;
  }): Promise<unknown> {
    const { approvalRequestId, json, comments, requestorEmailAddress } = params;
    const approvalRequest: Record<string, unknown> = { approvalRequestId, json };
    if (comments !== undefined) approvalRequest['comments'] = comments;
    if (requestorEmailAddress !== undefined) approvalRequest['requestorEmailAddress'] = requestorEmailAddress;
    return this.http.request<unknown>('/ApprovalRequest/ApprovalRequestPermitApplication', {
      method: 'POST',
      body: { approvalRequest },
    });
  }
}