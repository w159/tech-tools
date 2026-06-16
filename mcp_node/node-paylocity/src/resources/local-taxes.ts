import type { LocalTax, LegacyListParams, NormalizedList } from '../types/index.js';
import { unwrapLegacyArray } from '../pagination.js';
import { CompanyScopedResource } from './_base.js';

/**
 * Legacy WebLink: GET /api/v2/companies/{companyId}/employees/{employeeId}/localTaxes
 * (verified against developer.paylocity.com WebLink "Get all local taxes")
 */
export class LocalTaxesResource extends CompanyScopedResource {
  async list(
    employeeId: string,
    params: LegacyListParams & { companyId?: string } = {}
  ): Promise<NormalizedList<LocalTax>> {
    const { companyId, ...rest } = params;
    const cid = this.resolveCompany(companyId);
    const response = await this.http.request<unknown>(
      `/api/v2/companies/${cid}/employees/${encodeURIComponent(employeeId)}/localTaxes`,
      { params: rest }
    );
    return unwrapLegacyArray<LocalTax>(response);
  }
}
