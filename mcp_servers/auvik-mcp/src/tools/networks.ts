import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClientList,
  withClientItem,
  extractShapeArgs,
  SHAPE_PROPS,
  tenantsProp,
  pageProps,
  NETWORK_TYPES,
  NETWORK_SCAN_STATUSES,
  NETWORK_SCOPES,
  type SummaryFn,
  type FlatResource,
} from './shared.js';

const networkInfoSummary: SummaryFn<FlatResource> = (n: FlatResource) => ({
  id: n.id,
  networkName: n.networkName,
  networkType: n.networkType,
  scanStatus: n.scanStatus,
  description: n.description,
});

const networkDetailSummary: SummaryFn<FlatResource> = (n: FlatResource) => ({
  id: n.id,
  networkName: n.networkName,
  scope: n.scope,
  scanStatus: n.scanStatus,
  collectors: n.collectors,
});

export const networksListTool: Tool = {
  name: 'auvik_networks_list',
  description: 'List networks (routed, VLAN, WiFi, subnets) for a tenant, returning name, type, and scan status; use to discover networks or find a network ID before checking devices on it. (GET /v1/inventory/network/info)',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
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
  description: 'Fetch basic info (name, type, scan status) for a single network by ID. (GET /v1/inventory/network/info/{id})',
  inputSchema: {
    type: 'object',
    properties: {
      networkId: { type: 'string', description: 'Auvik network ID.' },
      include: { type: 'string', enum: ['networkDetail'], description: 'Sideload "networkDetail".' },
      ...SHAPE_PROPS,
    },
    required: ['networkId'],
    additionalProperties: false,
  },
};

export const networksListDetailTool: Tool = {
  name: 'auvik_networks_list_detail',
  description: 'List network detail records (scope, assigned collectors, excluded IPs) for all networks in a tenant; use to understand how networks are scanned and managed. (GET /v1/inventory/network/detail)',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
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
  description: 'Fetch scope, collector, and excluded-IP detail for a single network by ID. (GET /v1/inventory/network/detail/{id})',
  inputSchema: {
    type: 'object',
    properties: {
      networkId: { type: 'string', description: 'Auvik network ID.' },
      ...SHAPE_PROPS,
    },
    required: ['networkId'],
    additionalProperties: false,
  },
};

type ListArgs = Record<string, unknown>;

export const handleNetworksList = (args: ListArgs) =>
  withClientList((c) => c.networks.list(args), networkInfoSummary, extractShapeArgs(args), 'auvik_networks_list');

export const handleNetworksGet = (args: { networkId: string; include?: string } & ListArgs) =>
  withClientItem(
    (c) => c.networks.get(args.networkId, { include: args.include }),
    networkInfoSummary,
    extractShapeArgs(args),
    'auvik_networks_get'
  );

export const handleNetworksListDetail = (args: ListArgs) =>
  withClientList((c) => c.networks.listDetail(args), networkDetailSummary, extractShapeArgs(args), 'auvik_networks_list_detail');

export const handleNetworksGetDetail = (args: { networkId: string } & ListArgs) =>
  withClientItem(
    (c) => c.networks.getDetail(args.networkId),
    networkDetailSummary,
    extractShapeArgs(args),
    'auvik_networks_get_detail'
  );
