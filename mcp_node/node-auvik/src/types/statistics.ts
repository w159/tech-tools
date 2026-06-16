export interface StatisticsOptions {
  fromTime: string;
  thruTime?: string;
  /** Sampling interval: "minute" | "hour" | "day". Required by the Auvik API. */
  interval?: string;
  /** Comma-separated tenant IDs (sent as the `tenants` query param). */
  tenants?: string;
  /** @deprecated use `tenants`. Kept for backward compatibility. */
  tenantId?: string;
  /** Extra filter[...] params already keyed (e.g. { "filter[deviceId]": "..." }). */
  filters?: Record<string, string>;
  [key: string]: unknown;
}

export interface DeviceStatistics {
  id: string;
  deviceId?: string;
  timestamp?: string;
  cpuUtilization?: number;
  memoryUtilization?: number;
  diskUtilization?: number;
  uptimeSeconds?: number;
  temperature?: number;
  powerConsumption?: number;
}

export interface InterfaceStatistics {
  id: string;
  interfaceId?: string;
  deviceId?: string;
  timestamp?: string;
  rxBytesPerSecond?: number;
  txBytesPerSecond?: number;
  rxPacketsPerSecond?: number;
  txPacketsPerSecond?: number;
  utilization?: number;
  errors?: number;
  discards?: number;
}

export interface ServiceStatistics {
  id: string;
  serviceId?: string;
  deviceId?: string;
  timestamp?: string;
  responseTime?: number;
  availability?: number;
  packetLoss?: number;
}

export interface ComponentStatistics {
  id: string;
  componentId?: string;
  deviceId?: string;
  timestamp?: string;
  status?: string;
  value?: number;
  threshold?: number;
}

export interface SnmpPollerStatistics {
  id: string;
  pollerId?: string;
  deviceId?: string;
  timestamp?: string;
  polledValue?: number;
  oid?: string;
  status?: string;
}