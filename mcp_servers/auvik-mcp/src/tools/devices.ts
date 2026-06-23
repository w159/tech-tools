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
    'List Auvik-managed devices with basic identity and status (deviceName, deviceType, onlineStatus, IP addresses); start here to discover devices or find a device ID before drilling into details. Paginate via pageAfter cursor or auvik_navigate. (GET /v1/inventory/device/info)',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
      filter_deviceType: { type: 'string', enum: [...DEVICE_TYPES], description: 'Narrow results to one device type (e.g. "switch", "router", "firewall").' },
      filter_makeModel: { type: 'string', description: 'Exact make/model string to match (e.g. "Cisco Catalyst 2960").' },
      filter_vendorName: { type: 'string', description: 'Vendor name to filter by (e.g. "Cisco", "Ubiquiti").' },
      filter_onlineStatus: { type: 'string', enum: [...ONLINE_STATUSES], description: 'Current reachability state of the device (e.g. "online", "offline", "dormant").' },
      filter_networks: { type: 'string', description: 'filter[networks] — comma-separated network IDs the device belongs to.' },
      filter_modifiedAfter: { type: 'string', description: 'filter[modifiedAfter] — ISO 8601; only devices modified after this time.' },
      filter_notSeenSince: { type: 'string', description: 'filter[notSeenSince] — ISO 8601; only devices not seen since this time.' },
      filter_stateKnown: { type: 'boolean', description: 'When true, returns only devices whose state Auvik has positively identified.' },
      include: { type: 'string', enum: ['deviceDetail'], description: 'Sideload related resources (only "deviceDetail" is supported).' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const devicesGetTool: Tool = {
  name: 'auvik_devices_get',
  description: 'Fetch basic info (name, type, online status, IP addresses) for a single device by ID. (GET /v1/inventory/device/info/{id})',
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
    'Fetch discovery and management detail (SNMP/WMI/login discovery status, manageStatus, connected devices) for a single device; use auvik_devices_get_extended instead for traffic-insight attributes. (GET /v1/inventory/device/detail/{id})',
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
    'List discovery and management detail records for all devices in a tenant, filterable by SNMP/WMI/login discovery status and traffic-insights status; use to audit which devices Auvik can actively monitor. (GET /v1/inventory/device/detail)',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
      filter_manageStatus: { type: 'boolean', description: 'filter[manageStatus] — true=managed.' },
      filter_discoverySNMP: { type: 'string', enum: [...DISCOVERY_STATUSES], description: 'SNMP discovery status for the device (e.g. "discovered", "notDiscovered", "notSupported").' },
      filter_discoveryWMI: { type: 'string', enum: [...DISCOVERY_STATUSES], description: 'WMI discovery status for the device.' },
      filter_discoveryLogin: { type: 'string', enum: [...DISCOVERY_STATUSES], description: 'Login (SSH/Telnet) discovery status for the device.' },
      filter_discoveryVMware: { type: 'string', enum: [...DISCOVERY_STATUSES], description: 'VMware discovery status for the device.' },
      filter_trafficInsightsStatus: {
        type: 'string',
        enum: [...TRAFFIC_INSIGHTS_STATUSES],
        description: 'Traffic insights collection status for the device (e.g. "enabled", "disabled", "notSupported").',
      },
    },
    required: [],
    additionalProperties: false,
  },
};

export const devicesGetExtendedTool: Tool = {
  name: 'auvik_devices_get_extended',
  description: 'Fetch extended detail (traffic insights status, software version, system uptime) for a single device by ID; use when you need attributes beyond what auvik_devices_get_details provides. (GET /v1/inventory/device/detail/extended/{id})',
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
    'List extended device details for all devices of a specific type (filter_deviceType is required by the API); use to bulk-audit traffic-insights status or software versions across a device class. (GET /v1/inventory/device/detail/extended)',
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
  description: 'List warranty and service-coverage records for all devices in a tenant; use to find devices with expired or expiring warranties. (GET /v1/inventory/device/warranty)',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
      filter_coveredUnderWarranty: { type: 'boolean', description: 'When true, return only devices currently under warranty.' },
      filter_coveredUnderService: { type: 'boolean', description: 'When true, return only devices covered by a service contract.' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const devicesGetWarrantyTool: Tool = {
  name: 'auvik_devices_get_warranty',
  description:
    'Fetch warranty and service-coverage info for a single device; returns 404 if no warranty record exists for that device (that is normal, not an error). (GET /v1/inventory/device/warranty/{id})',
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
  description: 'List end-of-life, end-of-sale, and end-of-support records for devices in a tenant; use to identify hardware nearing or past vendor lifecycle milestones. (GET /v1/inventory/device/lifecycle)',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
      filter_salesAvailability: { type: 'string', enum: [...LIFECYCLE_STATUSES], description: 'Sales availability lifecycle status (e.g. "available", "endOfSale", "endOfLife").' },
      filter_softwareMaintenanceStatus: { type: 'string', enum: [...LIFECYCLE_STATUSES], description: 'Software maintenance lifecycle status.' },
      filter_securitySoftwareMaintenanceStatus: { type: 'string', enum: [...LIFECYCLE_STATUSES], description: 'Security software maintenance lifecycle status.' },
      filter_lastSupportStatus: { type: 'string', enum: [...LIFECYCLE_STATUSES], description: 'Last-day-of-support lifecycle status.' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const devicesGetLifecycleTool: Tool = {
  name: 'auvik_devices_get_lifecycle',
  description:
    'Fetch end-of-life and support lifecycle info for a single device; returns 404 if the vendor has no lifecycle data for that device. (GET /v1/inventory/device/lifecycle/{id})',
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
