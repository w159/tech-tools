import type { HttpClient } from '../http.js';
import type { SystemAuditEntry, SystemAuditSearchParams, PaginatedResponse } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';
import { toPortalDate } from './audit-log.js';

// Source: https://threatlocker.kb.help/portalapisystemaudit/ and live swagger
// portalapi.b.threatlocker.com/swagger/public/swagger.json (SystemAuditGetByParameters).
// This is the portal's own administrator/login audit trail, distinct from the
// Unified Audit device event log (ActionLog).

export class SystemAuditResource {
  constructor(private readonly http: HttpClient) { }

  async search(params: SystemAuditSearchParams): Promise<PaginatedResponse<SystemAuditEntry>> {
    const body = {
      startDate: toPortalDate(params.startDate),
      endDate: toPortalDate(params.endDate),
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 100,
      actions: params.actions,
      details: params.details,
      effectiveAction: params.effectiveAction,
      emailAddress: params.emailAddress,
      iPAddress: params.iPAddress,
      objectId: params.objectId,
      viewChildOrganizations: params.viewChildOrganizations,
    };
    // Response is a bare array (swagger SystemAuditGetByParameters).
    const response = await this.http.request<SystemAuditEntry[]>('/SystemAudit/SystemAuditGetByParameters', {
      method: 'POST',
      body,
    });
    return unwrapPaginatedResponse<SystemAuditEntry>(response, body.pageNumber, body.pageSize);
  }
}