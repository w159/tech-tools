export * from './common.js';
import type { PaginationParams } from './common.js';

// Row shapes below are the live PortalAPI responses (instance h, 2026-09-01)
// trimmed to the fields callers rely on; every row carries more, so each type
// keeps an index signature rather than pretending to be exhaustive.

// ---------------------------------------------------------------------------
// Computer  (POST /Computer/ComputerGetByAllParameters, GET /Computer/ComputerGetForEditById)
// ---------------------------------------------------------------------------
export interface Computer {
  computerId: string;
  hostname: string;
  computerName?: string;
  username?: string;
  operatingSystem?: string;
  osType?: number;
  group?: string;
  groupName?: string;
  computerGroupId?: string;
  organization?: string;
  organizationName?: string;
  organizationId?: string;
  action?: string;
  mode?: string;
  lastCheckin?: string;
  lastCheckinIPAddress?: string;
  serviceVersion?: string;
  threatLockerVersion?: string;
  denyCountOneDay?: number;
  denyCountSevenDays?: number;
  isIsolated?: boolean;
  isLockedOut?: boolean;
  isLockDownMode?: boolean;
  totalRows?: number;
  [key: string]: unknown;
}

/** Body of ComputerGetByAllParameters (swagger ComputerParameterDto). */
export interface ComputerListParams extends PaginationParams {
  searchText?: string;
  /** Computer group GUID, not a name. */
  computerGroup?: string;
  /** One of: computername, group, action, lastcheckin, computerinstalldate, deniedcountthreedays, threatlockerversion. */
  orderBy?: string;
  isAscending?: boolean;
  childOrganizations?: boolean;
  action?: string;
  showLastCheckIn?: boolean;
  showDeleted?: boolean;
}

export interface ComputerCheckin {
  computerCheckinId: number;
  computerId: string;
  dateTime: string;
  ipAddress?: string;
  driverStatus?: number;
  tlVersion?: string;
  operatingSystem?: string;
  memoryUsage?: number;
  memoryUsageUnit?: string;
  [key: string]: unknown;
}

/** Body of ComputerCheckinGetByParameters (swagger ComputerCheckinParametersDto). */
export interface ComputerCheckinParams extends PaginationParams {
  computerId: string;
  hideHeartbeat?: boolean;
}

// ---------------------------------------------------------------------------
// Computer groups (GET /ComputerGroup/ComputerGroupGetDropdownByOrganizationId)
// ---------------------------------------------------------------------------
export interface ComputerGroupDropdownParams {
  /** 1 Windows, 2 Mac, 3 Linux, 5 Windows XP. */
  computerGroupOSTypeId?: number;
  computerOSType?: string;
  hideGlobals?: boolean;
}

// ---------------------------------------------------------------------------
// Approval requests (POST /ApprovalRequest/ApprovalRequestGetByParameters)
// ---------------------------------------------------------------------------
export interface ApprovalRequest {
  approvalRequestId: string;
  dateTime: string;
  hostname?: string;
  username?: string;
  path?: string;
  hash?: string | null;
  statusId: number;
  computerId?: string;
  organizationName?: string;
  organizationId?: string;
  requestor?: string;
  requestorReason?: string;
  requestorEmailAddress?: string;
  comments?: string;
  approvedBy?: string;
  actionDate?: string | null;
  ticketId?: string;
  [key: string]: unknown;
}

/** statusId values documented at threatlocker.kb.help/portalapiapprovalrequest/. */
export const APPROVAL_STATUS_IDS = {
  Pending: 1,
  Approved: 4,
  'Not Learned': 6,
  Rejected: 10,
  'Added to Application': 12,
  'Escalated from the Cyber Heroes': 13,
  'Self-Approved': 16,
} as const;

/** Body of ApprovalRequestGetByParameters (swagger ApprovalRequestParametersDto). */
export interface ApprovalRequestListParams extends PaginationParams {
  statusId?: number;
  searchText?: string;
  showChildOrganizations?: boolean;
  orderBy?: string;
  isAscending?: boolean;
}

export type PermitApplication = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Unified audit (POST /ActionLog/ActionLogGetByParametersV2, header usenewsearch: true)
// ---------------------------------------------------------------------------
export interface AuditLogEntry {
  eActionLogId: string;
  actionLogId?: number;
  sourceTableId?: number;
  dateTime: string;
  hostname?: string;
  username?: string;
  computerId?: string;
  organizationName?: string | null;
  action?: string;
  actionId?: number;
  actionType?: string;
  applicationName?: string;
  applicationId?: string;
  policyName?: string;
  policyId?: string;
  fullPath?: string;
  processPath?: string;
  hash?: string;
  sha256Hash?: string;
  [key: string]: unknown;
}

/**
 * Body of ActionLogGetByParametersV2 (swagger ActionLogParamsDto). There is no
 * free-text field. `hostname`, `actionType(s)` and `actionId` filter as
 * top-level fields; `username`, `fullPath`, `applicationName` and `policyName`
 * go through the Advanced Search list as exact matches (username tolerates a
 * partial). actionId 99 = "Any Deny" (documented), 1 = Permit.
 */
export interface AuditLogSearchParams extends PaginationParams {
  /** "YYYY-MM-DDTHH:MM:SSZ" (no milliseconds). */
  startDate: string;
  endDate: string;
  hostname?: string;
  username?: string;
  /** Exact full path as logged. */
  fullPath?: string;
  /** Exact application name as logged. */
  applicationName?: string;
  /** Exact policy name as logged. */
  policyName?: string;
  actionType?: string;
  actionTypes?: string[];
  actionId?: number;
  showChildOrganizations?: boolean;
  sortDescending?: boolean;
}

export interface AuditFileHistoryParams extends PaginationParams {
  fullPath: string;
  hostname?: string;
  computerId?: string;
  sourceTableId?: number;
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------
export interface Organization {
  organizationId?: string;
  organizationName?: string;
  name?: string;
  [key: string]: unknown;
}

/** Body of OrganizationGetChildOrganizationsByParameters (KB only; not in the public swagger). */
export interface OrganizationListParams extends PaginationParams {
  searchText?: string;
  orderBy?: string;
  isAscending?: boolean;
  includeAllChildren?: boolean;
}

export type AuthKey = Record<string, unknown> | string;
