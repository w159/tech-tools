import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { withClient, tenantsProp, pageProps, INTERFACE_TYPES, ONLINE_STATUSES } from './shared.js';

export const interfacesListTool: Tool = {
  name: 'auvik_interfaces_list',
  description: 'GET /v1/inventory/interface/info — list network interfaces. Get an interface ID here before fetching interface statistics.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      filter_interfaceType: { type: 'string', enum: [...INTERFACE_TYPES], description: 'filter[interfaceType].' },
      filter_parentDevice: { type: 'string', description: 'filter[parentDevice] — parent device ID.' },
      filter_adminStatus: { type: 'boolean', description: 'filter[adminStatus] — true=administratively up.' },
      filter_operationalStatus: {
        type: 'string',
        enum: [...ONLINE_STATUSES],
        description: 'filter[operationalStatus] — uses the OnlineStatus enum (online/offline/...).',
      },
      filter_modifiedAfter: { type: 'string', description: 'filter[modifiedAfter] ISO 8601.' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const interfacesGetTool: Tool = {
  name: 'auvik_interfaces_get',
  description: 'GET /v1/inventory/interface/info/{id} — single interface.',
  inputSchema: {
    type: 'object',
    properties: { interfaceId: { type: 'string', description: 'Auvik interface ID.' } },
    required: ['interfaceId'],
    additionalProperties: false,
  },
};

export const handleInterfacesList = (args: Record<string, unknown>) => withClient((c) => c.interfaces.list(args));
export const handleInterfacesGet = (args: { interfaceId: string }) =>
  withClient((c) => c.interfaces.get(args.interfaceId));
