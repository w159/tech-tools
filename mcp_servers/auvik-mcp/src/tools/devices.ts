import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClientList,
  withClientItem,
  extractShapeArgs,
  SHAPE_PROPS,
  tenantsProp,
  pageProps,
  DEVICE_TYPES,
  ONLINE_STATUSES,
  DISCOVERY_STATUSES,
  TRAFFIC_INSIGHTS_STATUSES,
  LIFECYCLE_STATUSES,
  type SummaryFn,
  type FlatResource,
} from './shared.js';

// ---------------------------------------------------------------------------
// Summary functions — compact views for list/get tools.
// Reach into flattened attributes (id, deviceName, deviceType, etc. are
// top-level after flattenResource, because JSON:API attributes are spread).
// ---------------------------------------------------------------------------

const deviceInfoSummary: SummaryFn<FlatResource> = (d: FlatResource) => ({
  id: d.id,
  deviceName: d.deviceName,
  deviceType: d.deviceType,
  makeModel: d.makeModel,
  onlineStatus: d.onlineStatus,
  ipAddresses: d.ipAddresses,
  lastSeen: d.lastSeen,
  tenantId: (d.relationships as Record<string, unknown> | undefined) &&
    ((d.relationships as Record<string, unknown>)['tenant'] as Record<string, unknown> | undefined) &&
    (((d.relationships as Record<string, unknown>)['tenant'] as Record<string, unknown>)['data'] as Record<string, unknown> | undefined)?.id,
});

const deviceDetailSummary: SummaryFn<FlatResource> = (d: FlatResource) => ({
  id: d.id,
  deviceName: d.deviceName,
  manageStatus: d.manageStatus,
  discoverySNMP: d.discoverySNMP,
  discoveryWMI: d.discoveryWMI,
  discoveryLogin: d.discoveryLogin,
  trafficInsightsStatus: d.trafficInsightsStatus,
});

const deviceExtendedSummary: SummaryFn<FlatResource> = (d: FlatResource) => ({
  id: d.id,
  deviceName: d.deviceName,
  trafficInsightsStatus: d.trafficInsightsStatus,
  softwareVersion: d.softwareVersion,
  systemUpTime: d.systemUpTime,
});

const deviceWarrantySummary: SummaryFn<FlatResource> = (d: FlatResource) => ({
  id: d.id,
  coveredUnderWarranty: d.coveredUnderWarranty,
  coveredUnderService: d.coveredUnderService,
  warrantyExpiry: d.warrantyExpiry,
  serviceExpiry: d.serviceExpiry,
});

const deviceLifecycleSummary: SummaryFn<FlatResource> = (d: FlatResource) => ({
  id: d.id,
  salesAvailability: d.salesAvailability,
  softwareMaintenanceStatus: d.softwareMaintenanceStatus,
  securitySoftwareMaintenanceStatus: d.securitySoftwareMaintenanceStatus,
  lastSupportStatus: d.lastSupportStatus,
  endOfLifeDate: d.endOfLifeDate,
  endOfSaleDate: d.endOfSaleDate,
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const devicesListTool: Tool = {
  name: 'auvik_devices_list',
  description:
    'GET /v1/inventory/device/info — list Auvik-managed devices (basic info). Returns a compact summary (id, deviceName, deviceType, makeModel, onlineStatus, ipAddresses, lastSeen) by default. Pass full=true or fields=[...] for more fields. JSON:API; paginate by passing the page[after] cursor from links.next into pageAfter, or call auvik_navigate with links.next.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
      filter_deviceType: { type: 'string', enum: [...DEVICE_TYPES], description: 'filter[deviceType].' },
      filter_makeModel: { type: 'string', description: 'filter[makeModel] (exact make/model string).' },
      filter_vendorName: { type: 'string', description: 'filter[vendorName].' },
      filter_onlineStatus: { type: 'string', enum: [...ONLINE_STATUSES], description: 'filter[onlineStatus].' },
      filter_networks: { type: 'string', description: 'filter[networks] — comma-separated network IDs the device belongs to.' },
      filter_modifiedAfter: { type: 'string', description: 'filter[modifiedAfter] — ISO 8601; only devices modified after this time.' },
      filter_notSeenSince: { type: 'string', description: 'filter[notSeenSince] — ISO 8601; only devices not seen since this time.' },
      filter_stateKnown: { type: 'boolean', description: 'filter[stateKnown].' },
      include: { type: 'string', enum: ['deviceDetail'], description: 'Sideload related resources (only "deviceDetail" is supported).' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const devicesGetTool: Tool = {
  name: 'auvik_devices_get',
  description: 'GET /v1/inventory/device/info/{id} — single device basic info. Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string', description: 'Auvik device ID from a list call.' },
      include: { type: 'string', enum: ['deviceDetail'], description: 'Sideload "deviceDetail".' },
      ...SHAPE_PROPS,
    },
    required: ['deviceId'],
    additionalProperties: false,
  },
};

export const devicesGetDetailsTool: Tool = {
  name: 'auvik_devices_get_details',
  description:
    'GET /v1/inventory/device/detail/{id} — extended detail for one device (discovery status, manage status, connected devices). Use auvik_devices_get_extended for traffic-insight extended details.',
  inputSchema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string', description: 'Auvik device ID.' },
      ...SHAPE_PROPS,
    },
    required: ['deviceId'],
    additionalProperties: false,
  },
};

