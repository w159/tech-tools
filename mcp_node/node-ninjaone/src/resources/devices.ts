/**
 * Devices resource operations
 */

import type { HttpClient } from '../http.js';
import type {
  Device,
  DeviceListParams,
  DeviceUpdateData,
  DeviceActivity,
  DeviceActivityListResponse,
  DeviceService,
  DeviceSoftware,
  DeviceInventory,
} from '../types/devices.js';

/** Reboot mode: FORCED restarts immediately and can lose unsaved user work. */
export type RebootMode = 'NORMAL' | 'FORCED';

/** Windows service control verbs accepted by the /control endpoint. */
export type ServiceAction = 'START' | 'PAUSE' | 'STOP' | 'RESTART';

/** Patch surface: OS updates versus third-party software updates. */
export type PatchType = 'os' | 'software';

/** Patch operation: scan detects what is missing, apply installs it. */
export type PatchAction = 'scan' | 'apply';

/** Body for POST /v2/device/{id}/script/run. */
export interface RunScriptBody {
  /** SCRIPT runs a catalog script by numeric id; ACTION runs a built-in by uid. */
  type: 'SCRIPT' | 'ACTION';
  /** Numeric script identifier - required when type is SCRIPT. */
  id?: number;
  /** Built-in action UUID - required when type is ACTION. */
  uid?: string;
  /** Parameter string passed through to the script or action. */
  parameters?: string;
  /** Credential role to run as, from the device's scripting options. */
  runAs?: string;
}

/** Body for PUT /v2/device/{id}/maintenance. */
export interface MaintenanceWindow {
  /** Which subsystems to suppress for the duration of the window. */
  disabledFeatures?: Array<'ALERTS' | 'PATCHING' | 'AVSCANS' | 'TASKS'>;
  /** Window start as a Unix epoch in seconds; defaults to now when omitted. */
  start?: number;
  /** Window end as a Unix epoch in seconds. */
  end: number;
  /** Reason recorded on the device activity log. */
  reasonMessage?: string;
}

/**
 * Devices resource operations
 */
export class DevicesResource {
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * List all devices
   */
  async list(params?: DeviceListParams): Promise<Device[]> {
    const response = await this.httpClient.request<Device[]>('/v2/devices', {
      params: this.buildListParams(params),
    });
    return response;
  }

  /**
   * List devices for a specific organization
   */
  async listByOrganization(organizationId: number, params?: Omit<DeviceListParams, 'organizationId'>): Promise<Device[]> {
    const response = await this.httpClient.request<Device[]>(`/v2/organization/${organizationId}/devices`, {
      params: this.buildListParams(params),
    });
    return response;
  }

  /**
   * Get a single device by ID
   */
  async get(id: number): Promise<Device> {
    return this.httpClient.request<Device>(`/v2/device/${id}`);
  }

  /**
   * Update a device
   */
  async update(id: number, data: DeviceUpdateData): Promise<Device> {
    return this.httpClient.request<Device>(`/v2/device/${id}`, {
      method: 'PATCH',
      body: data,
    });
  }

