// CIPP MCP Tool Definitions
// Defines every MCP tool the CIPP MCP server exposes, including name,
// description, and JSON Schema for input validation.

import { SHAPE_PROPS } from '../_shared/response-shaper.js';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * A single MCP tool definition as required by the MCP protocol.
 */
export interface McpToolDefinition {
  /** Unique, snake_case identifier for the tool. */
  name: string;
  /** Human-readable description surfaced to MCP clients and LLM tool-selectors. */
  description: string;
  /** JSON Schema (object type) describing the tool's accepted input parameters. */
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  /** Optional annotations providing hints about the tool's behavior. */
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Shared property snippets (reused across tools)
// ---------------------------------------------------------------------------

const TENANT_FILTER_PROP = {
  type: 'string',
  description:
    "Tenant domain name or ID to scope the operation. Use 'allTenants' to target every managed tenant.",
};

const USER_ID_PROP = {
  type: 'string',
  description:
    "The target user's Azure AD object ID or User Principal Name (UPN, e.g. alice@contoso.com).",
};

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS: McpToolDefinition[] = [
  // -------------------------------------------------------------------------
  // Tenant tools
  // -------------------------------------------------------------------------
  {
    name: 'cipp_list_tenants',
    description: 'List all M365 tenants managed in CIPP. Returns tenant domain names and IDs needed as tenantFilter for every other CIPP tool.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        allTenants: {
          type: 'boolean',
          description:
            'When true, forces retrieval of every managed tenant regardless of any default filter.',
        },
      },
    },
  },
  {
    name: 'cipp_get_tenant_details',
    description: 'Get detailed M365 tenant information (domain, Entra tenant ID, licence counts) for a specific tenant (tenantFilter required).',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: {
          type: 'string',
          description: "Tenant domain name or ID, use 'allTenants' for all",
        },
      },
      required: ['tenantFilter'],
    },
  },

  // -------------------------------------------------------------------------
  // User tools
  // -------------------------------------------------------------------------
  {
    name: 'cipp_list_users',
    description: 'List M365 users in a tenant (tenantFilter required); optionally search by displayName, userPrincipalName, or mail. Default summary: id, userPrincipalName, displayName, accountEnabled.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
        searchField: {
          type: 'string',
          enum: ['displayName', 'userPrincipalName', 'mail'],
          description:
            'The user attribute to search on. Must be provided together with searchValue.',
        },
        searchValue: {
          type: 'string',
          description:
            'Value to match against the chosen searchField. Supports partial string matching.',
        },
      },
      required: ['tenantFilter'],
    },
  },
  {
    name: 'cipp_create_user',
    description:
      'VISIBLE-TO-OTHERS: Create a new user account in the tenant. Grants ' +
      'directory presence and may include initial credentials and license/role ' +
      'eligibility; the new account becomes visible to tenant admins and the ' +
      'global address list. Reversible by deleting or disabling the user. ' +
      'Confirm with the user before invoking. Returns the CIPP create result.',
    annotations: {
      title: 'Create user (high-impact)',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tenantFilter: TENANT_FILTER_PROP,
        displayName: {
          type: 'string',
          description:
            "The user's full display name as it will appear in the directory (e.g. 'Alice Smith').",
        },
        userPrincipalName: {
          type: 'string',
          description:
            "The user's sign-in address / UPN (e.g. alice@contoso.com). Must be unique within the tenant.",
        },
        password: {
          type: 'string',
          description:
            'Initial password for the account. Should meet the tenant password complexity policy.',
        },
        givenName: {
          type: 'string',
          description: "The user's first (given) name.",
        },
        surname: {
          type: 'string',
          description: "The user's last name (surname).",
        },
        jobTitle: {
          type: 'string',
          description: "The user's job title as it appears in the directory.",
        },
        department: {
          type: 'string',
          description: 'The department the user belongs to.',
        },
        country: {
          type: 'string',
          description:
            "Two-letter ISO 3166-1 alpha-2 country code representing the user's location (e.g. 'US', 'GB').",
        },
      },
      required: ['tenantFilter', 'displayName', 'userPrincipalName', 'password'],
    },
  },
  {
    name: 'cipp_edit_user',
    description:
      "DESTRUCTIVE: Edit an existing user's properties, which can include " +
      'directory attributes, usage location, and may grant or revoke roles or ' +
      'license eligibility. Reversible by editing again. ' +
      'Confirm with the user before invoking. Returns the CIPP edit result.',
    annotations: {
      title: 'Edit user (high-impact)',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tenantFilter: TENANT_FILTER_PROP,
        userId: {
          type: 'string',
          description: "The user's Azure AD object ID or UPN to identify the account to modify.",
        },
        displayName: {
          type: 'string',
          description: 'Updated full display name for the user.',
        },
        jobTitle: {
          type: 'string',
          description: 'Updated job title for the user.',
        },
        department: {
          type: 'string',
          description: 'Updated department for the user.',
        },
        usageLocation: {
          type: 'string',
          description:
            "Two-letter ISO 3166-1 alpha-2 country code for license assignment eligibility (e.g. 'US'). Required before assigning most Microsoft 365 licences.",
        },
      },
      required: ['tenantFilter', 'userId'],
    },
  },
  {
    name: 'cipp_disable_user',
    description:
      'DESTRUCTIVE: Disable a user account, blocking sign-in. Reversible by ' +
      're-enabling the account. Confirm with the user before invoking. ' +
      'Returns the CIPP action result.',
    annotations: {
      title: 'Disable user (reversible)',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tenantFilter: TENANT_FILTER_PROP,
        userId: USER_ID_PROP,
      },
      required: ['tenantFilter', 'userId'],
    },
  },
  {
    name: 'cipp_reset_password',
    description:
      "DESTRUCTIVE: Reset a user's password, invalidating their current " +
      'password and locking them out until the new password is shared. Reversible ' +
      'by setting a new password. Confirm with the user before invoking. Returns ' +
      'the CIPP result (includes the new password when CIPP generated one).',
    annotations: {
      title: 'Reset password (reversible)',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tenantFilter: TENANT_FILTER_PROP,
        userId: USER_ID_PROP,
        newPassword: {
          type: 'string',
          description:
            'The replacement password to set. If omitted, a random password is generated and returned in the response.',
        },
      },
      required: ['tenantFilter', 'userId'],
    },
  },
  {
    name: 'cipp_reset_mfa',
    description:
      'DESTRUCTIVE: Reset all MFA methods for a user, requiring them to ' +
      're-register their authentication methods before they can sign in with MFA. ' +
      'Reversible by re-registering MFA. Confirm with the user before invoking. ' +
      'Returns the CIPP action result.',
    annotations: {
      title: 'Reset MFA (reversible)',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tenantFilter: TENANT_FILTER_PROP,
        userId: USER_ID_PROP,
      },
      required: ['tenantFilter', 'userId'],
    },
  },
  {
    name: 'cipp_revoke_sessions',
    description:
      'DESTRUCTIVE: Revoke all active sessions for a user, forcing them to ' +
      're-authenticate on every device. Reversible by the user signing in again. ' +
      'Confirm with the user before invoking. Returns the CIPP action result.',
    annotations: {
      title: 'Revoke sessions (reversible)',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tenantFilter: TENANT_FILTER_PROP,
        userId: USER_ID_PROP,
      },
      required: ['tenantFilter', 'userId'],
    },
  },
  {
    name: 'cipp_offboard_user',
    description:
      'DESTRUCTIVE: Fully offboard a user (effectively irreversible). Disables ' +
      'their account, revokes sessions, removes group memberships, and optionally ' +
      'transfers mailbox data. This comprehensive action cannot be easily undone. ' +
      'Confirm with the user before invoking. Returns the CIPP offboarding result.',
    annotations: {
      title: 'Offboard user (irreversible)',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tenantFilter: TENANT_FILTER_PROP,
        userId: USER_ID_PROP,
        revokePermissions: {
          type: 'boolean',
          description:
            'When true, removes the user from all groups and strips delegated mailbox and SharePoint permissions.',
        },
        disableUser: {
          type: 'boolean',
          description:
            'When true, disables the Azure AD account so the user can no longer sign in.',
        },
        resetPassword: {
          type: 'boolean',
          description:
            'When true, resets the account password as part of the offboarding flow.',
        },
        transferMailbox: {
          type: 'string',
          description:
            'UPN of the recipient who should receive the offboarded mailbox contents via a mailbox export / auto-forward. Omit to skip mailbox transfer.',
        },
      },
      required: ['tenantFilter', 'userId'],
    },
  },
  {
    name: 'cipp_bec_check',
    description: 'Run a Business Email Compromise (BEC) check on a user (tenantFilter and userId required). Returns suspicious sign-in locations, forwarding rules, and delegated access indicators.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
        userId: USER_ID_PROP,
      },
      required: ['tenantFilter', 'userId'],
    },
  },
  {
    name: 'cipp_list_mfa_users',
    description: 'List all M365 users and their MFA registration status in a tenant (tenantFilter required). Default summary: id, userPrincipalName, displayName, isMFARegistered. Use to identify users without MFA configured.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
      },
      required: ['tenantFilter'],
    },
  },
  {
    name: 'cipp_list_user_devices',
    description: 'List Intune/Entra-enrolled devices for a specific M365 user (tenantFilter and userId required). Default summary: id, displayName, operatingSystem, complianceState. Use to audit devices associated with an account.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
        userId: USER_ID_PROP,
      },
      required: ['tenantFilter', 'userId'],
    },
  },
  {
    name: 'cipp_list_user_groups',
    description: 'List M365 groups a specific user belongs to (tenantFilter and userId required). Default summary: id, displayName, groupType. Use before modifying group membership or checking access scope.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
        userId: USER_ID_PROP,
      },
      required: ['tenantFilter', 'userId'],
    },
  },

  // -------------------------------------------------------------------------
  // Group tools
  // -------------------------------------------------------------------------
  {
    name: 'cipp_list_groups',
    description: 'List M365 groups in a tenant (tenantFilter required); optionally filter by display name. Default summary: id, displayName, groupType, mailEnabled. Returns security and mail-enabled groups.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
        search: {
          type: 'string',
          description:
            'Optional text to filter results by group display name. Partial matches are supported.',
        },
      },
      required: ['tenantFilter'],
    },
  },
  {
    name: 'cipp_create_group',
    description:
      'VISIBLE-TO-OTHERS: Create a new group in the tenant, usable for ' +
      'security policy assignments (RBAC, Conditional Access) or mail distribution. ' +
      'A mail-enabled group appears in the global address list. Reversible by ' +
      'deleting the group. Confirm with the user before invoking. Returns the ' +
      'CIPP create result.',
    annotations: {
      title: 'Create group (high-impact)',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tenantFilter: TENANT_FILTER_PROP,
        displayName: {
          type: 'string',
          description: 'Human-readable name for the new group.',
        },
        description: {
          type: 'string',
          description: 'Optional free-text description of the group purpose.',
        },
        securityEnabled: {
          type: 'boolean',
          description:
            'When true, the group can be used for security policy assignments (RBAC, Conditional Access, etc.).',
        },
        mailEnabled: {
          type: 'boolean',
          description:
            'When true, the group is mail-enabled and can receive email. Required for Microsoft 365 groups.',
        },
        mailNickname: {
          type: 'string',
          description:
            'The mail alias used as the local part of the group email address (e.g. "finance-team" for finance-team@contoso.com). Required when mailEnabled is true.',
        },
      },
      required: ['tenantFilter', 'displayName'],
    },
  },

  // -------------------------------------------------------------------------
  // Mailbox tools
  // -------------------------------------------------------------------------
  {
    name: 'cipp_list_mailboxes',
    description: 'List Exchange Online mailboxes in a tenant (tenantFilter required); filter by type (UserMailbox, SharedMailbox, RoomMailbox, EquipmentMailbox). Default summary: id, displayName, primarySmtpAddress, recipientTypeDetails.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
        type: {
          type: 'string',
          enum: ['UserMailbox', 'SharedMailbox', 'RoomMailbox', 'EquipmentMailbox'],
          description:
            'Filter mailboxes by recipient type. Omit to return all mailbox types.',
        },
      },
      required: ['tenantFilter'],
    },
  },
  {
    name: 'cipp_list_mailbox_permissions',
    description: 'List full-access, send-as, and send-on-behalf permissions for a specific mailbox (tenantFilter and upn required). Use to audit delegated access.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
        upn: {
          type: 'string',
          description: 'User Principal Name of the mailbox whose permissions should be listed.',
        },
      },
      required: ['tenantFilter', 'upn'],
    },
  },
  {
    name: 'cipp_set_out_of_office',
    description:
      'VISIBLE-TO-OTHERS: Configure the out-of-office / auto-reply for a mailbox. ' +
      'Causes automated messages to be sent to internal and/or external senders ' +
      'who email the mailbox. Reversible by disabling the auto-reply. ' +
      'Confirm with the user before invoking. Returns the CIPP action result.',
    annotations: {
      title: 'Set out-of-office (high-impact)',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tenantFilter: TENANT_FILTER_PROP,
        upn: {
          type: 'string',
          description: 'User Principal Name of the mailbox to configure.',
        },
        enabled: {
          type: 'boolean',
          description: 'Set to true to enable the auto-reply, or false to disable it.',
        },
        internalMessage: {
          type: 'string',
          description:
            'HTML or plain-text auto-reply message sent to senders within the same organisation.',
        },
        externalMessage: {
          type: 'string',
          description:
            'HTML or plain-text auto-reply message sent to senders outside the organisation.',
        },
      },
      required: ['tenantFilter', 'upn', 'enabled'],
    },
  },
  {
    name: 'cipp_set_email_forwarding',
    description:
      'DESTRUCTIVE: Configure email forwarding on a mailbox, redirecting the ' +
      "user's incoming mail to another address. This is a common data-exfiltration " +
      'vector, so confirm intent carefully. Reversible by removing the forwarding ' +
      'rule (call with forwardTo omitted). Confirm with the user before invoking. ' +
      'Returns the CIPP action result.',
    annotations: {
      title: 'Set email forwarding (high-impact)',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tenantFilter: TENANT_FILTER_PROP,
        upn: {
          type: 'string',
          description: 'User Principal Name of the mailbox to configure forwarding on.',
        },
        forwardTo: {
          type: 'string',
          description:
            'Email address to forward incoming messages to. Omit this parameter to disable forwarding.',
        },
        keepCopy: {
          type: 'boolean',
          description:
            'When true (default), a copy of each forwarded message is retained in the original mailbox.',
          default: true,
        },
      },
      required: ['tenantFilter', 'upn'],
    },
  },

  // -------------------------------------------------------------------------
  // Security tools
  // -------------------------------------------------------------------------
  {
    name: 'cipp_list_conditional_access_policies',
    description: 'List Entra Conditional Access policies for a tenant (tenantFilter required). Default summary: id, displayName, state, conditions. Returns policy names, states (enabled/disabled/reportOnly), and conditions.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
      },
      required: ['tenantFilter'],
    },
  },
  {
    name: 'cipp_list_named_locations',
    description: 'List Entra named locations (trusted IP ranges and countries) for a tenant (tenantFilter required). Default summary: id, displayName, isTrusted. Used in Conditional Access policy conditions.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
      },
      required: ['tenantFilter'],
    },
  },

  // -------------------------------------------------------------------------
  // Standards tools
  // -------------------------------------------------------------------------
  {
    name: 'cipp_list_standards',
    description: 'List CIPP compliance standards configured for a tenant (tenantFilter required). Default summary: displayName, remediationAction, lastRunResult. Returns each standard name, remediation mode, and last-run result.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
      },
      required: ['tenantFilter'],
    },
  },
  {
    name: 'cipp_run_standards_check',
    description: 'Trigger an immediate CIPP standards compliance check for a tenant (tenantFilter required). Use when you need up-to-date drift data without waiting for the scheduled run.',
    inputSchema: {
      type: 'object',
      properties: {
        tenantFilter: TENANT_FILTER_PROP,
      },
      required: ['tenantFilter'],
    },
  },
  {
    name: 'cipp_list_standard_templates',
    description: 'List the CIPP Standards Templates configured across the partner tenant. Default summary: id, displayName, tenantFilter.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
      },
    },
    annotations: {
      title: 'List standards templates',
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  {
    name: 'cipp_get_tenant_drift',
    description:
      "Report standards drift - settings that deviate from a tenant's assigned " +
      'Standards Template. Default summary: tenantName, standard, currentValue, expectedValue. Omit tenantFilter to report drift across all tenants.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: {
          type: 'string',
          description:
            'Optional tenant domain or ID. Omit to report drift across all managed tenants.',
        },
      },
    },
    annotations: {
      title: 'Get tenant standards drift',
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  {
    name: 'cipp_get_tenant_alignment',
    description:
      "Report each tenant's alignment percentage against its assigned Standards " +
      'Templates. Default summary: tenantName, alignmentPercent, templateName. Omit tenantFilter to report on all tenants.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: {
          type: 'string',
          description:
            'Optional tenant domain or ID. Omit to report alignment across all managed tenants.',
        },
      },
    },
    annotations: {
      title: 'Get tenant standards alignment',
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  {
    name: 'cipp_create_standard_template',
    description:
      'DESTRUCTIVE: Create or update a CIPP Standards Template (upsert by ' +
      'GUID). A template assigned to tenants with any Remediate-action standard ' +
      'will modify those tenants on the next standards run. ' +
      'Confirm with the user before invoking. Returns the CIPP upsert result.',
    inputSchema: {
      type: 'object',
      properties: {
        template: {
          type: 'object',
          description:
            'The full Standards Template JSON object. Must include a "tenantFilter" ' +
            'assigning it to at least one tenant.',
        },
      },
      required: ['template'],
    },
    annotations: {
      title: 'Create/update standards template (high-impact)',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'cipp_delete_standard_template',
    description:
      'DESTRUCTIVE: Permanently delete a CIPP Standards Template by ID. ' +
      'Tenants assigned to it lose the standards it enforced. ' +
      'Confirm with the user before invoking. Returns the CIPP delete result.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: {
          type: 'string',
          description: 'The GUID of the Standards Template to delete.',
        },
      },
      required: ['templateId'],
    },
    annotations: {
      title: 'Delete standards template (high-impact)',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'cipp_list_bpa',
    description: 'Get CIPP Best Practice Analyser (BPA) results for a tenant (tenantFilter required). Default summary: checkName, result, severity. Returns per-check pass/fail scores against Microsoft best practices.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
      },
      required: ['tenantFilter'],
    },
  },
  {
    name: 'cipp_list_domain_health',
    description: 'Check email domain health (DMARC, DKIM, SPF, MX records) for a tenant (tenantFilter required). Default summary: domain, spf.result, dmarc.result, dkim.result. Use to identify missing DNS security records.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
      },
      required: ['tenantFilter'],
    },
  },

  // -------------------------------------------------------------------------
  // License tools
  // -------------------------------------------------------------------------
  {
    name: 'cipp_list_licenses',
    description: 'List M365 license SKUs, assigned counts, and available seats for a tenant (tenantFilter required). Default summary: id, skuPartNumber, assignedUnits, availableUnits. Use to identify over- or under-allocated licences.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
      },
      required: ['tenantFilter'],
    },
  },
  {
    name: 'cipp_list_csp_licenses',
    description: 'List all CSP Microsoft 365 license subscriptions across every managed tenant. Default summary: tenantName, skuPartNumber, quantity. Use for MSP-wide licence inventory and billing reconciliation.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
      },
    },
  },

  // -------------------------------------------------------------------------
  // Alert tools
  // -------------------------------------------------------------------------
  {
    name: 'cipp_list_audit_logs',
    description: 'List Microsoft 365 audit log entries for a tenant (tenantFilter required); filter by log type and look-back days. Default summary: creationTime, operation, userId, result. Use to investigate recent admin or user actions.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        tenantFilter: TENANT_FILTER_PROP,
        days: {
          type: 'number',
          description:
            'Number of days to look back when retrieving log entries. Defaults to 7 when omitted.',
        },
        type: {
          type: 'string',
          description:
            'Filter results to a specific log type (e.g. "AzureActiveDirectory", "Exchange", "SharePoint").',
        },
      },
      required: ['tenantFilter'],
    },
  },
  {
    name: 'cipp_list_alert_queue',
    description: 'List CIPP-generated alerts queued for review across all managed tenants. Default summary: id, tenantName, alertType, severity, createdAt. Use to check for policy violations or security findings pending acknowledgment.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
      },
    },
  },

  // -------------------------------------------------------------------------
  // GDAP tools
  // -------------------------------------------------------------------------
  {
    name: 'cipp_list_gdap_roles',
    description: 'List available GDAP (Granular Delegated Admin Privileges) Entra directory roles that can be assigned via CIPP. Default summary: id, displayName, description. Use when setting up new GDAP relationships.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
      },
    },
  },
  {
    name: 'cipp_list_gdap_invites',
    description: 'List pending GDAP relationship invites sent to tenants. Default summary: id, tenantName, status, createdAt. Use to track outstanding onboarding requests and confirm acceptance status.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
      },
    },
  },

  // -------------------------------------------------------------------------
  // Scheduler tools
  // -------------------------------------------------------------------------
  {
    name: 'cipp_list_scheduled_items',
    description: 'List scheduled tasks configured in CIPP. Default summary: taskName, command, nextRunTime, tenantFilter. Returns task names, commands, next-run times, and tenant scope.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
      },
    },
  },
  {
    name: 'cipp_add_scheduled_item',
    description: 'Create a new CIPP scheduled task (taskName, command, scheduledTime required). Optionally set a recurrence expression and scope to a specific tenant.',
    inputSchema: {
      type: 'object',
      properties: {
        taskName: {
          type: 'string',
          description: 'Human-readable name to identify this scheduled task in the CIPP UI.',
        },
        command: {
          type: 'string',
          description:
            'The CIPP function or command to execute on the schedule (e.g. "Get-CIPPAlerts").',
        },
        scheduledTime: {
          type: 'string',
          description:
            'ISO 8601 datetime string specifying when the task should first run (e.g. "2024-06-01T09:00:00Z").',
        },
        recurrence: {
          type: 'string',
          description:
            'Cron expression or friendly recurrence interval (e.g. "0 9 * * 1" for every Monday at 09:00, or "Daily"). Omit for a one-off task.',
        },
        tenantFilter: {
          type: 'string',
          description:
            "Optional tenant domain name or ID to scope the scheduled task. Use 'allTenants' to run across every managed tenant.",
        },
      },
      required: ['taskName', 'command', 'scheduledTime'],
    },
  },

  // -------------------------------------------------------------------------
  // Core tools
  // -------------------------------------------------------------------------
  {
    name: 'cipp_status',
    description: 'Show CIPP server configuration status: which env vars are set, CIPP URL, and whether credentials appear valid. Always works, even with missing credentials.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cipp_ping',
    description: 'Verify CIPP API connectivity and authentication by calling a lightweight endpoint. Returns CIPP version and confirms credentials are working. Use before other calls if you suspect a connection issue.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cipp_get_version',
    description: 'Get the current CIPP deployment version and build metadata. Use to confirm which CIPP release is running.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cipp_list_logs',
    description: 'List CIPP application-level logs; filter by date (optional ISO 8601 date). Default summary: timestamp, level, message. Use to diagnose CIPP backend errors or audit automation runs.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SHAPE_PROPS,
        dateFilter: {
          type: 'string',
          description:
            'ISO 8601 date string used to filter log entries to a specific day (e.g. "2024-06-01"). Omit to retrieve recent logs.',
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool Categories
// ---------------------------------------------------------------------------

/**
 * Maps a human-readable category label to the names of all tools in that group.
 * Useful for selectively registering or describing subsets of tools.
 */
export const TOOL_CATEGORIES: Record<string, string[]> = {
  tenants: ['cipp_list_tenants', 'cipp_get_tenant_details'],
  users: [
    'cipp_list_users',
    'cipp_create_user',
    'cipp_edit_user',
    'cipp_disable_user',
    'cipp_reset_password',
    'cipp_reset_mfa',
    'cipp_revoke_sessions',
    'cipp_offboard_user',
    'cipp_bec_check',
    'cipp_list_mfa_users',
    'cipp_list_user_devices',
    'cipp_list_user_groups',
  ],
  groups: ['cipp_list_groups', 'cipp_create_group'],
  mailboxes: [
    'cipp_list_mailboxes',
    'cipp_list_mailbox_permissions',
    'cipp_set_out_of_office',
    'cipp_set_email_forwarding',
  ],
  security: ['cipp_list_conditional_access_policies', 'cipp_list_named_locations'],
  standards: [
    'cipp_list_standards',
    'cipp_run_standards_check',
    'cipp_list_standard_templates',
    'cipp_get_tenant_drift',
    'cipp_get_tenant_alignment',
    'cipp_create_standard_template',
    'cipp_delete_standard_template',
    'cipp_list_bpa',
    'cipp_list_domain_health',
  ],
  licenses: ['cipp_list_licenses', 'cipp_list_csp_licenses'],
  alerts: ['cipp_list_audit_logs', 'cipp_list_alert_queue'],
  gdap: ['cipp_list_gdap_roles', 'cipp_list_gdap_invites'],
  scheduler: ['cipp_list_scheduled_items', 'cipp_add_scheduled_item'],
  core: ['cipp_status', 'cipp_ping', 'cipp_get_version', 'cipp_list_logs'],
};