export const devicesListDetailsTool: Tool = {
  name: 'auvik_devices_list_details',
  description:
    'GET /v1/inventory/device/detail — list extended device detail records (discovery + manage status) across a tenant, filterable by discovery/traffic-insight status. Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
      filter_manageStatus: { type: 'boolean', description: 'filter[manageStatus] — true=managed.' },
      filter_discoverySNMP: { type: 'string', enum: [...DISCOVERY_STATUSES], description: 'filter[discoverySNMP].' },
      filter_discoveryWMI: { type: 'string', enum: [...DISCOVERY_STATUSES], description: 'filter[discoveryWMI].' },
      filter_discoveryLogin: { type: 'string', enum: [...DISCOVERY_STATUSES], description: 'filter[discoveryLogin].' },
      filter_discoveryVMware: { type: 'string', enum: [...DISCOVERY_STATUSES], description: 'filter[discoveryVMware].' },
      filter_trafficInsightsStatus: {
        type: 'string',
        enum: [...TRAFFIC_INSIGHTS_STATUSES],
        description: 'filter[trafficInsightsStatus].',
      },
    },
    required: [],
    additionalProperties: false,
  },
};

export const devicesGetExtendedTool: Tool = {
  name: 'auvik_devices_get_extended',
  description: 'GET /v1/inventory/device/detail/extended/{id} — single device extended detail (traffic insights, deep attributes). Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string', description: 'Auvik device ID.' },
      ...SHAPE_PROPS,
    },
    required: ['deviceId'],
    additionalProperties: false,
  },
};

export const devicesListExtendedTool: Tool = {
  name: 'auvik_devices_list_extended',
  description:
    'GET /v1/inventory/device/detail/extended — list extended device details. filter[deviceType] is REQUIRED by this endpoint. Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      filter_deviceType: { type: 'string', enum: [...DEVICE_TYPES], description: 'filter[deviceType] (REQUIRED).' },
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
      filter_modifiedAfter: { type: 'string', description: 'filter[modifiedAfter] ISO 8601.' },
      filter_notSeenSince: { type: 'string', description: 'filter[notSeenSince] ISO 8601.' },
      filter_stateKnown: { type: 'boolean', description: 'filter[stateKnown].' },
    },
    required: ['filter_deviceType'],
    additionalProperties: false,
  },
};

export const devicesListWarrantyTool: Tool = {
  name: 'auvik_devices_list_warranty',
  description: 'GET /v1/inventory/device/warranty — list device warranty/service-coverage records for a tenant. Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
      filter_coveredUnderWarranty: { type: 'boolean', description: 'filter[coveredUnderWarranty].' },
      filter_coveredUnderService: { type: 'boolean', description: 'filter[coveredUnderService].' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const devicesGetWarrantyTool: Tool = {
  name: 'auvik_devices_get_warranty',
  description:
    'GET /v1/inventory/device/warranty/{id} — warranty info for one device. Returns 404 if the device has no warranty record (not an error in the endpoint). Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string', description: 'Auvik device ID.' },
      ...SHAPE_PROPS,
    },
    required: ['deviceId'],
    additionalProperties: false,
  },
};

