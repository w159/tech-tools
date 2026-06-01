import { getCredentials, type AuvikCredentials } from '../credentials.js';
import { createAuvikClient, type AuvikClient } from '../client-factory.js';
import { toMcpError } from '../errors.js';

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

export const noCreds = (): ToolResult => ({
  content: [
    {
      type: 'text',
      text: 'No Auvik credentials configured. Set AUVIK_USERNAME and AUVIK_API_KEY (and optionally AUVIK_REGION).',
    },
  ],
  isError: true,
});

export const ok = (r: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(r, null, 2) }],
});

export const fail = (e: unknown): ToolResult => {
  const m = toMcpError(e);
  return { content: [{ type: 'text', text: m.message }], isError: true };
};

// Runs `fn(client)` with resolved credentials, mapping the common no-creds /
// error paths so every handler stays a one-liner.
export async function withClient(fn: (client: AuvikClient, creds: AuvikCredentials) => Promise<unknown>): Promise<ToolResult> {
  const creds = getCredentials();
  if (!creds) return noCreds();
  try {
    return ok(await fn(createAuvikClient(creds), creds));
  } catch (e) {
    return fail(e);
  }
}

// Reusable JSON-schema fragments shared across tools.
export const tenantsProp = {
  tenants: {
    type: 'string',
    description:
      'Optional comma-separated Auvik tenant IDs to scope the query. Omit to query across every tenant the credentials can see. Tenant IDs come from auvik_tenants_list.',
  },
} as const;

export const pageProps = {
  pageSize: { type: 'number', description: 'Items per page (page[first]). 1–1000.' },
  pageAfter: { type: 'string', description: 'Forward cursor from a prior response links.next (page[after]).' },
  pageBefore: { type: 'string', description: 'Backward cursor (page[before]).' },
} as const;

// Canonical enums, extracted from the live OpenAPI spec (/spec).
export const DEVICE_TYPES = [
  'unknown', 'switch', 'l3Switch', 'router', 'accessPoint', 'firewall', 'workstation', 'server',
  'storage', 'printer', 'copier', 'hypervisor', 'multimedia', 'phone', 'tablet', 'handheld',
  'virtualAppliance', 'bridge', 'controller', 'hub', 'modem', 'ups', 'module', 'loadBalancer',
  'camera', 'telecommunications', 'packetProcessor', 'chassis', 'airConditioner', 'virtualMachine',
  'pdu', 'ipPhone', 'backhaul', 'internetOfThings', 'voipSwitch', 'stack', 'backupDevice',
  'timeClock', 'lightingDevice', 'audioVisual', 'securityAppliance', 'utm', 'alarm',
  'buildingManagement', 'ipmi', 'thinAccessPoint', 'thinClient', 'subnet',
] as const;

export const ONLINE_STATUSES = [
  'online', 'offline', 'unreachable', 'testing', 'unknown', 'dormant', 'notPresent', 'lowerLayerDown',
] as const;

export const INTERFACE_TYPES = [
  'ethernet', 'wifi', 'bluetooth', 'cdma', 'coax', 'cpu', 'distributedVirtualSwitch', 'firewire',
  'gsm', 'ieee8023AdLag', 'inferredWired', 'inferredWireless', 'interface', 'linkAggregation',
  'loopback', 'modem', 'wimax', 'optical', 'other', 'parallel', 'ppp', 'radiomac', 'rs232',
  'tunnel', 'unknown', 'usb', 'virtualBridge', 'virtualNic', 'virtualSwitch', 'vlan',
] as const;

export const NETWORK_TYPES = ['routed', 'vlan', 'wifi', 'loopback', 'network', 'layer2', 'internet'] as const;
export const NETWORK_SCAN_STATUSES = ['true', 'false', 'notAllowed', 'unknown'] as const;
export const NETWORK_SCOPES = ['private', 'public'] as const;

export const ALERT_SEVERITIES = ['unknown', 'emergency', 'critical', 'warning', 'info'] as const;
export const ALERT_STATUSES = ['created', 'resolved', 'paused', 'unpaused'] as const;

export const DISCOVERY_STATUSES = [
  'disabled', 'determining', 'notSupported', 'notAuthorized', 'authorizing', 'authorized', 'privileged',
] as const;
export const TRAFFIC_INSIGHTS_STATUSES = [
  'notDetected', 'detected', 'notApproved', 'approved', 'linking', 'linkingFailed', 'forwarding',
] as const;
export const LIFECYCLE_STATUSES = ['covered', 'available', 'expired', 'securityOnly', 'unpublished', 'empty'] as const;
export const COMPONENT_CURRENT_STATUSES = ['ok', 'degraded', 'failed'] as const;
export const ENTITY_TYPES = ['root', 'device', 'network', 'interface'] as const;
export const ENTITY_AUDIT_CATEGORIES = ['unknown', 'tunnel', 'terminal', 'remoteBrowser'] as const;
export const ENTITY_AUDIT_STATUSES = ['unknown', 'initiated', 'created', 'closed', 'failed'] as const;

export const STAT_INTERVALS = ['minute', 'hour', 'day'] as const;
export const DEVICE_STAT_IDS = [
  'bandwidth', 'cpuUtilization', 'memoryUtilization', 'storageUtilization',
  'packetUnicast', 'packetMulticast', 'packetBroadcast',
] as const;
export const DEVICE_AVAILABILITY_STAT_IDS = ['uptime', 'outage'] as const;
export const SERVICE_STAT_IDS = ['pingTime', 'pingPacket'] as const;
export const INTERFACE_STAT_IDS = [
  'bandwidth', 'utilization', 'packetLoss', 'packetDiscard', 'packetMulticast', 'packetUnicast', 'packetBroadcast',
] as const;
export const COMPONENT_TYPES = ['cpu', 'cpuCore', 'disk', 'fan', 'memory', 'powerSupply', 'systemBoard'] as const;
export const COMPONENT_STAT_IDS = [
  'capacity', 'counters', 'idle', 'latency', 'power', 'queueLatency', 'rate', 'readiness',
  'ready', 'speed', 'swap', 'swapRate', 'temperature', 'totalLatency', 'utilization',
] as const;
export const OID_STAT_IDS = ['deviceMonitor'] as const;
