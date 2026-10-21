import { defineDomain, getEntry, readOnlyTool, run } from './_helpers.js';

export const vpnHandler = defineDomain([
  getEntry('sonicwall_vpn_policies_list', 'List all VPN policies (GET /vpn/policies/all).', '/vpn/policies/all'),
  getEntry('sonicwall_vpn_site_to_site_list', 'List IPv4 site-to-site VPN policies (GET /vpn/policies/ipv4/site-to-site).', '/vpn/policies/ipv4/site-to-site'),
  {
    tool: readOnlyTool({
      name: 'sonicwall_vpn_site_to_site_get',
      description: 'Get one IPv4 site-to-site VPN policy by name (GET /vpn/policies/ipv4/site-to-site/name/{NAME}). Ground the name with sonicwall_vpn_site_to_site_list.',
      inputSchema: { type: 'object' as const, properties: { name: { type: 'string', description: 'VPN policy name (required).' } }, required: ['name'] },
    }),
    run: (a) => run('sonicwall_vpn_site_to_site_get', (c) => c.request('GET', `/vpn/policies/ipv4/site-to-site/name/${encodeURIComponent(a.name as string)}`)),
  },
  getEntry('sonicwall_vpn_tunnel_status', 'VPN tunnel interface status (GET /reporting/tunnel-interfaces/vpn/status).', '/reporting/tunnel-interfaces/vpn/status'),
  getEntry('sonicwall_ssl_vpn_sessions', 'Active SSL VPN sessions (GET /reporting/ssl-vpn/sessions).', '/reporting/ssl-vpn/sessions'),
]);