export const devicesListLifecycleTool: Tool = {
  name: 'auvik_devices_list_lifecycle',
  description: 'GET /v1/inventory/device/lifecycle — list device end-of-life / end-of-sale / end-of-support records for a tenant. Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
      filter_salesAvailability: { type: 'string', enum: [...LIFECYCLE_STATUSES], description: 'filter[salesAvailability].' },
      filter_softwareMaintenanceStatus: { type: 'string', enum: [...LIFECYCLE_STATUSES], description: 'filter[softwareMaintenanceStatus].' },
      filter_securitySoftwareMaintenanceStatus: { type: 'string', enum: [...LIFECYCLE_STATUSES], description: 'filter[securitySoftwareMaintenanceStatus].' },
      filter_lastSupportStatus: { type: 'string', enum: [...LIFECYCLE_STATUSES], description: 'filter[lastSupportStatus].' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const devicesGetLifecycleTool: Tool = {
  name: 'auvik_devices_get_lifecycle',
  description:
    'GET /v1/inventory/device/lifecycle/{id} — lifecycle info for one device. Returns 404 if the device has no lifecycle record. Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string', description: 'Auvik device ID.' },
      ...SHAPE_PROPS,
    },
    required: ['deviceId'],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

type ListArgs = Record<string, unknown>;

export const handleDevicesList = (args: ListArgs) =>
  withClientList((c) => c.devices.list(args), deviceInfoSummary, extractShapeArgs(args), 'auvik_devices_list');

export const handleDevicesGet = (args: { deviceId: string; include?: string } & ListArgs) =>
  withClientItem(
    (c) => c.devices.get(args.deviceId, { include: args.include }),
    deviceInfoSummary,
    extractShapeArgs(args),
    'auvik_devices_get'
  );

export const handleDevicesGetDetails = (args: { deviceId: string } & ListArgs) =>
  withClientItem(
    (c) => c.devices.getDetail(args.deviceId),
    deviceDetailSummary,
    extractShapeArgs(args),
    'auvik_devices_get_details'
  );

export const handleDevicesListDetails = (args: ListArgs) =>
  withClientList((c) => c.devices.listDetail(args), deviceDetailSummary, extractShapeArgs(args), 'auvik_devices_list_details');

export const handleDevicesGetExtended = (args: { deviceId: string } & ListArgs) =>
  withClientItem(
    (c) => c.devices.getExtended(args.deviceId),
    deviceExtendedSummary,
    extractShapeArgs(args),
    'auvik_devices_get_extended'
  );

export const handleDevicesListExtended = (args: ListArgs) =>
  withClientList((c) => c.devices.listExtended(args), deviceExtendedSummary, extractShapeArgs(args), 'auvik_devices_list_extended');

export const handleDevicesListWarranty = (args: ListArgs) =>
  withClientList((c) => c.devices.listWarranty(args), deviceWarrantySummary, extractShapeArgs(args), 'auvik_devices_list_warranty');

export const handleDevicesGetWarranty = (args: { deviceId: string } & ListArgs) =>
  withClientItem(
    (c) => c.devices.getWarranty(args.deviceId),
    deviceWarrantySummary,
    extractShapeArgs(args),
    'auvik_devices_get_warranty'
  );

export const handleDevicesListLifecycle = (args: ListArgs) =>
  withClientList((c) => c.devices.listLifecycle(args), deviceLifecycleSummary, extractShapeArgs(args), 'auvik_devices_list_lifecycle');

export const handleDevicesGetLifecycle = (args: { deviceId: string } & ListArgs) =>
  withClientItem(
    (c) => c.devices.getLifecycle(args.deviceId),
    deviceLifecycleSummary,
    extractShapeArgs(args),
    'auvik_devices_get_lifecycle'
  );
