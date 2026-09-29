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

// ---------------------------------------------------------------------------
// Policies (Application Control) — POST /Policy/PolicyGetByParameters
// Source: https://threatlocker.kb.help/portalapipolicy/
// ---------------------------------------------------------------------------
export interface Policy {
 policyId: string;
 name: string;
 description?: string;
 computerGroupId?: string;
 organizationId?: string;
 isEnabled?: boolean;
 /** 1 Permit, 2 Deny, 6 Permit with Ringfencing. */
 policyActionId?: number;
 osType?: number;
 orderBy?: number;
 applicationIdList?: string[];
 applicationList?: unknown[];
 monitorMode?: boolean;
 lastMatchDateTime?: string | null;
 neverExpires?: boolean;
 endDate?: string | null;
 totalRows?: number;
 [key: string]: unknown;
}

/** Body of PolicyGetByParameters. `filter`: '', nomatch, match, oversixweeks,
 *  ringfence, noringfence, elevation, permitonly, inherit, monitor, secured. */
export interface PolicyListParams extends PaginationParams {
 computerGroupId?: string;
 filter?: string;
 activeOnly?: boolean;
 /** All=0, Windows=1, MAC=2, Linux=3, WindowsXP=5. */
 osType?: number;
 searchText?: string;
 showAllPolicies?: boolean;
}

// ---------------------------------------------------------------------------
// Applications (Application Control) — POST /Application/ApplicationGetByParameters
// Source: https://threatlocker.kb.help/portalapiapplication/
// ---------------------------------------------------------------------------
export interface Application {
 applicationId: string;
 name: string;
 description?: string;
 category?: number | string;
 status?: number | string;
 osType?: number;
 appVer?: string;
 policyCount?: number;
 createdDate?: string;
 totalRows?: number;
 [key: string]: unknown;
}

/** Body of ApplicationGetByParameters. orderBy: name, date-created,
 *  review-rating, computer-count, policy. searchBy: app, full, process, hash,
 *  cert, created, categories, countries. category: 0 All, 1 My(Custom),
 *  2 Built-In, 4 Patch Supported. */
export interface ApplicationListParams extends PaginationParams {
 orderBy?: string;
 searchBy?: string;
 category?: number;
 countries?: unknown;
 categories?: unknown;
 includeChildOrganizations?: boolean;
 isAscending?: boolean;
 isHidden?: boolean;
 osType?: number;
 permittedApplications?: unknown;
 searchText?: string;
}

// ---------------------------------------------------------------------------
// Config Manager (device configurations)
// Sources: https://threatlocker.kb.help/portalapicmconfiguration/ and
// https://threatlocker.kb.help/portalapicmpolicy/
// ---------------------------------------------------------------------------
export interface CMConfigurationCheck {
 value?: number;
 name?: string;
 description?: string;
 category?: string | number;
 [key: string]: unknown;
}

export interface CMPolicy {
 cMPolicyId?: string;
 name?: string;
 description?: string;
 /** Integer id from CMConfigurationGetWithCategoryByIsEnabled. */
 value?: number;
 /** Org/group/computer GUID the policy applies to. */
 appliesTo?: string;
 /** NotConfigured=-1, Disabled=0, Enabled=1, All=99. */
 status?: number;
 category?: string | number;
 [key: string]: unknown;
}

/** Body of CMPolicyGetbyParameters. */
export interface CMPolicyListParams extends PaginationParams {
 appliesTo?: string;
 status?: number;
 searchText?: string;
}

// ---------------------------------------------------------------------------
// DAC (Defense Against Configurations health analysis)
// Source: https://threatlocker.kb.help/portalapidadalysisresult/
// The PortalAPI has no list/get endpoint for raw Storage Control policies;
// these are the closest available read surfaces for storage-control posture.
// ---------------------------------------------------------------------------
export interface DacResult {
 analysisItemId?: number;
 categoryId?: number;
 criticalityId?: number;
 entityTypeId?: number;
 appliesToId?: string;
 [key: string]: unknown;
}

/** Body of DACAnalysisResultsGetByParameters. categoryId: NetworkPolicy=1,
 *  StoragePolicy=2, ApplicationControl=3, RegistryPolicy=4, GroupPolicy=6,
 *  AccountAndAuthentication=7, AdvancedAuditConfiguration=8, LocalSecurity=9,
 *  PatchManagement=10, RemoteDesktopAndAccessControl=11, UserRightsAssignment=12,
 *  DetectAndResponse=13. criticalityId: Low=1, Moderate=2, High=3, Critical=4.
 *  entityTypeId: organization=1, computerGroup=2, computer=3. */
export interface DacResultListParams extends PaginationParams {
 appliesToId?: string;
 categoryId?: number;
 criticalityId?: number;
 entityTypeId?: number;
 includeChildOrgs?: boolean;
 searchText?: string;
 /** category | combined-impact | criticality. */
 sortBy?: string;
}

export interface DacAnalysisItem {
 analysisItemId?: number;
 [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// System Audit (portal administrator/login audit trail)
// Source: https://threatlocker.kb.help/portalapisystemaudit/
// ---------------------------------------------------------------------------
export interface SystemAuditEntry {
 systemAuditId?: string;
 dateTime?: string;
 action?: string;
 details?: string;
 emailAddress?: string;
 iPAddress?: string;
 effectiveAction?: string;
 [key: string]: unknown;
}

/** Body of SystemAuditGetByParameters. `actions`: Create, Delete, Logon,
 *  Modify, Read. effectiveAction: Denied | Permitted. */
export interface SystemAuditSearchParams extends PaginationParams {
 startDate: string | Date;
 endDate: string | Date;
 actions?: string[];
 details?: string;
 effectiveAction?: string;
 emailAddress?: string;
 iPAddress?: string;
 objectId?: string;
 viewChildOrganizations?: boolean;
}
