/**
 * Device types for NinjaOne
 */

import type { BaseEntity, BaseListParams, TimestampFields, CustomField } from './common.js';

/**
 * Device system information
 */
export interface DeviceSystem {
  /** Computer name */
  name?: string;
  /** DNS name */
  dnsName?: string;
  /** NetBIOS name */
  netbiosName?: string;
  /** Manufacturer */
  manufacturer?: string;
  /** Model */
  model?: string;
  /** BIOS serial number */
  biosSerialNumber?: string;
  /** Serial number */
  serialNumber?: string;
}

/**
 * Device operating system information
 */
export interface DeviceOS {
  /** OS name */
  name?: string;
  /** OS version */
  version?: string;
  /** OS architecture */
  architecture?: string;
  /** Build number */
  buildNumber?: string;
  /** Service pack */
  servicePack?: string;
}

/**
 * Device network interface
 */
export interface DeviceNetworkInterface {
  /** Interface name */
  name?: string;
  /** MAC address */
  macAddress?: string;
  /** IP addresses */
  ipAddresses?: string[];
  /** Interface type */
  type?: string;
}

/**
 * Device last logged on user
 */
export interface DeviceLastUser {
  /** Username */
  userName?: string;
  /** Domain */
  domain?: string;
  /** Last logon time */
  lastLogonTime?: number;
}

/**
 * Device status
 */
export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'APPROVAL_PENDING' | 'UNKNOWN';

/**
 * Device node class
 */
export type DeviceNodeClass =
  | 'WINDOWS_WORKSTATION'
  | 'WINDOWS_SERVER'
  | 'MAC'
  | 'LINUX_WORKSTATION'
  | 'LINUX_SERVER'
  | 'VMWARE_VM_HOST'
  | 'VMWARE_VM_GUEST'
  | 'NMS';

/**
 * Device entity
 */
export interface Device extends BaseEntity, TimestampFields {
  /** Parent organization ID */
  organizationId: number;
  /** Location ID */
  locationId?: number;
  /** Device node class */
  nodeClass?: DeviceNodeClass;
  /** Node role ID */
  nodeRoleId?: number;
  /** Policy ID */
  policyId?: number;
  /** Approval status */
  approvalStatus?: 'APPROVED' | 'PENDING' | 'REJECTED';
  /** Device status */
  status?: DeviceStatus;
  /** Display name */
  displayName?: string;
  /** System information */
  system?: DeviceSystem;
  /** OS information */
  os?: DeviceOS;
  /** Network interfaces */
  networkInterfaces?: DeviceNetworkInterface[];
  /** Last logged on user */
  lastLoggedOnUser?: DeviceLastUser;
  /** Last contact time */
  lastContact?: number;
  /** Agent version */
  agentVersion?: string;
  /** Custom fields */
  customFields?: CustomField[];
  /** Tags */
  tags?: string[];
  /** User data */
  userData?: Record<string, unknown>;
}

/**
 * Device list parameters
 */
export interface DeviceListParams extends BaseListParams {
  /**
   * NinjaOne device filter expression, e.g. "org = 12 AND class = WINDOWS_SERVER".
   * This is the only filter /v2/devices honours: organizationId, status and
   * nodeClass below apply to the organization-scoped and detailed endpoints.
   */
  df?: string;
  /** Pagination: highest device ID from the previous page. /v2/devices pages by ID, not cursor. */
  after?: number;
  /** Filter by organization ID */
  organizationId?: number;
  /** Filter by device status */
  status?: DeviceStatus;
  /** Filter by node class */
  nodeClass?: DeviceNodeClass;
  /** Filter by display name (partial match) */
  displayName?: string;
  /** Include system information */
  includeSystem?: boolean;
  /** Include OS information */
  includeOS?: boolean;
  /** Include network interfaces */
  includeNetworkInterfaces?: boolean;
}

/**
 * Device list response
 */
export interface DeviceListResponse {
  devices: Device[];
  cursor?: string;
}

/**
 * Device update data
 */
