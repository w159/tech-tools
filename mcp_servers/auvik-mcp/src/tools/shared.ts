import { getCredentials, type AuvikCredentials } from '../credentials.js';
import { createAuvikClient, type AuvikClient, type JsonApiResponse, type JsonApiResource } from '../client-factory.js';
import {
  shapeList,
  shapeItem,
  shapeRaw,
  extractShapeArgs,
  SHAPE_PROPS,
  type SummaryFn,
  type ToolResult,
  type ShapeArgs,
} from '../../../_shared/response-shaper.js';
import {
  toolErrorFromCatch,
  missingCredsError,
  toolError,
  type ErrorCode,
  type ErrorContext,
} from '../../../_shared/error-envelope.js';

// Re-export for convenience so tool files only import from './shared.js'.
export type { ToolResult, SummaryFn, ShapeArgs };
export { shapeList, shapeItem, shapeRaw, extractShapeArgs, SHAPE_PROPS };
export { toolError, toolErrorFromCatch, missingCredsError };
export type { ErrorCode, ErrorContext };

// ---------------------------------------------------------------------------
// JSON:API helpers
// ---------------------------------------------------------------------------

// Auvik uses JSON:API: list results arrive as { data: JsonApiResource[] }.
// A flattened item merges { id, type } with attributes so summary fns can
// use flat field paths like item.deviceName rather than item.attributes.deviceName.
export type FlatResource = Record<string, unknown> & { id: string; _type: string };

/**
 * Flatten a single JSON:API resource into a plain object suitable for shapeList/shapeItem.
 * Spreads attributes onto the top level; preserves `id` and stashes `type` as `_type`.
 * Relationships are kept as-is under `relationships` for callers that need them.
 */
export function flattenResource(r: JsonApiResource): FlatResource {
  return {
    id: r.id,
    _type: r.type,
    ...(r.attributes ?? {}),
    relationships: r.relationships,
  } as FlatResource;
}

/**
 * Extract and flatten the data array from a JSON:API list response.
 * Returns [] if data is missing or not an array (e.g. empty-body 200).
 */
export function flattenList(resp: JsonApiResponse): FlatResource[] {
  const data = resp.data;
  if (!Array.isArray(data)) return [];
  return data.map(flattenResource);
}

/**
 * Extract and flatten a single-item JSON:API response.
 * Returns null if data is null or not an object.
 */
export function flattenItem(resp: JsonApiResponse): FlatResource | null {
  const data = resp.data;
  if (!data || Array.isArray(data)) return null;
  return flattenResource(data as JsonApiResource);
}

// ---------------------------------------------------------------------------
// withClient variants
// ---------------------------------------------------------------------------

/**
 * Runs fn(client, creds) and returns its ToolResult directly.
 * The fn is responsible for shaping; use withClientList/withClientItem for
 * the common list/get cases. Used by status and navigate which handle their
 * own serialization.
 */
export async function withClient(
  fn: (client: AuvikClient, creds: AuvikCredentials) => Promise<ToolResult>
): Promise<ToolResult> {
  const creds = getCredentials();
  if (!creds) return missingCredsError('Auvik', ['AUVIK_USERNAME', 'AUVIK_API_KEY']);
  try {
    return await fn(createAuvikClient(creds), creds);
  } catch (e) {
    return toolErrorFromCatch('auvik', e);
  }
}

/**
 * List tool helper: fetches a JSON:API list, flattens, shapes, and enforces
 * the char cap. Callers pass the summary function + shape args from the tool
 * input. The pagination hint is auto-built from links.next when present.
 */
export async function withClientList(
  apiFn: (client: AuvikClient, creds: AuvikCredentials) => Promise<JsonApiResponse>,
  summaryFn: SummaryFn<FlatResource>,
  args: ShapeArgs,
  toolName: string,
  hint?: string
): Promise<ToolResult> {
  const creds = getCredentials();
  if (!creds) return missingCredsError('Auvik', ['AUVIK_USERNAME', 'AUVIK_API_KEY']);
  try {
    const resp = await apiFn(createAuvikClient(creds), creds);
    const items = flattenList(resp);
    const paginationHint =
      hint ??
      (resp.links?.next
        ? `Pass pageAfter cursor from links.next, or call auvik_navigate with links.next="${resp.links.next}".`
        : undefined);
    return shapeList(items, summaryFn, args, undefined, paginationHint);
  } catch (e) {
    return toolErrorFromCatch(toolName, e);
  }
}

/**
 * Get/detail tool helper: fetches a single JSON:API resource, flattens,
 * shapes, and enforces the char cap.
 */
export async function withClientItem(
  apiFn: (client: AuvikClient, creds: AuvikCredentials) => Promise<JsonApiResponse>,
  summaryFn: SummaryFn<FlatResource>,
  args: ShapeArgs,
  toolName: string
): Promise<ToolResult> {
  const creds = getCredentials();
  if (!creds) return missingCredsError('Auvik', ['AUVIK_USERNAME', 'AUVIK_API_KEY']);
  try {
    const resp = await apiFn(createAuvikClient(creds), creds);
    const item = flattenItem(resp);
    if (!item) return shapeRaw(resp);
    return shapeItem(item, summaryFn, args);
  } catch (e) {
    return toolErrorFromCatch(toolName, e);
  }
}

// ---------------------------------------------------------------------------
// Reusable JSON-schema fragments shared across tools.
// ---------------------------------------------------------------------------

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
