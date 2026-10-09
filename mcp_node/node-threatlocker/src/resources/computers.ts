import type { HttpClient } from '../http.js';
import type { Computer, ComputerListParams, ComputerCheckin, ComputerCheckinParams, PaginatedResponse } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

export class ComputersResource {
  constructor(private readonly http: HttpClient) {}

  async list(params: ComputerListParams = {}): Promise<PaginatedResponse<Computer>> {
    // Field names follow swagger ComputerParameterDto. orderBy must be one of the
    // seven documented values; computername is the Devices-page default.
    const body = {
      searchText: params.searchText ?? '',
      computerGroup: params.computerGroup,
      orderBy: params.orderBy ?? 'computername',
      isAscending: params.isAscending ?? true,
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 25,
      childOrganizations: params.childOrganizations ?? false,
      action: params.action,
      showLastCheckIn: params.showLastCheckIn ?? true,
      showDeleted: params.showDeleted ?? false,
    };
    const response = await this.http.request<Computer[]>('/Computer/ComputerGetByAllParameters', { method: 'POST', body });
    return unwrapPaginatedResponse<Computer>(response, body.pageNumber, body.pageSize);
  }

  async get(computerId: string): Promise<Computer> {
    return this.http.request<Computer>('/Computer/ComputerGetForEditById', { params: { computerId } });
  }

  async getCheckins(params: ComputerCheckinParams): Promise<PaginatedResponse<ComputerCheckin>> {
    const body = {
      computerId: params.computerId,
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 25,
      hideHeartbeat: params.hideHeartbeat ?? true,
      showTotalCount: true,
    };
    const response = await this.http.request<ComputerCheckin[]>('/ComputerCheckin/ComputerCheckinGetByParameters', { method: 'POST', body });
    return unwrapPaginatedResponse<ComputerCheckin>(response, body.pageNumber, body.pageSize);
  }

  /** Active maintenance modes for a computer (GET /MaintenanceMode/MaintenanceModeGetByComputerId). */
  async getMaintenanceModes(computerId: string): Promise<Record<string, unknown>[]> {
    const response = await this.http.request<Record<string, unknown>[]>('/MaintenanceMode/MaintenanceModeGetByComputerId', { params: { computerId } });
    return Array.isArray(response) ? response : [];
  }
}
