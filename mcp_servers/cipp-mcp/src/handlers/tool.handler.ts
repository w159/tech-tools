// CIPP Tool Handler
// Dispatches MCP tool calls to the correct CippService method.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { CippService } from '../services/cipp.service.js';
import { Logger } from '../utils/logger.js';
import { TOOL_DEFINITIONS } from '../mcp/tool.definitions.js';
import {
  shapeList,
  shapeItem,
  shapeRaw,
  extractShapeArgs,
  type SummaryFn,
  type ToolResult,
} from '../_shared/response-shaper.js';
import {
  toolErrorFromCatch,
  missingCredsError,
} from '../_shared/error-envelope.js';

// ---------------------------------------------------------------------------
// Per-resource compact summary functions
// Each omits audit noise, raw GUID arrays, and fields rarely needed at a glance.
// ---------------------------------------------------------------------------

const tenantSummary: SummaryFn = (t) => ({
  id: t['id'] ?? t['customerId'],
  displayName: t['displayName'] ?? t['name'],
  defaultDomainName: t['defaultDomainName'],
  status: t['status'] ?? t['tenantStatus'],
});

const userSummary: SummaryFn = (u) => ({
  id: u['id'],
  userPrincipalName: u['userPrincipalName'],
  displayName: u['displayName'],
  accountEnabled: u['accountEnabled'],
});

const mfaUserSummary: SummaryFn = (u) => ({
  id: u['id'],
  userPrincipalName: u['userPrincipalName'],
  displayName: u['displayName'],
  isMFARegistered: u['isMFARegistered'] ?? u['MFARegistered'],
});

const deviceSummary: SummaryFn = (d) => ({
  id: d['id'],
  displayName: d['displayName'],
  operatingSystem: d['operatingSystem'],
  complianceState: d['complianceState'],
});

const groupSummary: SummaryFn = (g) => ({
  id: g['id'],
  displayName: g['displayName'],
  groupType: g['groupType'] ?? g['groupTypes'],
  mailEnabled: g['mailEnabled'],
});

const mailboxSummary: SummaryFn = (m) => ({
  id: m['id'],
  displayName: m['displayName'],
  primarySmtpAddress: m['primarySmtpAddress'],
  recipientTypeDetails: m['recipientTypeDetails'],
});

const caPolicySummary: SummaryFn = (p) => ({
  id: p['id'],
  displayName: p['displayName'],
  state: p['state'],
  conditions: p['conditions'],
});

const namedLocationSummary: SummaryFn = (l) => ({
  id: l['id'],
  displayName: l['displayName'],
  isTrusted: l['isTrusted'],
});

const standardSummary: SummaryFn = (s) => ({
  displayName: s['displayName'] ?? s['standard'],
  remediationAction: s['remediationAction'],
  lastRunResult: s['lastRunResult'] ?? s['result'],
});

const templateSummary: SummaryFn = (t) => ({
  id: t['id'] ?? t['GUID'],
  displayName: t['displayName'] ?? t['templateName'],
  tenantFilter: t['tenantFilter'],
});

const driftSummary: SummaryFn = (d) => ({
  tenantName: d['tenantName'] ?? d['tenant'],
  standard: d['standard'],
  currentValue: d['currentValue'],
  expectedValue: d['expectedValue'],
});

const alignmentSummary: SummaryFn = (a) => ({
  tenantName: a['tenantName'] ?? a['tenant'],
  alignmentPercent: a['alignmentPercent'] ?? a['alignment'],
  templateName: a['templateName'],
});

const bpaSummary: SummaryFn = (b) => ({
  checkName: b['checkName'] ?? b['name'],
  result: b['result'] ?? b['value'],
  severity: b['severity'],
});

const domainHealthSummary: SummaryFn = (d) => ({
  domain: d['domain'],
  spf: (d['spf'] as Record<string, unknown> | undefined)?.['result'] ?? d['spf'],
  dmarc: (d['dmarc'] as Record<string, unknown> | undefined)?.['result'] ?? d['dmarc'],
  dkim: (d['dkim'] as Record<string, unknown> | undefined)?.['result'] ?? d['dkim'],
});

