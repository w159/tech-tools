import type { PaginatedResponse } from './types/index.js';

export interface ThreatLockerResponse {
  totalItems?: number;
  items?: unknown[];
  // ThreatLocker may use different property names
  data?: unknown[];
  results?: unknown[];
}

export function unwrapPaginatedResponse<T>(
  response: ThreatLockerResponse | T[],
  pageNumber: number,
  pageSize: number
): PaginatedResponse<T> {
  // The PortalAPI *GetByParameters endpoints return a bare JSON array (verified
  // live 2026-09-01 against Computer, ApprovalRequest and ComputerCheckin) and
  // put the total in each row as `totalRows`. The wrapped shapes below are kept
  // for any endpoint that does envelope its page.
  const items = (Array.isArray(response)
    ? response
    : response.items || response.data || response.results || []) as T[];
  // Computer rows carry `totalRows`; approval rows carry `count` (verified live).
  const first = items[0] as { totalRows?: unknown; count?: unknown } | undefined;
  const rowTotal = typeof first?.totalRows === 'number' ? first.totalRows : first?.count;
  const total = Array.isArray(response)
    ? (typeof rowTotal === 'number' ? rowTotal : items.length)
    : response.totalItems || 0;
  const hasMore = pageNumber * pageSize < total;

  return {
    items,
    page: pageNumber,
    pageSize,
    total,
    hasMore,
  };
}