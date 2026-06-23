import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClientList,
  withClientItem,
  extractShapeArgs,
  SHAPE_PROPS,
  tenantsProp,
  pageProps,
  INTERFACE_TYPES,
  ONLINE_STATUSES,
  type SummaryFn,
  type FlatResource,
} from './shared.js';

const interfaceSummary: SummaryFn<FlatResource> = (i: FlatResource) => ({
  id: i.id,
  interfaceName: i.interfaceName,
  interfaceType: i.interfaceType,
  operationalStatus: i.operationalStatus,
  adminStatus: i.adminStatus,
  macAddress: i.macAddress,
  ipAddresses: i.ipAddresses,
});

export const interfacesListTool: Tool = {
  name: 'auvik_interfaces_list',
  description: 'List network interfaces across devices, returning name, type, operational status, MAC address, and IP addresses; use to discover interfaces or get an interface ID before calling auvik_statistics_interface. (GET /v1/inventory/interface/info)',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
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
  description: 'Fetch detail for a single network interface by ID; use when you need the full interface record for one specific port or NIC. (GET /v1/inventory/interface/info/{id})',
  inputSchema: {
    type: 'object',
    properties: {
      interfaceId: { type: 'string', description: 'Auvik interface ID.' },
      ...SHAPE_PROPS,
    },
    required: ['interfaceId'],
    additionalProperties: false,
  },
};

export const handleInterfacesList = (args: Record<string, unknown>) =>
  withClientList((c) => c.interfaces.list(args), interfaceSummary, extractShapeArgs(args), 'auvik_interfaces_list');

export const handleInterfacesGet = (args: { interfaceId: string } & Record<string, unknown>) =>
  withClientItem((c) => c.interfaces.get(args.interfaceId), interfaceSummary, extractShapeArgs(args), 'auvik_interfaces_get');
