import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { resolveComputer, resolveComputerGroup, ResolutionError } from '../utils/resolve.js';
import {
  shapeList, shapeItem,
  extractShapeArgs, SHAPE_PROPS,
  toolError, toolErrorFromCatch, withSummary, OS_TYPE_NAME,
  type SummaryFn,
} from './_helpers.js';

// Field names are the live ComputerGetByAllParameters row shape (instance h,
// 2026-09-01). Names only by default; GUIDs and hashes live behind full:true.
const computerSummary: SummaryFn = (item) => ({
  hostname:        item.hostname ?? item.computerName,
  user:            item.username || undefined,
  operatingSystem: typeof item.operatingSystem === 'string' ? item.operatingSystem.trim() : item.operatingSystem,
  group:           item.group ?? item.groupName,
  organization:    item.organization ?? item.organizationName,
  mode:            item.action ?? item.mode,
  lastCheckin:     item.lastCheckin,
  agentVersion:    item.serviceVersion ?? item.threatLockerVersion,
  deniesLast7Days: item.denyCountSevenDays,
  isolated:        item.isIsolated || undefined,
  lockedOut:       item.isLockedOut || undefined,
});

const computerDetail: SummaryFn = (item) => ({
  ...computerSummary(item),
  operatingSystemVersion: item.operatingSystemWithVersion ?? item.operatingSystemVersion,
  makeAndModel:    item.makeAndModel,
  serialNumber:    item.serialNumber,
  lastCheckinIp:   item.lastCheckinIPAddress,
  installDate:     item.installDate ?? item.dateAdded,
  deniesLastDay:   item.denyCountOneDay,
  tamperProtectionDisabled: item.isTamperProtectionDisabled || undefined,
  activeMaintenance: item.activeMaintenanceName || undefined,
  recentUsers:     item.usernames,
});

const checkinSummary: SummaryFn = (item) => ({
  dateTime:        item.dateTime,
  ipAddress:       item.ipAddress,
  agentVersion:    item.tlVersion,
  operatingSystem: item.operatingSystem,
  memoryUsage:     item.memoryUsage !== undefined ? `${item.memoryUsage} ${item.memoryUsageUnit ?? ''}`.trim() : undefined,
});

const HOSTNAME_PROP = { hostname: { type: 'string', description: 'Device hostname as shown in the ThreatLocker portal (case-insensitive). A computer GUID is also accepted.' } };

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_computers_list',
      description: 'List ThreatLocker-managed devices by name. Returns hostname, user, OS, group, organization, mode (Secure/Learning/...), last check-in, agent version and 7-day deny count, plus totalDevices at the top. Filter with search (matches hostname), group name, or mode. No IDs unless full:true.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          search: { type: 'string', description: 'Text matched against hostname / computer name.' },
          group: { type: 'string', description: 'Computer group name (e.g. Workstations), resolved server-side so totalDevices is the group count.' },
          mode: { type: 'string', description: 'Filter by device mode: Secure or Learning (server-side; verified live).' },
          includeChildOrganizations: { type: 'boolean', description: 'Include devices from child organizations (default true).' },
          orderBy: { type: 'string', enum: ['computername', 'group', 'action', 'lastcheckin', 'computerinstalldate', 'deniedcountthreedays', 'threatlockerversion'], description: 'Sort column (default computername).' },
          pageNumber: { type: 'number', description: 'Page number (default 1).' },
          pageSize: { type: 'number', description: 'Rows per page (default 50, max 500).' },
        },
      },
    },
    {
      name: 'threatlocker_computers_get',
      description: 'Get one device by hostname: OS and version, make/model, serial, group, organization, mode, last check-in and IP, deny counts, tamper protection, active maintenance mode, recent users.',
      inputSchema: { type: 'object' as const, properties: { ...SHAPE_PROPS, ...HOSTNAME_PROP }, required: ['hostname'] },
    },
    {
      name: 'threatlocker_computers_get_checkins',
      description: 'Check-in history for a device by hostname: time, IP address, agent version, OS, memory usage. Heartbeats are hidden by default.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS, ...HOSTNAME_PROP,
          includeHeartbeats: { type: 'boolean', description: 'Include heartbeat check-ins (default false).' },
          pageNumber: { type: 'number', description: 'Page number (default 1).' },
          pageSize: { type: 'number', description: 'Rows per page (default 25).' },
        },
        required: ['hostname'],
      },
    },
    {
      name: 'threatlocker_computers_maintenance_modes',
      description: 'Active and scheduled maintenance modes (Learning, Installation, Monitor Only, ...) for a device by hostname, with who started or ended them.',
      inputSchema: { type: 'object' as const, properties: { ...SHAPE_PROPS, ...HOSTNAME_PROP }, required: ['hostname'] },
    },
  ];
}