const licenseSummary: SummaryFn = (l) => ({
  id: l['id'] ?? l['skuId'],
  skuPartNumber: l['skuPartNumber'],
  assignedUnits: l['assignedUnits'] ?? (l['consumedUnits']),
  availableUnits: l['availableUnits'] ?? (
    typeof l['prepaidUnits'] === 'object' && l['prepaidUnits'] !== null
      ? (l['prepaidUnits'] as Record<string, unknown>)['enabled']
      : undefined
  ),
});

const cspLicenseSummary: SummaryFn = (l) => ({
  tenantName: l['tenantName'] ?? l['tenant'],
  skuPartNumber: l['skuPartNumber'] ?? l['sku'],
  quantity: l['quantity'] ?? l['totalLicenses'],
});

const auditLogSummary: SummaryFn = (e) => ({
  creationTime: e['creationTime'] ?? e['CreationTime'],
  operation: e['operation'] ?? e['Operation'],
  userId: e['userId'] ?? e['UserId'],
  result: e['result'] ?? e['ResultStatus'],
});

const alertSummary: SummaryFn = (a) => ({
  id: a['id'],
  tenantName: a['tenantName'] ?? a['tenant'],
  alertType: a['alertType'] ?? a['type'],
  severity: a['severity'],
  createdAt: a['createdAt'] ?? a['timestamp'],
});

const gdapRoleSummary: SummaryFn = (r) => ({
  id: r['id'],
  displayName: r['displayName'],
  description: r['description'],
});

const gdapInviteSummary: SummaryFn = (i) => ({
  id: i['id'],
  tenantName: i['tenantName'] ?? i['tenant'],
  status: i['status'],
  createdAt: i['createdAt'] ?? i['inviteDate'],
});

const scheduledItemSummary: SummaryFn = (s) => ({
  taskName: s['taskName'] ?? s['name'],
  command: s['command'],
  nextRunTime: s['nextRunTime'] ?? s['scheduledTime'],
  tenantFilter: s['tenantFilter'],
});

const logSummary: SummaryFn = (l) => ({
  timestamp: l['timestamp'] ?? l['date'],
  level: l['level'] ?? l['severity'],
  message: l['message'],
});

