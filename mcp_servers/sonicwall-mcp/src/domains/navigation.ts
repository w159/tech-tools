import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainName } from '../utils/types.js';
import { readOnlyTool } from './_helpers.js';

export const DOMAINS: DomainName[] = ['session', 'system', 'config', 'objects', 'policies', 'interfaces', 'vpn', 'logs', 'generic'];

const domainDescriptions: Record<DomainName, string> = {
  session: 'Log out and release the single SonicOS admin slot',
  system: 'Version, system and security-service status, license, API settings, logged-in users',
  config: 'Pending config: view, commit, discard, enter/leave config mode (writes never auto-commit)',
  objects: 'Address objects and groups, service objects and groups, zones, schedules (keyed by name)',
  policies: 'Access rules, security, NAT and route policies (keyed by uuid)',
  interfaces: 'IPv4 interface config, status and statistics',
  vpn: 'VPN policies, site-to-site, tunnel status, SSL VPN sessions',
  logs: 'Event and audit logs, syslog servers, CSV export',
  generic: 'sonicwall_request: any endpoint in the vendor inventory, grounded and guarded',
};

export const domainLine = (d: DomainName): string => `- ${d}: ${domainDescriptions[d]}`;

export function getNavigationTools(): Tool[] {
  return [
    readOnlyTool({
      name: 'sonicwall_navigate',
      description:
        'Discover SonicWall tools and endpoints. With no arguments lists the curated domains. With `domain` lists that domain\'s tools. ' +
        'With `search` returns matching rows (method, path, tag) from the SonicOS endpoint inventory, capped at 50, so a path can be grounded before sonicwall_request. ' +
        'All tools are callable at any time; this is a discovery aid.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string', enum: DOMAINS, description: `The domain to explore:\n${DOMAINS.map(domainLine).join('\n')}` },
          search: { type: 'string', description: 'Whitespace-separated terms matched against method, path and tag, e.g. "address-objects ipv4".' },
        },
      },
    }),
    readOnlyTool({
      name: 'sonicwall_status',
      description:
        'Show SonicWall connection status: host, port, username, password (configured plus length, never the value), TLS verification, session override, and the live result of GET /version with session state. Runs without credentials configured.',
      inputSchema: { type: 'object' as const, properties: {} },
    }),
  ];
}
