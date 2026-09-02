import type { HttpClient } from '../http.js';
import type { AuditLogEntry, AuditLogSearchParams, AuditFileHistoryParams, PaginatedResponse } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

/** ThreatLocker rejects fractional seconds; "YYYY-MM-DDTHH:MM:SSZ" only. */
export function toPortalDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${String(value)}`);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export class AuditLogResource {
  constructor(private readonly http: HttpClient) {}

  async search(params: AuditLogSearchParams): Promise<PaginatedResponse<AuditLogEntry>> {
    // swagger ActionLogParamsDto. Without the usenewsearch header the endpoint
    // answers 500; without dates, 417 (both verified live 2026-09-01).
    // Verified live 2026-09-01: top-level `hostname`, `actionType(s)` and
    // `actionId` filter; top-level `username` and `fullPath` are ignored. The
    // Advanced Search list (paramsFieldsDto, filterType 1 = exact) is what
    // filters username, fullPath, applicationName and policyName.
    const paramsFieldsDto = (['username', 'fullPath', 'applicationName', 'policyName'] as const)
      .filter(key => params[key] !== undefined && params[key] !== '')
      .map(key => ({ name: key, value: params[key], filterType: 1, fieldType: 1 }));
    const body: Record<string, unknown> = {
      startDate: toPortalDate(params.startDate),
      endDate: toPortalDate(params.endDate),
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 25,
      showChildOrganizations: params.showChildOrganizations ?? false,
      paramsFieldsDto,
      sortDescending: params.sortDescending ?? true,
      showTotalCount: true,
    };
    for (const key of ['hostname', 'actionType', 'actionTypes', 'actionId'] as const) {
      if (params[key] !== undefined && params[key] !== '') body[key] = params[key];
    }
    const response = await this.http.request<AuditLogEntry[]>('/ActionLog/ActionLogGetByParametersV2', {
      method: 'POST',
      body,
      headers: { usenewsearch: 'true' },
    });
    return unwrapPaginatedResponse<AuditLogEntry>(response, body.pageNumber as number, body.pageSize as number);
  }

  async get(eActionLogId: string, sourceTableId = 1): Promise<AuditLogEntry> {
    return this.http.request<AuditLogEntry>('/ActionLog/ActionLogGetByIdV2', {
      params: { eActionLogId, sourceTableId },
    });
  }

  /** Requires fullPath plus hostname or computerId; fullPath alone is 417 (verified live). */
  async getFileHistory(params: AuditFileHistoryParams): Promise<AuditLogEntry[]> {
    const response = await this.http.request<AuditLogEntry[]>('/ActionLog/ActionLogGetAllForFileHistoryV2', {
      params: {
        fullPath: params.fullPath,
        hostname: params.hostname,
        computerId: params.computerId,
        sourceTableId: params.sourceTableId ?? 1,
        pageNumber: params.pageNumber ?? 1,
        pageSize: params.pageSize ?? 25,
      },
    });
    return Array.isArray(response) ? response : [];
  }
}
