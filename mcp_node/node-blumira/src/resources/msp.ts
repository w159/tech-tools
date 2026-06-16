import type { HttpClient } from '../http.js';
import type {
  MspAccountSummary,
  MspAccountDetail,
  Finding,
  FindingDetail,
  FindingComment,
  FindingEvidence,
  AgentDevice,
  AgentKey,
  User,
  PaginatedResponse,
  SingleResponse,
  PaginationParams,
  FindingsListParams,
  ResolveFindingRequest,
  AssignOwnersRequest,
  AddCommentRequest,
} from '../types/index.js';

export class MspResource {
  constructor(private readonly http: HttpClient) {}

  // ── Accounts ──

  async listAccounts(params?: PaginationParams): Promise<PaginatedResponse<MspAccountSummary>> {
    return this.http.request<PaginatedResponse<MspAccountSummary>>('/msp/accounts', {
      params: params as Record<string, unknown>,
    });
  }

  async getAccount(accountId: string): Promise<SingleResponse<MspAccountDetail>> {
    return this.http.request<SingleResponse<MspAccountDetail>>(`/msp/accounts/${accountId}`);
  }

  // ── Findings (all accounts) ──

  async listAllFindings(params?: FindingsListParams): Promise<PaginatedResponse<Finding>> {
    return this.http.request<PaginatedResponse<Finding>>('/msp/accounts/findings', {
      params: params as Record<string, unknown>,
    });
  }

  // ── Findings (per account) ──

  async listFindings(accountId: string, params?: FindingsListParams): Promise<PaginatedResponse<Finding>> {
    return this.http.request<PaginatedResponse<Finding>>(`/msp/accounts/${accountId}/findings`, {
      params: params as Record<string, unknown>,
    });
  }

  async getFinding(accountId: string, findingId: string): Promise<SingleResponse<Finding>> {
    return this.http.request<SingleResponse<Finding>>(`/msp/accounts/${accountId}/findings/${findingId}`);
  }

  async getFindingEvidence(accountId: string, findingId: string, params?: PaginationParams): Promise<FindingEvidence> {
    return this.http.request<FindingEvidence>(`/msp/accounts/${accountId}/findings/${findingId}/evidence`, {
      params: params as Record<string, unknown>,
    });
  }

  async resolveFinding(accountId: string, findingId: string, data: ResolveFindingRequest): Promise<unknown> {
    return this.http.request(`/msp/accounts/${accountId}/findings/${findingId}/resolve`, {
      method: 'POST',
      body: data,
    });
  }

  async assignFindingOwners(accountId: string, findingId: string, data: AssignOwnersRequest): Promise<unknown> {
    return this.http.request(`/msp/accounts/${accountId}/findings/${findingId}/assign`, {
      method: 'POST',
      body: data,
    });
  }

  async listFindingComments(accountId: string, findingId: string): Promise<FindingComment[]> {
    return this.http.request<FindingComment[]>(`/msp/accounts/${accountId}/findings/${findingId}/comments`);
  }

  async addFindingComment(accountId: string, findingId: string, data: AddCommentRequest): Promise<FindingComment> {
    return this.http.request<FindingComment>(`/msp/accounts/${accountId}/findings/${findingId}/comments`, {
      method: 'POST',
      body: data,
    });
  }

  // ── Agents (per account) ──

  async listDevices(accountId: string, params?: PaginationParams): Promise<PaginatedResponse<AgentDevice>> {
    return this.http.request<PaginatedResponse<AgentDevice>>(`/msp/accounts/${accountId}/agents/devices`, {
      params: params as Record<string, unknown>,
    });
  }

  async getDevice(accountId: string, deviceId: string): Promise<AgentDevice> {
    return this.http.request<AgentDevice>(`/msp/accounts/${accountId}/agents/devices/${deviceId}`);
  }

  async listKeys(accountId: string, params?: PaginationParams): Promise<PaginatedResponse<AgentKey>> {
    return this.http.request<PaginatedResponse<AgentKey>>(`/msp/accounts/${accountId}/agents/keys`, {
      params: params as Record<string, unknown>,
    });
  }

  async getKey(accountId: string, keyId: string): Promise<AgentKey> {
    return this.http.request<AgentKey>(`/msp/accounts/${accountId}/agents/keys/${keyId}`);
  }

  // ── Users (per account) ──

  async listUsers(accountId: string, params?: PaginationParams): Promise<PaginatedResponse<User>> {
    return this.http.request<PaginatedResponse<User>>(`/msp/accounts/${accountId}/users`, {
      params: params as Record<string, unknown>,
    });
  }
}