// ---------------------------------------------------------------------------

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export class CippToolHandler {
  private cippService: CippService;
  private logger: Logger;
  private mcpServer: Server | null = null;

  constructor(cippService: CippService, logger: Logger) {
    this.cippService = cippService;
    this.logger = logger;
  }

  setServer(server: Server): void {
    this.mcpServer = server;
  }

  getServer(): Server | null {
    return this.mcpServer;
  }

  getToolDefinitions() {
    return TOOL_DEFINITIONS;
  }

  async handleToolCall(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    this.logger.debug(`Dispatching tool call: ${name}`, { args });

    // cipp_status never touches the network and must not throw even with missing creds.
    if (name === 'cipp_status') {
      return this.handleStatus();
    }

    try {
      const shapeArgs = extractShapeArgs(args);
      let result: ToolResult;

      switch (name) {
        // -----------------------------------------------------------------------
        // Tenants
        // -----------------------------------------------------------------------
        case 'cipp_list_tenants': {
          const { allTenants } = args as { allTenants?: boolean };
          const data = await this.cippService.listTenants({ allTenants });
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            tenantSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_get_tenant_details': {
          const { tenantFilter } = args as { tenantFilter: string };
          const data = await this.cippService.getTenantDetails(tenantFilter);
          result = shapeItem(
            data as Record<string, unknown>,
            tenantSummary,
            shapeArgs
          );
          break;
        }

        // -----------------------------------------------------------------------
        // Users
        // -----------------------------------------------------------------------
        case 'cipp_list_users': {
          const { tenantFilter, searchField, searchValue } = args as {
            tenantFilter: string;
            searchField?: string;
            searchValue?: string;
          };
          const data = await this.cippService.listUsers(tenantFilter, { searchField, searchValue });
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            userSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_create_user': {
          const {
            tenantFilter,
            displayName,
            userPrincipalName,
            password,
            givenName,
            surname,
            jobTitle,
            department,
            country,
          } = args as {
            tenantFilter: string;
            displayName: string;
            userPrincipalName: string;
            password: string;
            givenName?: string;
            surname?: string;
            jobTitle?: string;
            department?: string;
            country?: string;
          };
          const userData: Record<string, unknown> = {
            displayName,
            userPrincipalName,
            password,
          };
          if (givenName !== undefined) userData['givenName'] = givenName;
          if (surname !== undefined) userData['surname'] = surname;
          if (jobTitle !== undefined) userData['jobTitle'] = jobTitle;
          if (department !== undefined) userData['department'] = department;
          if (country !== undefined) userData['country'] = country;
          const data = await this.cippService.createUser(tenantFilter, userData);
          result = shapeRaw(data);
          break;
        }

        case 'cipp_edit_user': {
          const {
            tenantFilter,
            userId,
            displayName,
            jobTitle,
            department,
            usageLocation,
          } = args as {
            tenantFilter: string;
            userId: string;
            displayName?: string;
            jobTitle?: string;
            department?: string;
            usageLocation?: string;
          };
          const editData: Record<string, unknown> = {};
          if (displayName !== undefined) editData['displayName'] = displayName;
          if (jobTitle !== undefined) editData['jobTitle'] = jobTitle;
          if (department !== undefined) editData['department'] = department;
          if (usageLocation !== undefined) editData['usageLocation'] = usageLocation;
          const data = await this.cippService.editUser(tenantFilter, userId, editData);
          result = shapeRaw(data);
          break;
        }

        case 'cipp_disable_user': {
          const { tenantFilter, userId } = args as { tenantFilter: string; userId: string };
          const data = await this.cippService.disableUser(tenantFilter, userId);
          result = shapeRaw(data);
          break;
        }

        case 'cipp_reset_password': {
          const { tenantFilter, userId, newPassword } = args as {
            tenantFilter: string;
            userId: string;
            newPassword?: string;
          };
          const data = await this.cippService.resetPassword(tenantFilter, userId, newPassword);
          result = shapeRaw(data);
          break;
        }

        case 'cipp_reset_mfa': {
          const { tenantFilter, userId } = args as { tenantFilter: string; userId: string };
          const data = await this.cippService.resetMFA(tenantFilter, userId);
          result = shapeRaw(data);
          break;
        }

        case 'cipp_revoke_sessions': {
          const { tenantFilter, userId } = args as { tenantFilter: string; userId: string };
          const data = await this.cippService.revokeSessions(tenantFilter, userId);
          result = shapeRaw(data);
          break;
        }

        case 'cipp_offboard_user': {
          const {
            tenantFilter,
            userId,
            revokePermissions,
            disableUser,
            resetPassword,
            transferMailbox,
          } = args as {
            tenantFilter: string;
            userId: string;
            revokePermissions?: boolean;
            disableUser?: boolean;
            resetPassword?: boolean;
            transferMailbox?: string;
          };
          const offboardOptions: Record<string, unknown> = {};
          if (revokePermissions !== undefined) offboardOptions['revokePermissions'] = revokePermissions;
          if (disableUser !== undefined) offboardOptions['disableUser'] = disableUser;
          if (resetPassword !== undefined) offboardOptions['resetPassword'] = resetPassword;
          if (transferMailbox !== undefined) offboardOptions['transferMailbox'] = transferMailbox;
          const data = await this.cippService.offboardUser(tenantFilter, userId, offboardOptions);
          result = shapeRaw(data);
          break;
        }

        case 'cipp_bec_check': {
          const { tenantFilter, userId } = args as { tenantFilter: string; userId: string };
          const data = await this.cippService.becCheck(tenantFilter, userId);
          result = shapeItem(
            data as Record<string, unknown>,
            undefined,
            shapeArgs
          );
          break;
        }

        case 'cipp_list_mfa_users': {
          const { tenantFilter } = args as { tenantFilter: string };
          const data = await this.cippService.listMfaUsers(tenantFilter);
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            mfaUserSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_list_user_devices': {
          const { tenantFilter, userId } = args as { tenantFilter: string; userId: string };
          const data = await this.cippService.listUserDevices(tenantFilter, userId);
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            deviceSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_list_user_groups': {
          const { tenantFilter, userId } = args as { tenantFilter: string; userId: string };
          const data = await this.cippService.listUserGroups(tenantFilter, userId);
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            groupSummary,
            shapeArgs
          );
          break;
        }

        // -----------------------------------------------------------------------
        // Groups
        // -----------------------------------------------------------------------
        case 'cipp_list_groups': {
          const { tenantFilter, search } = args as { tenantFilter: string; search?: string };
          const data = await this.cippService.listGroups(tenantFilter, { search });
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            groupSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_create_group': {
          const {
            tenantFilter,
            displayName,
            description,
            securityEnabled,
            mailEnabled,
            mailNickname,
          } = args as {
            tenantFilter: string;
            displayName: string;
            description?: string;
            securityEnabled?: boolean;
            mailEnabled?: boolean;
            mailNickname?: string;
          };
          const groupData: Record<string, unknown> = { displayName };
          if (description !== undefined) groupData['description'] = description;
          if (securityEnabled !== undefined) groupData['securityEnabled'] = securityEnabled;
          if (mailEnabled !== undefined) groupData['mailEnabled'] = mailEnabled;
          if (mailNickname !== undefined) groupData['mailNickname'] = mailNickname;
          const data = await this.cippService.createGroup(tenantFilter, groupData);
          result = shapeRaw(data);
          break;
        }

        // -----------------------------------------------------------------------
        // Mailboxes
        // -----------------------------------------------------------------------
        case 'cipp_list_mailboxes': {
          const { tenantFilter, type } = args as { tenantFilter: string; type?: string };
          const data = await this.cippService.listMailboxes(tenantFilter, { type });
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            mailboxSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_list_mailbox_permissions': {
          const { tenantFilter, upn } = args as { tenantFilter: string; upn: string };
          const data = await this.cippService.listMailboxPermissions(tenantFilter, upn);
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            undefined,
            shapeArgs
          );
          break;
        }

        case 'cipp_set_out_of_office': {
          const { tenantFilter, upn, enabled, internalMessage, externalMessage } = args as {
            tenantFilter: string;
            upn: string;
            enabled: boolean;
            internalMessage?: string;
            externalMessage?: string;
          };
          const oooData: Record<string, unknown> = { enabled };
          if (internalMessage !== undefined) oooData['internalMessage'] = internalMessage;
          if (externalMessage !== undefined) oooData['externalMessage'] = externalMessage;
          const data = await this.cippService.setOutOfOffice(tenantFilter, upn, oooData);
          result = shapeRaw(data);
          break;
        }

        case 'cipp_set_email_forwarding': {
          const { tenantFilter, upn, forwardTo, keepCopy } = args as {
            tenantFilter: string;
            upn: string;
            forwardTo?: string;
            keepCopy?: boolean;
          };
          const forwardData: Record<string, unknown> = {};
          if (forwardTo !== undefined) forwardData['forwardTo'] = forwardTo;
          if (keepCopy !== undefined) forwardData['keepCopy'] = keepCopy;
          const data = await this.cippService.setEmailForwarding(tenantFilter, upn, forwardData);
          result = shapeRaw(data);
          break;
        }

        // -----------------------------------------------------------------------
        // Security
        // -----------------------------------------------------------------------
        case 'cipp_list_conditional_access_policies': {
          const { tenantFilter } = args as { tenantFilter: string };
          const data = await this.cippService.listConditionalAccessPolicies(tenantFilter);
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            caPolicySummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_list_named_locations': {
          const { tenantFilter } = args as { tenantFilter: string };
          const data = await this.cippService.listNamedLocations(tenantFilter);
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            namedLocationSummary,
            shapeArgs
          );
          break;
        }

        // -----------------------------------------------------------------------
        // Standards
        // -----------------------------------------------------------------------
        case 'cipp_list_standards': {
          const { tenantFilter } = args as { tenantFilter: string };
          const data = await this.cippService.listStandards(tenantFilter);
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            standardSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_run_standards_check': {
          const { tenantFilter } = args as { tenantFilter: string };
          const data = await this.cippService.runStandardsCheck(tenantFilter);
          result = shapeRaw(data);
          break;
        }

        case 'cipp_list_standard_templates': {
          const data = await this.cippService.listStandardTemplates();
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            templateSummary,
            shapeArgs
          );
          break;
        }

        // `tenantFilter` is optional for these two tools: omit it to report
        // across all tenants. This diverges intentionally from other Standards
        // cases that require it.
        case 'cipp_get_tenant_drift': {
          const { tenantFilter } = args as { tenantFilter?: string };
          const data = await this.cippService.getTenantDrift(tenantFilter);
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            driftSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_get_tenant_alignment': {
          const { tenantFilter } = args as { tenantFilter?: string };
          const data = await this.cippService.getTenantAlignment(tenantFilter);
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            alignmentSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_create_standard_template': {
          const { template } = args as { template: Record<string, unknown> };
          const data = await this.cippService.createStandardTemplate(template);
          result = shapeRaw(data);
          break;
        }

        case 'cipp_delete_standard_template': {
          const { templateId } = args as { templateId: string };
          const data = await this.cippService.deleteStandardTemplate(templateId);
          result = shapeRaw(data);
          break;
        }

        case 'cipp_list_bpa': {
          const { tenantFilter } = args as { tenantFilter: string };
          const data = await this.cippService.listBPA(tenantFilter);
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            bpaSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_list_domain_health': {
          const { tenantFilter } = args as { tenantFilter: string };
          const data = await this.cippService.listDomainHealth(tenantFilter);
          result = shapeList(
            Array.isArray(data) ? data as unknown as Record<string, unknown>[] : [],
            domainHealthSummary,
            shapeArgs
          );
          break;
        }

        // -----------------------------------------------------------------------
        // Licenses
        // -----------------------------------------------------------------------
        case 'cipp_list_licenses': {
          const { tenantFilter } = args as { tenantFilter: string };
          const data = await this.cippService.listLicenses(tenantFilter);
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            licenseSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_list_csp_licenses': {
          const data = await this.cippService.listCSPLicenses();
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            cspLicenseSummary,
            shapeArgs
          );
          break;
        }

        // -----------------------------------------------------------------------
        // Alerts
        // -----------------------------------------------------------------------
        case 'cipp_list_audit_logs': {
          const { tenantFilter, days, type } = args as {
            tenantFilter: string;
            days?: number;
            type?: string;
          };
          const data = await this.cippService.listAuditLogs(tenantFilter, {
            Days: days,
            Type: type,
          });
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            auditLogSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_list_alert_queue': {
          const data = await this.cippService.listAlertQueue();
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            alertSummary,
            shapeArgs
          );
          break;
        }

        // -----------------------------------------------------------------------
        // GDAP
        // -----------------------------------------------------------------------
        case 'cipp_list_gdap_roles': {
          const data = await this.cippService.listGDAPRoles();
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            gdapRoleSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_list_gdap_invites': {
          const data = await this.cippService.listGDAPInvites();
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            gdapInviteSummary,
            shapeArgs
          );
          break;
        }

        // -----------------------------------------------------------------------
        // Scheduler
        // -----------------------------------------------------------------------
        case 'cipp_list_scheduled_items': {
          const data = await this.cippService.listScheduledItems();
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            scheduledItemSummary,
            shapeArgs
          );
          break;
        }

        case 'cipp_add_scheduled_item': {
          const { taskName, command, scheduledTime, recurrence, tenantFilter } = args as {
            taskName: string;
            command: string;
            scheduledTime: string;
            recurrence?: string;
            tenantFilter?: string;
          };
          const itemData: Record<string, unknown> = {
            taskName,
            command,
            scheduledTime,
          };
          if (recurrence !== undefined) itemData['recurrence'] = recurrence;
          if (tenantFilter !== undefined) itemData['tenantFilter'] = tenantFilter;
          const data = await this.cippService.addScheduledItem(itemData);
          result = shapeRaw(data);
          break;
        }

        // -----------------------------------------------------------------------
        // Core
        // -----------------------------------------------------------------------
        case 'cipp_ping': {
          const data = await this.cippService.ping();
          result = shapeRaw(data);
          break;
        }

        case 'cipp_get_version': {
          const data = await this.cippService.getVersion();
          result = shapeRaw(data);
          break;
        }

        case 'cipp_list_logs': {
          const { dateFilter } = args as { dateFilter?: string };
          const data = await this.cippService.listLogs(
            dateFilter !== undefined ? { DateFilter: dateFilter } : undefined
          );
          result = shapeList(
            Array.isArray(data) ? data as Record<string, unknown>[] : [],
            logSummary,
            shapeArgs
          );
          break;
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }

      return result as McpToolResult;
    } catch (error) {
      if (error instanceof McpError && error.code === ErrorCode.MethodNotFound) {
        // Unknown tool — propagate as protocol error so client knows the tool doesn't exist
        throw error;
      }
      this.logger.error(`Tool call failed: ${name}`, { error });

      // Use toolErrorFromCatch for structured, actionable error output.
      // For CIPP-specific HTTP errors (statusCode on the thrown Error), we need
      // to normalise to the .status shape that toolErrorFromCatch recognises.
      const normalised = normaliseForEnvelope(error);
      return toolErrorFromCatch(name, normalised, {
        hint: buildCippHint(error),
      }) as McpToolResult;
    }
  }

  // ---------------------------------------------------------------------------
  // cipp_status — always succeeds, never calls the network.
  // ---------------------------------------------------------------------------

  private handleStatus(): McpToolResult {
    const baseUrl =
      process.env['CIPP_BASE_URL'] ??
      process.env['CIPP_URL'] ??
      process.env['CIPP_API_URL'];

    const hasBaseUrl = !!baseUrl;
    const hasApiKey = !!(process.env['CIPP_API_KEY']);
    const hasClientId = !!(process.env['CIPP_CLIENT_ID']);
    const hasClientSecret = !!(process.env['CIPP_CLIENT_SECRET']);
    const hasTenantId = !!(process.env['CIPP_TENANT_ID']);
    const hasOAuth = hasClientId && hasClientSecret && hasTenantId;

    if (!hasBaseUrl) {
      return missingCredsError('CIPP', ['CIPP_BASE_URL']) as McpToolResult;
    }
    if (!hasApiKey && !hasOAuth) {
      return missingCredsError('CIPP', [
        'CIPP_API_KEY (static Bearer token)',
        'OR: CIPP_TENANT_ID + CIPP_CLIENT_ID + CIPP_CLIENT_SECRET (OAuth client-credentials)',
      ]) as McpToolResult;
    }

    const status = {
      configured: true,
      cippBaseUrl: baseUrl,
      authMode: hasApiKey ? 'api_key' : 'oauth_client_credentials',
      hint: 'Credentials appear configured. Call cipp_ping to verify live connectivity.',
      credentials: {
        CIPP_BASE_URL: 'set — your CIPP instance URL',
        CIPP_API_KEY: hasApiKey ? 'set' : 'not set (using OAuth)',
        CIPP_CLIENT_ID: hasClientId ? 'set' : 'not set',
        CIPP_CLIENT_SECRET: hasClientSecret ? 'set' : 'not set',
        CIPP_TENANT_ID: hasTenantId ? 'set' : 'not set',
        CIPP_TOKEN_SCOPE: process.env['CIPP_TOKEN_SCOPE'] ? 'set' : 'not set (optional)',
      },
    };

    return shapeRaw(status) as McpToolResult;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * CIPP's service throws errors with .statusCode rather than .status.
 * toolErrorFromCatch checks for .status (number), so normalise the shape.
 */
function normaliseForEnvelope(err: unknown): unknown {
  if (
    err !== null &&
    typeof err === 'object' &&
    'statusCode' in err &&
    typeof (err as Record<string, unknown>)['statusCode'] === 'number' &&
    !('status' in err)
  ) {
    // Shallow-clone and alias statusCode -> status so classifyError picks it up.
    return Object.assign(
      Object.create(Object.getPrototypeOf(err)),
      err,
      { status: (err as Record<string, unknown>)['statusCode'] }
    );
  }
  return err;
}

/**
 * Build a CIPP-specific remediation hint based on the HTTP status code.
 */
function buildCippHint(err: unknown): string {
  const statusCode =
    (err as any)?.statusCode ??
    (err as any)?.status ??
    (err as any)?.response?.status;

  if (statusCode === 401 || statusCode === 403) {
    return (
      'Verify CIPP_BASE_URL is correct and authentication is valid: ' +
      'either CIPP_API_KEY, or OAuth values ' +
      'CIPP_TENANT_ID + CIPP_CLIENT_ID + CIPP_CLIENT_SECRET ' +
      '(optionally CIPP_TOKEN_SCOPE). ' +
      'The caller account may also lack the required GDAP/RBAC role in CIPP.'
    );
  }
  if (statusCode === 404) {
    return 'The requested resource was not found. Verify the tenantFilter and resource IDs are correct.';
  }
  return 'Check that CIPP is reachable at CIPP_BASE_URL and your credentials are valid. Call cipp_status for a config summary.';
}
