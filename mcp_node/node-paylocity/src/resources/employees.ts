import type {
  Employee,
  EmployeeListParams,
  NormalizedList,
} from '../types/index.js';
import { unwrapModernPage } from '../pagination.js';
import { CompanyScopedResource } from './_base.js';

/**
 * Modern CoreHR employees:
 *   GET /corehr/v1/companies/{companyId}/employees
 *   GET /corehr/v1/companies/{companyId}/employees/{employeeId}
 *
 * Pagination via `limit` (max 20) and `nextToken`. Expansion via `include`
 * CSV (info, position, status, payRate, futurePayRate).
 *
 * Writes (POST/PUT) are intentionally NOT implemented — read-only surface.
 */
export class EmployeesResource extends CompanyScopedResource {
  async list(
    params: EmployeeListParams & { companyId?: string } = {}
  ): Promise<NormalizedList<Employee>> {
    const { companyId, ...rest } = params;
    const cid = this.resolveCompany(companyId);
    const response = await this.http.request<unknown>(
      `/corehr/v1/companies/${cid}/employees`,
      { params: rest }
    );
    return unwrapModernPage<Employee>(response);
  }

  async get(
    employeeId: string,
    params: { include?: string; companyId?: string } = {}
  ): Promise<Employee> {
    const { companyId, ...rest } = params;
    const cid = this.resolveCompany(companyId);
    return this.http.request<Employee>(
      `/corehr/v1/companies/${cid}/employees/${encodeURIComponent(employeeId)}`,
      { params: rest }
    );
  }
}