const maintenanceSummary: SummaryFn = (item) => ({
  type:        item.displayName ?? item.applicationName,
  start:       item.startDateTime,
  end:         item.endDateTime,
  addedBy:     item.addedBy || undefined,
  endedBy:     item.endedBy || undefined,
  triggered:   item.isTriggered || undefined,
  ticket:      item.ticketNumber || undefined,
});

function resolutionResult(toolName: string, err: unknown): CallToolResult | null {
  if (!(err instanceof ResolutionError)) return null;
  return toolError('NOT_FOUND', `${toolName}: ${err.message}`, {
    hint: 'Use threatlocker_computers_list with search:<partial name> to find the exact hostname.',
  });
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);
  const hostname = typeof args.hostname === 'string' ? args.hostname : '';

  switch (toolName) {
    case 'threatlocker_computers_list': {
      const params: Record<string, unknown> = {
        searchText: (args.search as string | undefined) ?? '',
        childOrganizations: (args.includeChildOrganizations as boolean | undefined) ?? true,
        orderBy: args.orderBy as string | undefined,
        pageNumber: args.pageNumber as number | undefined,
        pageSize: Math.min((args.pageSize as number | undefined) ?? 50, 500),
        action: args.mode as string | undefined,
      };
      try {
        const client = await getClient();
        // The DTO wants the group GUID (a name is a 400); resolve it so the
        // filter is server-side and totalDevices is the true group count.
        const groupName = typeof args.group === 'string' ? args.group.trim() : '';
        const group = groupName ? await resolveComputerGroup(client, groupName) : null;
        if (group) params.computerGroup = group.value;
        logger.info('API call: computers.list', params);
        const page = await client.computers.list(params);
        const summary: Record<string, unknown> = { totalDevices: page.total, page: page.page, pageSize: page.pageSize, hasMore: page.hasMore };
        if (group) summary.group = group.label;
        if (params.action) summary.mode = params.action;
        return withSummary(shapeList(page.items, computerSummary, shapeArgs), summary);
      } catch (err) {
        return resolutionResult(toolName, err) ?? toolErrorFromCatch(toolName, err, { hint: 'Call threatlocker_status to confirm the key and instance letter.' });
      }
    }
    case 'threatlocker_computers_get': {
      logger.info('API call: computers.get', { hostname });
      try {
        const client = await getClient();
        const row = await resolveComputer(client, hostname);
        const detail = await client.computers.get(row.computerId);
        return shapeItem({ ...row, ...detail } as Record<string, unknown>, computerDetail, shapeArgs);
      } catch (err) {
        return resolutionResult(toolName, err) ?? toolErrorFromCatch(toolName, err, { hint: 'Verify the hostname with threatlocker_computers_list.' });
      }
    }
    case 'threatlocker_computers_get_checkins': {
      logger.info('API call: computers.getCheckins', { hostname });
      try {
        const client = await getClient();
        const row = await resolveComputer(client, hostname);
        const page = await client.computers.getCheckins({
          computerId: row.computerId,
          pageNumber: args.pageNumber as number | undefined,
          pageSize: args.pageSize as number | undefined,
          hideHeartbeat: !(args.includeHeartbeats === true),
        });
        return withSummary(shapeList(page.items, checkinSummary, shapeArgs), { hostname: row.hostname ?? hostname, checkinsOnPage: page.items.length });
      } catch (err) {
        return resolutionResult(toolName, err) ?? toolErrorFromCatch(toolName, err, { hint: 'Verify the hostname with threatlocker_computers_list.' });
      }
    }
    case 'threatlocker_computers_maintenance_modes': {
      logger.info('API call: computers.getMaintenanceModes', { hostname });
      try {
        const client = await getClient();
        const row = await resolveComputer(client, hostname);
        const modes = await client.computers.getMaintenanceModes(row.computerId);
        return withSummary(shapeList(modes, maintenanceSummary, shapeArgs), { hostname: row.hostname ?? hostname, maintenanceModes: modes.length });
      } catch (err) {
        return resolutionResult(toolName, err) ?? toolErrorFromCatch(toolName, err, { hint: 'Verify the hostname with threatlocker_computers_list.' });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export { OS_TYPE_NAME };
export const computersHandler: DomainHandler = { getTools, handleCall };
