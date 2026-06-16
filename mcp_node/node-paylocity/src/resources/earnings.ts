import type {
  CompanyEarning,
  EmployeeEarning,
  LegacyListParams,
  ModernListParams,
  NormalizedList,
} from '../types/index.js';
import { unwrapLegacyArray, unwrapModernPage } from '../pagination.js';
import { CompanyScopedResource } from './_base.js';

/**
 * Modern company earning codes (API Hub):
 *   GET /apihub-payroll/v1/companies/{companyId}/earnings
 *
 * Legacy WebLink per-employee earnings (returns raw array):
 *   GET /api/v2/companies/{companyId}/employees/{employeeId}/earnings
 *   (verified against developer.paylocity.com WebLink "Get All Earnings")
 */
export class EarningsResource extends CompanyScopedResource {
  /** Modern API Hub: company-level earning codes. */
  async listCompanyEarnings(
    params: ModernListParams & { companyId?: string } = {}
  ): Promise<NormalizedList<CompanyEarning>> {
    const { companyId, ...rest } = params;
    const cid = this.resolveCompany(companyId);
    const response = await this.http.request<unknown>(
      `/apihub-payroll/v1/companies/${cid}/earnings`,
      { params: rest }
    );
    return unwrapModernPage<CompanyEarning>(response);
  }

  /** Legacy WebLink v2 employee-scoped earnings (raw array). */
  async listEmployeeEarnings(
    employeeId: string,
    params: LegacyListParams & { companyId?: string } = {}
  ): Promise<NormalizedList<EmployeeEarning>> {
    const { companyId, ...rest } = params;
    const cid = this.resolveCompany(companyId);
    const response = await this.http.request<unknown>(
      `/api/v2/companies/${cid}/employees/${encodeURIComponent(employeeId)}/earnings`,
      { params: rest }
    );
    return unwrapLegacyArray<EmployeeEarning>(response);
  }
}
