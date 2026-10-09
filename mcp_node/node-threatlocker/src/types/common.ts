export interface ThreatLockerClientConfig {
  apiKey: string;
  organizationId?: string;
  baseUrl?: string;
  maxRetries?: number;
  rateLimitPerSecond?: number;
}

export interface PaginationParams {
  pageNumber?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * The PortalAPI dropdown/lookup endpoints (computer groups, organizations)
 * return this flat option shape: `label` is the display name, `value` the GUID.
 */
export interface LabelValue {
  label: string;
  value: string;
  numericValue?: number | null;
  entityType?: number | null;
  parentId?: string | null;
  disabled?: boolean;
}
