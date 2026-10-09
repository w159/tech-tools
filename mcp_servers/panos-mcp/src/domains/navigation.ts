import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainName } from '../utils/types.js';
import { readOnlyTool } from './_helpers.js';

export const DOMAINS: DomainName[] = [
  'config',
  'commits',
  'operations',
  'logs',
  'reports',
  'files',
  'objects',
  'policies',
  'updates',
  'certificates',
];

const domainDescriptions: Record<DomainName, string> = {
  config: 'Candidate config tree: show/get/set/edit/delete/rename/clone/move/override (writes never auto-commit)',
  commits: 'Commit the candidate config and check/wait on commit and other job IDs',
  operations: 'Operational commands: version, system info, connected devices, GlobalProtect sessions',
  logs: 'Traffic/threat/system log queries and async log job retrieval',
  reports: 'Dynamic, predefined, and custom PAN-OS reports',
  files: 'Config/log/cert export, tech-support bundle export, file and certificate import',
  objects: 'REST address, address-group, service, service-group, tag, application-group, and EDL objects',
  policies: 'REST security, NAT, decryption, application-override, and authentication policy rules',
  updates: 'Content and software (PAN-OS) update lifecycle: check, download, install, and reboot',
  certificates: 'Certificate lifecycle: generate, renew, revoke, export, import, and trust assignment',
};

export function getNavigationTools(): Tool[] {
  const domainLines = DOMAINS.map(d => `- ${d}: ${domainDescriptions[d]}`).join('\n');
  return [
    readOnlyTool({
      name: 'panos_navigate',
      description:
        'Discover available PAN-OS tools by domain. Returns tool names and descriptions for the selected domain. All tools are callable at any time - this is a help/discovery aid, not a prerequisite.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          domain: {
            type: 'string',
            enum: DOMAINS,
            description: `The domain to explore:\n${domainLines}`,
          },
        },
        required: ['domain'],
      },
    }),
    readOnlyTool({
      name: 'panos_status',
      description: 'Show PAN-OS credentials status, resolved host, default target, TLS verification state, and list of available domains. Use to verify the connection is healthy before running queries. Runs without credentials configured.',
      inputSchema: { type: 'object' as const, properties: {} },
    }),
  ];
}
