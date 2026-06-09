import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClient,
  shapeRaw,
  toolErrorFromCatch,
  missingCredsError,
  tenantsProp,
  pageProps,
  STAT_INTERVALS,
  DEVICE_STAT_IDS,
  DEVICE_AVAILABILITY_STAT_IDS,
  SERVICE_STAT_IDS,
  INTERFACE_STAT_IDS,
  COMPONENT_TYPES,
  COMPONENT_STAT_IDS,
  OID_STAT_IDS,
  DEVICE_TYPES,
  INTERFACE_TYPES,
} from './shared.js';
import { getCredentials } from '../credentials.js';
import { createAuvikClient } from '../client-factory.js';

// fromTime + interval are always required by Auvik. thruTime is documented as
// optional but is required at runtime, so we require it too to avoid a 400.
const timeProps = {
  fromTime: { type: 'string', description: 'Window start, ISO 8601 UTC (e.g. 2026-05-26T00:00:00.000Z). Sent as filter[fromTime]. Required.' },
  thruTime: { type: 'string', description: 'Window end, ISO 8601 UTC. Sent as filter[thruTime]. Required in practice.' },
  interval: { type: 'string', enum: [...STAT_INTERVALS], description: 'Sampling interval. Sent as filter[interval]. Required.' },
} as const;

export const statisticsDeviceTool: Tool = {
  name: 'auvik_statistics_device',
  description: 'GET /v1/stat/device/{statId} — device time-series metrics. Omit deviceId to get the metric across all devices in scope.',
  inputSchema: {
    type: 'object',
    properties: {
      statId: { type: 'string', enum: [...DEVICE_STAT_IDS], description: 'Which device metric to read (path segment).' },
      ...timeProps,
      deviceId: { type: 'string', description: 'Optional single device ID. Sent as filter[deviceId].' },
      filter_deviceType: { type: 'string', enum: [...DEVICE_TYPES], description: 'Optional filter[deviceType] to scope by device type.' },
      ...tenantsProp,
      ...pageProps,
    },
    required: ['statId', 'fromTime', 'thruTime', 'interval'],
    additionalProperties: false,
  },
};

export const statisticsDeviceAvailabilityTool: Tool = {
  name: 'auvik_statistics_device_availability',
  description: 'GET /v1/stat/deviceAvailability/{statId} — device uptime/outage time-series.',
  inputSchema: {
    type: 'object',
    properties: {
      statId: { type: 'string', enum: [...DEVICE_AVAILABILITY_STAT_IDS], description: 'uptime or outage (path segment).' },
      ...timeProps,
      deviceId: { type: 'string', description: 'Optional single device ID. Sent as filter[deviceId].' },
      filter_deviceType: { type: 'string', enum: [...DEVICE_TYPES], description: 'Optional filter[deviceType].' },
      ...tenantsProp,
      ...pageProps,
    },
    required: ['statId', 'fromTime', 'thruTime', 'interval'],
    additionalProperties: false,
  },
};

export const statisticsInterfaceTool: Tool = {
  name: 'auvik_statistics_interface',
  description: 'GET /v1/stat/interface/{statId} — interface time-series metrics. Omit interfaceId to read across interfaces in scope.',
  inputSchema: {
    type: 'object',
    properties: {
      statId: { type: 'string', enum: [...INTERFACE_STAT_IDS], description: 'Which interface metric to read (path segment).' },
      ...timeProps,
      interfaceId: { type: 'string', description: 'Optional single interface ID. Sent as filter[interfaceId].' },
      filter_interfaceType: { type: 'string', enum: [...INTERFACE_TYPES], description: 'Optional filter[interfaceType].' },
      filter_parentDevice: { type: 'string', description: 'Optional filter[parentDevice] — parent device ID.' },
      ...tenantsProp,
      ...pageProps,
    },
    required: ['statId', 'fromTime', 'thruTime', 'interval'],
    additionalProperties: false,
  },
};

export const statisticsServiceTool: Tool = {
  name: 'auvik_statistics_service',
  description: 'GET /v1/stat/service/{statId} — service-monitor ping metrics (pingTime, pingPacket).',
  inputSchema: {
    type: 'object',
    properties: {
      statId: { type: 'string', enum: [...SERVICE_STAT_IDS], description: 'pingTime or pingPacket (path segment).' },
      ...timeProps,
      serviceId: { type: 'string', description: 'Optional single service ID. Sent as filter[serviceId].' },
      ...tenantsProp,
      ...pageProps,
    },
    required: ['statId', 'fromTime', 'thruTime', 'interval'],
    additionalProperties: false,
  },
};

