import type { HttpClient } from '../http.js';
import type { LabelValue, ComputerGroupDropdownParams } from '../types/index.js';

export class ComputerGroupsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Computer groups as {label, value} options. ComputerGroupGetGroupAndComputer
   * returns a nested tree meant for the portal's picker; the dropdown endpoint
   * is the flat list of groups in the managed organization (verified live).
   */
  async list(params: ComputerGroupDropdownParams = {}): Promise<LabelValue[]> {
    const response = await this.http.request<LabelValue[]>('/ComputerGroup/ComputerGroupGetDropdownByOrganizationId', {
      params: params as Record<string, unknown>,
    });
    return Array.isArray(response) ? response : [];
  }

  async getDropdown(params: ComputerGroupDropdownParams = {}): Promise<LabelValue[]> {
    return this.list(params);
  }
}