  /**
   * Approve a pending device
   */
  async approve(id: number): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/approval/APPROVED`, {
      method: 'POST',
    });
  }

  /**
   * Reject a pending device
   */
  async reject(id: number): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/approval/REJECTED`, {
      method: 'POST',
    });
  }

  /**
   * Reboot a device: POST /v2/device/{id}/reboot/{mode}
   *
   * The mode is a path segment, not a body field. NORMAL asks the OS to close
   * applications gracefully; FORCED restarts immediately and can lose unsaved work.
   */
  async reboot(id: number, mode: RebootMode = 'NORMAL', reason?: string): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/reboot/${mode}`, {
      method: 'POST',
      body: reason ? { reason } : undefined,
    });
  }

  /**
   * Get device activities
   */
  async getActivities(id: number, params?: { after?: number; before?: number; pageSize?: number; type?: string }): Promise<DeviceActivityListResponse> {
    return this.httpClient.request<DeviceActivityListResponse>(`/v2/device/${id}/activities`, {
      params: this.buildListParams(params),
    });
  }

  /**
   * Get all activities for all devices (optionally filtered by organization)
   */
  async listActivities(params?: { organizationId?: number; after?: number; before?: number; pageSize?: number }): Promise<DeviceActivity[]> {
    return this.httpClient.request<DeviceActivity[]>('/v2/activities', {
      params: this.buildListParams(params),
    });
  }

  /**
   * Get device services (Windows only)
   */
  async getServices(id: number): Promise<DeviceService[]> {
    return this.httpClient.request<DeviceService[]>(`/v2/device/${id}/windows-services`);
  }

  /**
   * Start, stop, pause, or restart a Windows service:
   * POST /v2/device/{id}/windows-service/{serviceId}/control
   *
   * There are no per-verb /start, /stop, /restart paths; the verb is the
   * `action` body field on this single endpoint.
   */
  async controlService(id: number, serviceId: string, action: ServiceAction): Promise<void> {
    await this.httpClient.request<void>(
      `/v2/device/${id}/windows-service/${encodeURIComponent(serviceId)}/control`,
      { method: 'POST', body: { action } }
    );
  }

  /**
   * Get device software inventory
   */
  async getSoftware(id: number): Promise<DeviceSoftware[]> {
    return this.httpClient.request<DeviceSoftware[]>(`/v2/device/${id}/software`);
  }

  /**
   * Get device hardware inventory
   */
  async getInventory(id: number): Promise<DeviceInventory> {
    return this.httpClient.request<DeviceInventory>(`/v2/device/${id}/inventory`);
  }

  /**
   * Get a per-device sub-resource: GET /v2/device/{id}/{kind}
   *
   * `kind` is the literal path tail, so multi-segment tails work too
   * ("policy/overrides", "scripting/options"). Valid kinds are enumerated on
   * the ninjaone_devices_inventory tool schema. Response shapes are
   * undocumented, so callers pass the raw record through unshaped.
   *
   * The patch kinds (os-patches, software-patches) accept status, type and
   * severity filters; passing them for other kinds is harmless.
   */
  async getInventoryByKind(
    id: number,
    kind: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<unknown> {
    return this.httpClient.request<unknown>(`/v2/device/${id}/${kind}`, {
      params: this.buildListParams(params),
    });
  }

  /**
   * Run a script or built-in action on a device: POST /v2/device/{id}/script/run
   *
   * type=SCRIPT uses the numeric `id` of a catalog script; type=ACTION uses the
   * `uid` of a built-in action. Both come from automation.listScripts() or
   * getScriptingOptions(). The pre-1.8 `scriptId` field name is rejected by the
   * API with HTTP 400.
   */
  async runScript(id: number, body: RunScriptBody): Promise<unknown> {
    return this.httpClient.request<unknown>(`/v2/device/${id}/script/run`, {
      method: 'POST',
      body,
    });
  }

  /**
   * List the scripts and built-in actions runnable on this device:
   * GET /v2/device/{id}/scripting/options
   *
   * Note the path separator: `scripting/options`, not `scripting-options`.
   */
  async getScriptingOptions(id: number, lang?: string): Promise<unknown> {
    return this.httpClient.request<unknown>(`/v2/device/${id}/scripting/options`, {
      params: lang ? { lang } : {},
    });
  }

  /**
   * Trigger a patch scan or apply on a device.
   *
   * POST /v2/device/{id}/patch/{os|software}/{scan|apply}. All four take no
   * body and return immediately; the work runs as a job, so poll
   * getActiveJobs(id) or the device's patch inventory for the outcome.
   */
  async runPatchAction(id: number, patchType: PatchType, action: PatchAction): Promise<unknown> {
    return this.httpClient.request<unknown>(`/v2/device/${id}/patch/${patchType}/${action}`, {
      method: 'POST',
    });
  }

  /**
   * Currently running (active) jobs on a device: GET /v2/device/{id}/jobs
   */
  async getActiveJobs(id: number, params?: { lang?: string; tz?: string }): Promise<unknown> {
    return this.httpClient.request<unknown>(`/v2/device/${id}/jobs`, {
      params: this.buildListParams(params),
    });
  }

  /**
   * Policy overrides configured on a device: GET /v2/device/{id}/policy/overrides
   */
  async getPolicyOverrides(id: number): Promise<unknown> {
    return this.httpClient.request<unknown>(`/v2/device/${id}/policy/overrides`);
  }

  /**
   * Clear every policy override on a device, returning it to its assigned policy.
   */
  async resetPolicyOverrides(id: number): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/policy/overrides`, {
      method: 'DELETE',
    });
  }

  /**
   * Deep link to the device in the NinjaOne web console:
   * GET /v2/device/{id}/dashboard-url
   */
  async getDashboardUrl(id: number): Promise<unknown> {
    return this.httpClient.request<unknown>(`/v2/device/${id}/dashboard-url`);
  }

  /**
   * Free-text device search: GET /v2/devices/search
   *
   * Matches on name, logged-on user, IP address and similar identifiers. Use
   * this when you have a hostname or a user and need the numeric device ID.
   */
  async search(q: string, limit?: number): Promise<unknown> {
    return this.httpClient.request<unknown>('/v2/devices/search', {
      params: this.buildListParams({ q, limit }),
    });
  }

  /**
   * List devices with their full detail payload: GET /v2/devices-detailed
   *
   * Same filters as list(), but each record carries the nested inventory
   * NinjaOne omits from the plain /v2/devices response.
   */
  async listDetailed(params?: DeviceListParams): Promise<Record<string, unknown>[]> {
    return this.httpClient.request<Record<string, unknown>[]>('/v2/devices-detailed', {
      params: this.buildListParams(params),
    });
  }

  /**
   * Schedule a maintenance window on a device: PUT /v2/device/{id}/maintenance
   *
   * The method is PUT, not POST. `end` is required; omitting `start` begins the
   * window immediately.
   */
  async scheduleMaintenance(id: number, body: MaintenanceWindow): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/maintenance`, {
      method: 'PUT',
      body,
    });
  }

  /**
   * Cancel a device's maintenance window
   */
  async cancelMaintenance(id: number): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/maintenance`, {
      method: 'DELETE',
    });
  }

  /**
   * Get device custom fields
   */
  async getCustomFields(id: number): Promise<Record<string, unknown>> {
    return this.httpClient.request<Record<string, unknown>>(`/v2/device/${id}/custom-fields`);
  }

  /**
   * Update device custom fields
   */
  async updateCustomFields(id: number, fields: Record<string, unknown>): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}/custom-fields`, {
      method: 'PATCH',
      body: fields,
    });
  }

  /**
   * Delete a device
   */
  async delete(id: number): Promise<void> {
    await this.httpClient.request<void>(`/v2/device/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * Build query parameters from list params
   */
  private buildListParams<T extends object>(params?: T): Record<string, string | number | boolean | undefined> {
    if (!params) return {};

    const result: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        result[key] = value as string | number | boolean;
      }
    }
    return result;
  }
}
