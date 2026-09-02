import type { HttpClient } from '../http.js';
import type { ApprovalRequest, ApprovalRequestListParams, PermitApplication, PaginatedResponse } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

export class ApprovalRequestsResource {
  constructor(private readonly http: HttpClient) {}

  async list(params: ApprovalRequestListParams = {}): Promise<PaginatedResponse<ApprovalRequest>> {
    // swagger ApprovalRequestParametersDto; statusId is required (Pending = 1).
    const body = {
      statusId: params.statusId ?? 1,
      searchText: params.searchText ?? '',
      showChildOrganizations: params.showChildOrganizations ?? false,
      orderBy: params.orderBy ?? 'dateTime',
      isAscending: params.isAscending ?? false,
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 25,
    };
    const response = await this.http.request<ApprovalRequest[]>('/ApprovalRequest/ApprovalRequestGetByParameters', { method: 'POST', body });
    return unwrapPaginatedResponse<ApprovalRequest>(response, body.pageNumber, body.pageSize);
  }

  async get(approvalRequestId: string): Promise<ApprovalRequest> {
    return this.http.request<ApprovalRequest>('/ApprovalRequest/ApprovalRequestGetById', { params: { approvalRequestId } });
  }

  async getPendingCount(includeChildOrganizations = false): Promise<number> {
    // Live API returns a bare number (verified 2026-09-01); keep the {count}
    // envelope as a fallback.
    const response = await this.http.request<number | { count: number }>('/ApprovalRequest/ApprovalRequestGetCount', {
      params: { includeChildOrganizations },
    });
    return typeof response === 'number' ? response : response.count;
  }

  async getPermitApplication(approvalRequestId: string): Promise<PermitApplication> {
    return this.http.request<PermitApplication>('/ApprovalRequest/ApprovalRequestGetPermitApplicationById', {
      params: { approvalRequestId },
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
