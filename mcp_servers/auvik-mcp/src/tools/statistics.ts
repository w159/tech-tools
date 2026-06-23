import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClient,
  shapeRaw,
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

// fromTime + interval are always required by Auvik. thruTime is documented as
// optional but is required at runtime, so we require it too to avoid a 400.
const timeProps = {
  fromTime: { type: 'string', description: 'Window start, ISO 8601 UTC (e.g. 2026-05-26T00:00:00.000Z). Sent as filter[fromTime]. Required.' },
  thruTime: { type: 'string', description: 'Window end, ISO 8601 UTC. Sent as filter[thruTime]. Required in practice.' },
  interval: { type: 'string', enum: [...STAT_INTERVALS], description: 'Sampling interval. Sent as filter[interval]. Required.' },
} as const;

export const statisticsDeviceTool: Tool = {
  name: 'auvik_statistics_device',
  description: 'Fetch time-series device metrics (CPU utilization, memory, interface traffic, etc.) over a time window; omit deviceId to aggregate across all in-scope devices. Requires statId, fromTime, thruTime, and interval. (GET /v1/stat/device/{statId})',
  inputSchema: {
    type: 'object',
    properties: {
      statId: { type: 'string', enum: [...DEVICE_STAT_IDS], description: 'Device metric to read, used as the URL path segment (e.g. "cpu", "memory", "disk").' },
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
  description: 'Fetch device uptime or outage duration time-series over a window; use for availability reporting or SLA calculations. Requires statId (uptime or outage), fromTime, thruTime, and interval. (GET /v1/stat/deviceAvailability/{statId})',
  inputSchema: {
    type: 'object',
    properties: {
      statId: { type: 'string', enum: [...DEVICE_AVAILABILITY_STAT_IDS], description: 'Availability metric to read: "uptime" (seconds online) or "outage" (seconds offline), used as URL path segment.' },
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
  description: 'Fetch time-series interface metrics (traffic, errors, utilization) over a window; omit interfaceId to aggregate across all in-scope interfaces. Requires statId, fromTime, thruTime, and interval. (GET /v1/stat/interface/{statId})',
  inputSchema: {
    type: 'object',
    properties: {
      statId: { type: 'string', enum: [...INTERFACE_STAT_IDS], description: 'Interface metric to read, used as the URL path segment (e.g. "inOctets", "outOctets", "inErrors").' },
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
  description: 'Fetch time-series service-monitor ping metrics (round-trip time or packet loss) over a window; use to assess reachability trends for monitored services. Requires statId (pingTime or pingPacket), fromTime, thruTime, and interval. (GET /v1/stat/service/{statId})',
  inputSchema: {
    type: 'object',
    properties: {
      statId: { type: 'string', enum: [...SERVICE_STAT_IDS], description: 'Ping metric to read as the URL path segment: "pingTime" (round-trip latency) or "pingPacket" (packet loss rate).' },
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
    'Fetch time-series metrics for a hardware component type (cpu, disk, fan, memory, powerSupply, etc.) over a window; both componentType and statId are required and must be a valid combination — a 400 response lists valid statIds for that type. (GET /v1/stat/component/{componentType}/{statId})',
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
  description: 'Fetch SNMP OID monitor statistics for devices (statId must be "deviceMonitor"); use to read custom SNMP polling results, optionally filtered by device or specific OID value. (GET /v1/stat/oid/{statId})',
  inputSchema: {
    type: 'object',
    properties: {
      statId: { type: 'string', enum: [...OID_STAT_IDS], description: 'OID stat type used as URL path segment; the only supported value is "deviceMonitor".' },
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
