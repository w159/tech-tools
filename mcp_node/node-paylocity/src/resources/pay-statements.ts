import type { PayStatementSummary } from '../types/index.js';
import { CompanyScopedResource } from './_base.js';

/**
 * Legacy WebLink pay statement summary:
 *   GET /api/v2/companies/{companyId}/employees/{employeeId}/paystatement/summary/{year}
 *   (verified against developer.paylocity.com WebLink
 *    "Get employee pay statement summary data for the specified year")
 *
 * Optional query params: pagesize, pagenumber, includetotalcount, codegroup.
 */
export interface PayStatementSummaryParams {
  companyId?: string;
  pagesize?: number;
  pagenumber?: number;
  includetotalcount?: boolean;
  codegroup?: string;
}

export class PayStatementsResource extends CompanyScopedResource {
  async getYearlySummary(
    employeeId: string,
    year: number,
    opts: PayStatementSummaryParams = {}
  ): Promise<PayStatementSummary> {
    const { companyId, ...query } = opts;
    const cid = this.resolveCompany(companyId);
    return this.http.request<PayStatementSummary>(
      `/api/v2/companies/${cid}/employees/${encodeURIComponent(
        employeeId
      )}/paystatement/summary/${year}`,
      { params: query }
    );
  }
}