export const statisticsComponentTool: Tool = {
  name: 'auvik_statistics_component',
  description:
    'GET /v1/stat/component/{componentType}/{statId} — component time-series metrics. Both path segments are required. Valid statId depends on componentType (e.g. fan→speed, powerSupply→power, cpu→idle/temperature); not every statId is valid for every type. If the combination is wrong, the API responds 400 and lists the valid statIds for that componentType — retry with one of those.',
  inputSchema: {
    type: 'object',
    properties: {
      componentType: { type: 'string', enum: [...COMPONENT_TYPES], description: 'Component class (path segment): cpu, disk, fan, memory, powerSupply, etc.' },
      statId: { type: 'string', enum: [...COMPONENT_STAT_IDS], description: 'Which component metric (path segment): temperature, power, utilization, etc.' },
      ...timeProps,
      componentId: { type: 'string', description: 'Optional single component ID. Sent as filter[componentId].' },
      filter_parentDevice: { type: 'string', description: 'Optional filter[parentDevice] — parent device ID.' },
      ...tenantsProp,
      ...pageProps,
    },
    required: ['componentType', 'statId', 'fromTime', 'thruTime', 'interval'],
    additionalProperties: false,
  },
};

export const statisticsOidTool: Tool = {
  name: 'auvik_statistics_oid',
  description: 'GET /v1/stat/oid/{statId} — SNMP OID monitor statistics (statId is "deviceMonitor"). Not a time-series; filter by device and/or OID.',
  inputSchema: {
    type: 'object',
    properties: {
      statId: { type: 'string', enum: [...OID_STAT_IDS], description: 'OID stat type (path segment); only "deviceMonitor".' },
      deviceId: { type: 'string', description: 'Optional filter[deviceId].' },
      filter_deviceType: { type: 'string', enum: [...DEVICE_TYPES], description: 'Optional filter[deviceType].' },
      filter_oid: { type: 'string', description: 'Optional filter[oid] — a specific OID string.' },
      ...tenantsProp,
      ...pageProps,
    },
    required: ['statId'],
    additionalProperties: false,
  },
};

type StatArgs = {
  fromTime?: string;
  thruTime?: string;
  interval?: string;
  tenants?: string;
  pageSize?: number;
  pageAfter?: string;
  pageBefore?: string;
};

// Build the JSON:API params common to time-series stats. id filters are passed
// individually because their filter key differs per endpoint.
const timeParams = (a: StatArgs, extra: Record<string, unknown>) => ({
  tenants: a.tenants,
  pageSize: a.pageSize,
  pageAfter: a.pageAfter,
  pageBefore: a.pageBefore,
  filter_fromTime: a.fromTime,
  filter_thruTime: a.thruTime,
  filter_interval: a.interval,
  ...extra,
});

// Statistics endpoints return time-series data (arrays of numeric samples per
// device), not inventory items with stable summary fields. Use shapeRaw to
// enforce the char cap without imposing a summary that would strip the data.
export const handleStatisticsDevice = (
  a: StatArgs & { statId: string; deviceId?: string; filter_deviceType?: string }
) =>
  withClient(async (c) =>
    shapeRaw(await c.statistics.device(a.statId, timeParams(a, { filter_deviceId: a.deviceId, filter_deviceType: a.filter_deviceType })))
  );

export const handleStatisticsDeviceAvailability = (
  a: StatArgs & { statId: string; deviceId?: string; filter_deviceType?: string }
) =>
  withClient(async (c) =>
    shapeRaw(await c.statistics.deviceAvailability(
      a.statId,
      timeParams(a, { filter_deviceId: a.deviceId, filter_deviceType: a.filter_deviceType })
    ))
  );

export const handleStatisticsInterface = (
  a: StatArgs & { statId: string; interfaceId?: string; filter_interfaceType?: string; filter_parentDevice?: string }
) =>
  withClient(async (c) =>
    shapeRaw(await c.statistics.interface(
      a.statId,
      timeParams(a, {
        filter_interfaceId: a.interfaceId,
        filter_interfaceType: a.filter_interfaceType,
        filter_parentDevice: a.filter_parentDevice,
      })
    ))
  );

export const handleStatisticsService = (a: StatArgs & { statId: string; serviceId?: string }) =>
  withClient(async (c) =>
    shapeRaw(await c.statistics.service(a.statId, timeParams(a, { filter_serviceId: a.serviceId })))
  );

export const handleStatisticsComponent = (
  a: StatArgs & { componentType: string; statId: string; componentId?: string; filter_parentDevice?: string }
) =>
  withClient(async (c) =>
    shapeRaw(await c.statistics.component(
      a.componentType,
      a.statId,
      timeParams(a, { filter_componentId: a.componentId, filter_parentDevice: a.filter_parentDevice })
    ))
  );

export const handleStatisticsOid = (a: {
  statId: string;
  deviceId?: string;
  filter_deviceType?: string;
  filter_oid?: string;
  tenants?: string;
  pageSize?: number;
  pageAfter?: string;
  pageBefore?: string;
}) =>
  withClient(async (c) =>
    shapeRaw(await c.statistics.oid(a.statId, {
      tenants: a.tenants,
      pageSize: a.pageSize,
      pageAfter: a.pageAfter,
      pageBefore: a.pageBefore,
      filter_deviceId: a.deviceId,
      filter_deviceType: a.filter_deviceType,
      filter_oid: a.filter_oid,
    }))
  );
