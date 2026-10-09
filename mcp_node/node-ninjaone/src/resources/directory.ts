/**
 * Directory resource operations
 *
 * Covers the org-structure catalogs used to resolve saved groups to devices,
 * list technicians, and read policy assignments: policies, groups, users,
 * locations, roles, and node-classes.
 *
 * Response field names for these endpoints are not documented anywhere
 * reachable from this repo, so every method returns `unknown` and callers
 * must not assume a shape.
 */

import type { HttpClient } from '../http.js';

/** Flat catalog kinds exposed as a single GET /v2/{kind} each. */
export type DirectoryListKind = 'users' | 'locations' | 'roles' | 'node-classes';

/**
 * Directory resource operations
 */
export class DirectoryResource {
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List all policies
   */
  async listPolicies(): Promise<unknown> {
    return this.httpClient.request('/v2/policies');
  }

  /**
   * Get a single policy by ID
   */
  async getPolicy(id: number): Promise<unknown> {
    return this.httpClient.request(`/v2/policies/${id}`);
  }

  /**
   * Get the conditions configured on a policy
   */
  async getPolicyConditions(id: number): Promise<unknown> {
    return this.httpClient.request(`/v2/policies/${id}/conditions`);
  }

  /**
   * List saved device groups
   */
  async listGroups(): Promise<unknown> {
    return this.httpClient.request('/v2/groups');
  }

  /**
   * Resolve a saved group to its member device IDs
   */
  async getGroupDeviceIds(id: number): Promise<unknown> {
    return this.httpClient.request(`/v2/group/${id}/device-ids`);
  }

  /**
   * List a flat directory catalog: users, locations, roles, or node-classes
   */
  async list(kind: DirectoryListKind): Promise<unknown> {
    return this.httpClient.request(`/v2/${kind}`);
  }
}
