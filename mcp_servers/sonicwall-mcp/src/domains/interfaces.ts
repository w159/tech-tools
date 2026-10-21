import { defineDomain, getEntry, readOnlyTool, run } from './_helpers.js';

export const interfacesHandler = defineDomain([
  getEntry('sonicwall_interfaces_list', 'List IPv4 interface configuration (GET /interfaces/ipv4).', '/interfaces/ipv4'),
  {
    tool: readOnlyTool({
      name: 'sonicwall_interfaces_get',
      description: 'Get one IPv4 interface (GET /interfaces/ipv4/name/{NAME}/vlan/{VLANID}/tunnel/{TUNNELID}). Ground the name with sonicwall_interfaces_list.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Interface name, e.g. "X0".' },
          vlan: { type: 'number', description: 'VLAN id; 0 for a physical interface (default 0).' },
          tunnel: { type: 'number', description: 'Tunnel id; 0 when not a tunnel (default 0).' },
        },
        required: ['name'],
      },
    }),
    run: (a) => {
      const vlan = Number.isInteger(a.vlan) ? a.vlan : 0;
      const tunnel = Number.isInteger(a.tunnel) ? a.tunnel : 0;
      return run('sonicwall_interfaces_get', (c) => c.request('GET', `/interfaces/ipv4/name/${encodeURIComponent(a.name as string)}/vlan/${vlan}/tunnel/${tunnel}`));
    },
  },
  getEntry('sonicwall_interfaces_ipv4_status', 'IPv4 interface runtime status (GET /reporting/interfaces/ipv4/status).', '/reporting/interfaces/ipv4/status'),
  getEntry('sonicwall_interfaces_statistics', 'IPv4 interface traffic statistics (GET /reporting/interfaces/ipv4/statistics).', '/reporting/interfaces/ipv4/statistics'),
]);
