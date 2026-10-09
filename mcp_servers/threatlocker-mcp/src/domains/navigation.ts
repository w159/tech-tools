import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainName } from '../utils/types.js';

export const DOMAINS: DomainName[] = ['computers', 'computer_groups', 'approval_requests', 'audit_log', 'organizations', 'policies', 'applications', 'config_manager', 'dac', 'system_audit', 'tags'];

/**
 * Domain metadata for navigation help
 */
const domainDescriptions: Record<DomainName, string> = {
 computers: "Devices by hostname - list (with total count), detail, check-in history, maintenance modes",
 computer_groups: "Computer groups by name with operating system",
 approval_requests: "Approval requests by device/user/file - list by status, detail, pending count, permit application, storage approval, approve",
 audit_log: "Unified Audit by device/user/action - search a time window, event detail, per-file history",
 organizations: "Organizations by name - children, organizations the key can act on, agent enrollment auth key",
 policies: "Application Control policies - list by group/filter/OS, detail by GUID",
 applications: "Application Control applications - vendor catalog search, detail by GUID",
 config_manager: "Config Manager device configurations - configuration check catalog and enforced device-configuration policies",
 dac: "DAC Health Center risk findings - includes storage-policy posture (no direct storage-policy API endpoint)",
 system_audit: "System Audit - portal administrator/login audit trail (who changed what in the portal)",
 tags: "Tags by name - {label, value} options, optional built-ins",
};

export function getNavigationTools(): Tool[] {
 return [
  {
   name: 'threatlocker_navigate',
   description: 'Discover available ThreatLocker tools by domain. Returns tool names and descriptions for the selected domain. All tools are callable at any time — this is a help/discovery aid, not a prerequisite.',
   inputSchema: {
    type: 'object' as const,
    properties: {
     domain: {
      type: 'string',
      enum: DOMAINS,
      description: `The domain to explore:
- computers: ${domainDescriptions.computers}
- computer_groups: ${domainDescriptions.computer_groups}
- approval_requests: ${domainDescriptions.approval_requests}
- audit_log: ${domainDescriptions.audit_log}
- organizations: ${domainDescriptions.organizations}
- policies: ${domainDescriptions.policies}
- applications: ${domainDescriptions.applications}
- config_manager: ${domainDescriptions.config_manager}
- dac: ${domainDescriptions.dac}
- system_audit: ${domainDescriptions.system_audit}
- tags: ${domainDescriptions.tags}`,
     },
    },
    required: ['domain'],
   },
  },
  {
   name: 'threatlocker_status',
   description: 'Show ThreatLocker MCP server configuration status: credential presence, API URL, and available tool domains. Use to verify setup before calling other tools.',
   inputSchema: { type: 'object' as const, properties: {} },
  },
 ];
}

