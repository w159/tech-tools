import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClient,
  tenantsProp,
  pageProps,
  NETWORK_TYPES,
  NETWORK_SCAN_STATUSES,
  NETWORK_SCOPES,
} from './shared.js';

export const networksListTool: Tool = {
  name: 'auvik_networks_list',
  description: 'GET /v1/inventory/network/info — list networks (routed/VLAN/wifi/subnets) per tenant.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      filter_networkType: { type: 'string', enum: [...NETWORK_TYPES], description: 'filter[networkType].' },
      filter_scanStatus: { type: 'string', enum: [...NETWORK_SCAN_STATUSES], description: 'filter[scanStatus].' },
      filter_devices: { type: 'string', description: 'filter[devices] — comma-separated device IDs on the network.' },
      filter_modifiedAfter: { type: 'string', description: 'filter[modifiedAfter] ISO 8601.' },
      include: { type: 'string', enum: ['networkDetail'], description: 'Sideload "networkDetail".' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const networksGetTool: Tool = {
  name: 'auvik_networks_get',
  description: 'GET /v1/inventory/network/info/{id} — single network basic info.',
  inputSchema: {
    type: 'object',
    properties: {
      networkId: { type: 'string', description: 'Auvik network ID.' },
      include: { type: 'string', enum: ['networkDetail'], description: 'Sideload "networkDetail".' },
    },
    required: ['networkId'],
    additionalProperties: false,
  },
};

export const networksListDetailTool: Tool = {
  name: 'auvik_networks_list_detail',
  description: 'GET /v1/inventory/network/detail — list network detail records (scope, collectors).',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      filter_networkType: { type: 'string', enum: [...NETWORK_TYPES], description: 'filter[networkType].' },
      filter_scanStatus: { type: 'string', enum: [...NETWORK_SCAN_STATUSES], description: 'filter[scanStatus].' },
      filter_scope: { type: 'string', enum: [...NETWORK_SCOPES], description: 'filter[scope].' },
      filter_devices: { type: 'string', description: 'filter[devices] — comma-separated device IDs.' },
      filter_modifiedAfter: { type: 'string', description: 'filter[modifiedAfter] ISO 8601.' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const networksGetDetailTool: Tool = {
  name: 'auvik_networks_get_detail',
  description: 'GET /v1/inventory/network/detail/{id} — single network detail record (scope, collectors, excluded IPs).',
  inputSchema: {
    type: 'object',
    properties: { networkId: { type: 'string', description: 'Auvik network ID.' } },
    required: ['networkId'],
    additionalProperties: false,
  },
};

type ListArgs = Record<string, unknown>;

export const handleNetworksList = (args: ListArgs) => withClient((c) => c.networks.list(args));
export const handleNetworksGet = (args: { networkId: string; include?: string }) =>
  withClient((c) => c.networks.get(args.networkId, { include: args.include }));
export const handleNetworksListDetail = (args: ListArgs) => withClient((c) => c.networks.listDetail(args));
export const handleNetworksGetDetail = (args: { networkId: string }) =>
  withClient((c) => c.networks.getDetail(args.networkId));
