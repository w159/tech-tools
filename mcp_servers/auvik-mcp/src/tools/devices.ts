import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClient,
  tenantsProp,
  pageProps,
  DEVICE_TYPES,
  ONLINE_STATUSES,
  DISCOVERY_STATUSES,
  TRAFFIC_INSIGHTS_STATUSES,
  LIFECYCLE_STATUSES,
} from './shared.js';

export const devicesListTool: Tool = {
  name: 'auvik_devices_list',
  description:
    'GET /v1/inventory/device/info — list Auvik-managed devices (basic info). JSON:API; paginate by passing the page[after] cursor from links.next into pageAfter, or call auvik_navigate with links.next.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
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
  description: 'GET /v1/inventory/device/info/{id} — single device basic info.',
  inputSchema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string', description: 'Auvik device ID from a list call.' },
      include: { type: 'string', enum: ['deviceDetail'], description: 'Sideload "deviceDetail".' },
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
    properties: { deviceId: { type: 'string', description: 'Auvik device ID.' } },
    required: ['deviceId'],
    additionalProperties: false,
  },
};

export const devicesListDetailsTool: Tool = {
  name: 'auvik_devices_list_details',
  description:
    'GET /v1/inventory/device/detail — list extended device detail records (discovery + manage status) across a tenant, filterable by discovery/traffic-insight status.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
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
  description: 'GET /v1/inventory/device/detail/extended/{id} — single device extended detail (traffic insights, deep attributes).',
  inputSchema: {
    type: 'object',
    properties: { deviceId: { type: 'string', description: 'Auvik device ID.' } },
    required: ['deviceId'],
    additionalProperties: false,
  },
};

export const devicesListExtendedTool: Tool = {
  name: 'auvik_devices_list_extended',
  description:
    'GET /v1/inventory/device/detail/extended — list extended device details. filter[deviceType] is REQUIRED by this endpoint.',
  inputSchema: {
    type: 'object',
    properties: {
      filter_deviceType: { type: 'string', enum: [...DEVICE_TYPES], description: 'filter[deviceType] (REQUIRED).' },
      ...tenantsProp,
      ...pageProps,
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
  description: 'GET /v1/inventory/device/warranty — list device warranty/service-coverage records for a tenant.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
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
    'GET /v1/inventory/device/warranty/{id} — warranty info for one device. Returns 404 if the device has no warranty record (not an error in the endpoint).',
  inputSchema: {
    type: 'object',
    properties: { deviceId: { type: 'string', description: 'Auvik device ID.' } },
    required: ['deviceId'],
    additionalProperties: false,
  },
};

export const devicesListLifecycleTool: Tool = {
  name: 'auvik_devices_list_lifecycle',
  description: 'GET /v1/inventory/device/lifecycle — list device end-of-life / end-of-sale / end-of-support records for a tenant.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
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
    'GET /v1/inventory/device/lifecycle/{id} — lifecycle info for one device. Returns 404 if the device has no lifecycle record.',
  inputSchema: {
    type: 'object',
    properties: { deviceId: { type: 'string', description: 'Auvik device ID.' } },
    required: ['deviceId'],
    additionalProperties: false,
  },
};

type ListArgs = Record<string, unknown>;

export const handleDevicesList = (args: ListArgs) => withClient((c) => c.devices.list(args));
export const handleDevicesGet = (args: { deviceId: string; include?: string }) =>
  withClient((c) => c.devices.get(args.deviceId, { include: args.include }));
export const handleDevicesGetDetails = (args: { deviceId: string }) =>
  withClient((c) => c.devices.getDetail(args.deviceId));
export const handleDevicesListDetails = (args: ListArgs) => withClient((c) => c.devices.listDetail(args));
export const handleDevicesGetExtended = (args: { deviceId: string }) =>
  withClient((c) => c.devices.getExtended(args.deviceId));
export const handleDevicesListExtended = (args: ListArgs) => withClient((c) => c.devices.listExtended(args));
export const handleDevicesListWarranty = (args: ListArgs) => withClient((c) => c.devices.listWarranty(args));
export const handleDevicesGetWarranty = (args: { deviceId: string }) =>
  withClient((c) => c.devices.getWarranty(args.deviceId));
export const handleDevicesListLifecycle = (args: ListArgs) => withClient((c) => c.devices.listLifecycle(args));
export const handleDevicesGetLifecycle = (args: { deviceId: string }) =>
  withClient((c) => c.devices.getLifecycle(args.deviceId));
