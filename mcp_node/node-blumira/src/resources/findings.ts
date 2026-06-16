import type { HttpClient } from '../http.js';
import type {
  Finding,
  FindingDetail,
  FindingComment,
  FindingEvidence,
  FindingsListParams,
  PaginationParams,
  PaginatedResponse,
  SingleResponse,
  ResolveFindingRequest,
  AssignOwnersRequest,
  AddCommentRequest,
} from '../types/index.js';

export class FindingsResource {
  constructor(private readonly http: HttpClient) {}

  async list(params?: FindingsListParams): Promise<PaginatedResponse<Finding>> {
    return this.http.request<PaginatedResponse<Finding>>('/org/findings', {
      params: params as Record<string, unknown>,
    });
  }

  async get(findingId: string): Promise<SingleResponse<Finding>> {
    return this.http.request<SingleResponse<Finding>>(`/org/findings/${findingId}`);
  }

  async getDetails(findingId: string): Promise<SingleResponse<FindingDetail>> {
    return this.http.request<SingleResponse<FindingDetail>>(`/org/findings/${findingId}/details`);
  }

  async getEvidence(findingId: string, params?: PaginationParams): Promise<FindingEvidence> {
    return this.http.request<FindingEvidence>(`/org/findings/${findingId}/evidence`, {
      params: params as Record<string, unknown>,
    });
  }

  async resolve(findingId: string, data: ResolveFindingRequest): Promise<unknown> {
    return this.http.request(`/org/findings/${findingId}/resolve`, {
      method: 'POST',
      body: data,
    });
  }

  async assignOwners(findingId: string, data: AssignOwnersRequest): Promise<unknown> {
    return this.http.request(`/org/findings/${findingId}/assign`, {
      method: 'POST',
      body: data,
    });
  }

  async listComments(findingId: string): Promise<FindingComment[]> {
    return this.http.request<FindingComment[]>(`/org/findings/${findingId}/comments`);
  }

  async addComment(findingId: string, data: AddCommentRequest): Promise<FindingComment> {
    return this.http.request<FindingComment>(`/org/findings/${findingId}/comments`, {
      method: 'POST',
      body: data,
    });
  }
}