export interface DeviceUpdateData {
  /** Display name */
  displayName?: string;
  /** Node role ID */
  nodeRoleId?: number;
  /** Tags */
  tags?: string[];
  /** User data */
  userData?: Record<string, unknown>;
}

/**
 * Device activity types
 */
export type DeviceActivityType =
  | 'AGENT'
  | 'CLOUDBERRY'
  | 'PATCH_MANAGEMENT'
  | 'REMOTE_TOOLS'
  | 'SPLASHTOP'
  | 'SYSTEM'
  | 'TEAMVIEWER';

/**
 * Device activity
 */
export interface DeviceActivity {
  /** Activity ID */
  id: number;
  /** Device ID */
  deviceId: number;
  /** Activity type */
  type: DeviceActivityType;
  /** Activity status */
  status?: string;
  /** Activity message */
  message?: string;
  /** Source */
  source?: string;
  /** Timestamp */
  time: number;
  /** Severity */
  severity?: 'NONE' | 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL';
}

/**
 * Device activity list response
 */
export interface DeviceActivityListResponse {
  activities: DeviceActivity[];
  cursor?: string;
}

/**
 * One OS patch install record.
 *
 * Deliberately unpinned: NinjaOne's apidocs pages are JS-rendered and the
 * response schema could not be read from them, so records pass through
 * unshaped rather than being narrowed to guessed field names.
 */
export type OsPatchInstall = Record<string, unknown>;

/**
 * Filters for OS patch install queries.
 *
 * installedAfter and installedBefore are Unix epoch seconds. Tenant-wide
 * scoping goes through `df` (NinjaOne's device filter, e.g. 'org = 1'):
 * the /v2/queries/* endpoints have no organizationId parameter.
 */
export interface OsPatchInstallListParams {
  df?: string;
  status?: 'FAILED' | 'INSTALLED';
  installedAfter?: number;
  installedBefore?: number;
  cursor?: string;
  pageSize?: number;
}

/**
 * Device service
 */
export interface DeviceService {
  /** Service name */
  name: string;
  /** Display name */
  displayName?: string;
  /** Service state */
  state: 'RUNNING' | 'STOPPED' | 'PAUSED' | 'START_PENDING' | 'STOP_PENDING' | 'UNKNOWN';
  /** Start type */
  startType?: 'AUTO' | 'MANUAL' | 'DISABLED' | 'BOOT' | 'SYSTEM';
  /** Service account */
  serviceAccount?: string;
}

/**
 * Device software inventory item
 */
export interface DeviceSoftware {
  /** Software name */
  name: string;
  /** Publisher */
  publisher?: string;
  /** Version */
  version?: string;
  /** Install date */
  installDate?: number;
  /** Install location */
  installLocation?: string;
  /** Size in bytes */
  size?: number;
}

/**
 * Device processor information
 */
export interface DeviceProcessor {
  /** Name */
  name: string;
  /** Manufacturer */
  manufacturer?: string;
  /** Architecture */
  architecture?: string;
  /** Clock speed in MHz */
  clockSpeed?: number;
  /** Number of cores */
  cores?: number;
  /** Number of logical processors */
  logicalProcessors?: number;
}

/**
 * Device memory information
 */
export interface DeviceMemory {
  /** Total RAM in bytes */
  totalRam?: number;
  /** Available RAM in bytes */
  availableRam?: number;
  /** RAM usage percentage */
  usagePercent?: number;
}

/**
 * Device disk information
 */
export interface DeviceDisk {
  /** Disk name */
  name: string;
  /** Drive letter (Windows) */
  driveLetter?: string;
  /** Mount point (Linux/Mac) */
  mountPoint?: string;
  /** Total size in bytes */
  totalSize?: number;
  /** Free space in bytes */
  freeSpace?: number;
  /** File system type */
  fileSystem?: string;
}

/**
 * Device detailed hardware inventory
 */
export interface DeviceInventory {
  /** Processors */
  processors?: DeviceProcessor[];
  /** Memory */
  memory?: DeviceMemory;
  /** Disks */
  disks?: DeviceDisk[];
  /** Network adapters */
  networkAdapters?: DeviceNetworkInterface[];
}
