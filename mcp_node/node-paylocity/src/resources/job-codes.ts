import type { JobCode, ModernListParams, NormalizedList } from '../types/index.js';
import { unwrapModernPage } from '../pagination.js';
import { CompanyScopedResource } from './_base.js';

/**
 * Job Codes [Batch]: GET /apihub-payroll/v1/companies/{companyId}/jobs
 * (verified against developer.paylocity.com "Get Job Codes [Batch]";
 *  job codes live under the Payroll API Hub, not Position Management.)
 */
export class JobCodesResource extends CompanyScopedResource {
  async list(
    params: ModernListParams & { companyId?: string } = {}
  ): Promise<NormalizedList<JobCode>> {
    const { companyId, ...rest } = params;
    const cid = this.resolveCompany(companyId);
    const response = await this.http.request<unknown>(
      `/apihub-payroll/v1/companies/${cid}/jobs`,
      { params: rest }
    );
    return unwrapModernPage<JobCode>(response);
  }
}
