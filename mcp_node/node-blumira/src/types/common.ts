// ── Client Config ──

export interface BlumiraClientConfig {
  jwtToken: string;
  baseUrl?: string;
  maxRetries?: number;
  rateLimitPerMinute?: number;
}

// ── Pagination ──

export interface PaginationParams {
  page?: number;
  page_size?: number;
  limit?: number;
  order_by?: string;
}

export interface ApiMeta {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface ApiLinks {
  self: string;
  next: string | null;
  prev: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: ApiMeta;
  links: ApiLinks;
  status: string;
}

// ── Health ──

export interface HealthData {
  api_name: string;
  build_time: string;
  commit_hash: string;
}

export interface HealthResponse {
  status: string;
  data: HealthData;
}

// ── Findings ──

export interface Finding {
  finding_id: string;
  short_id: string;
  name: string;
  analysis: string;
  status: number;
  status_name: string;
  priority: number;
  type_name: string;
  org_id: string;
  org_name: string | null;
  created: string;
  modified: string;
}

export interface FindingDetail extends Finding {
  category_name: string;
  jurisdiction_name: string;
  summary: string;
  url: string;
  resolution: number;
  resolution_name: string;
  resolution_notes: string;
  owners: {
    responders: Owner[];
    analysts: Owner[];
    managers: Owner[];
  };
}

export interface Owner {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
}

export interface FindingComment {
  id: string | null;
  body: string;
  age: number;
  sender: Sender;
}

export interface Sender {
  id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface FindingsListParams extends PaginationParams {
  status?: number;
  'status.eq'?: number;
  'status.in'?: string;
  'status.!eq'?: number;
  'status.!in'?: string;
  priority?: number;
  'priority.eq'?: number;
  'priority.in'?: string;
  'priority.!eq'?: number;
  'priority.!in'?: string;
  category?: number;
  'category.eq'?: number;
  'category.in'?: string;
  'category.!eq'?: number;
  'category.!in'?: string;
  name?: string;
  'name.eq'?: string;
  'name.in'?: string;
  'name.!eq'?: string;
  'name.!in'?: string;
  'name.contains'?: string;
  'name.!contains'?: string;
  'name.regex'?: string;
  'name.!regex'?: string;
  blocked?: boolean;
  'blocked.eq'?: boolean;
  'blocked.!eq'?: boolean;
  created?: string;
  created_after?: string;
  created_before?: string;
  'created.eq'?: string;
  'created.gt'?: string;
  'created.lt'?: string;
  'created.!eq'?: string;
  'created.!gt'?: string;
  'created.!lt'?: string;
  modified?: string;
  modified_after?: string;
  modified_before?: string;
  'modified.eq'?: string;
  'modified.gt'?: string;
  'modified.lt'?: string;
  'modified.!eq'?: string;
  'modified.!gt'?: string;
  'modified.!lt'?: string;
  created_by?: string;
  modified_by?: string;
  'modified_by.eq'?: string;
  'modified_by.in'?: string;
  'modified_by.!eq'?: string;
  'modified_by.!in'?: string;
}

export interface EvidenceKey {
  /** Field/column name present in each evidence row. */
  name: string;
  /** Human-friendly label for the field, when provided by the API. */
  label?: string;
  /** Field data type hint (e.g. "string", "ip", "timestamp"), when provided. */
  type?: string;
}

export interface FindingEvidence {
  /** Schema describing the keys present in each evidence row. */
  evidence_keys: EvidenceKey[];
  /** Paginated evidence rows; each object's keys come from evidence_keys. */
  data: Array<Record<string, unknown>>;
  meta?: ApiMeta;
  links?: ApiLinks;
  status?: string;
}

export interface ResolveFindingRequest {
  resolution: number;
  resolution_notes?: string;
}

export interface AssignOwnersRequest {
  owner_type: 'responder' | 'analyst' | 'manager';
  owners: string[];
}

export interface AddCommentRequest {
  body: string;
  sender: string;
}

// ── Agents / Devices ──

export interface AgentDevice {
  device_id: string;
  hostname: string;
  arch: string;
  plat: string;
  description: string | null;
  is_domain_controller: boolean;
  is_excluded: boolean;
  is_isolated: boolean;
  is_sleeping: boolean;
  isolation_requested: boolean;
  key_id: string;
  keyname: string;
  org_id: string;
  alive: string;
  created: string;
  modified: string;
}

// ── Agents / Keys ──

export interface AgentKey {
  key_id: string;
  description: string;
  agent_count: number;
  agent_seat_count: number;
  org_id: string;
  created: string;
  modified: string;
}

// ── Users ──

export interface UserRole {
  role_id: number;
  role_name: string;
}

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  org_roles: UserRole[];
}

// ── Resolutions ──

export interface Resolution {
  id: number;
  name: string;
}

// ── MSP Accounts ──

export interface MspAccountSummary {
  account_id: string;
  name: string;
  open_findings: number;
}

export interface MspAccountDetail {
  account_id: string;
  name: string;
  open_findings: number;
  license: string;
  agent_count_available: number;
  agent_count_used: number;
  user_count: number;
}

// ── Detail Response Wrappers ──

export interface SingleResponse<T> {
  data: T;
  status: string;
}
