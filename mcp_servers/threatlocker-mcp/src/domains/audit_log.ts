import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { resolveComputer, ResolutionError } from '../utils/resolve.js';
import {
  shapeList, shapeItem,
  extractShapeArgs, SHAPE_PROPS,
  toolError, toolErrorFromCatch, withSummary, toPortalDate,
  type SummaryFn,
} from './_helpers.js';

// Live ActionLogGetByParametersV2 row shape (instance h, 2026-09-01).
const auditSummary: SummaryFn = (item) => ({
  time:         item.dateTime,
  hostname:     item.hostname,
  user:         item.username || undefined,
  action:       item.action ?? undefined,  // Permit / Deny; null on "os event log" rows
  actionType:   item.actionType,           // execute / install / network / read / write / os event log ...
  application:  item.applicationName || undefined,
  policy:       item.policyName || undefined,
  path:         item.fullPath || undefined,
  process:      item.processPath || undefined,
  organization: item.organizationName || undefined,
});

const auditDetail: SummaryFn = (item) => ({
  ...auditSummary(item),
  policyLocation:   item.policyLocation || undefined,
  parentProcess:    item.parentProcessName || undefined,
  createdByProcess: item.createdByProcess || undefined,
  sha256:           item.sha256Hash || undefined,
  fileSize:         item.size,
  certificate:      typeof item.cert === 'string' ? item.cert.slice(0, 200) : undefined,
  threatSeverity:   item.threatSeverityLevel || undefined,
  notes:            item.notes || undefined,
});

// KB: actionId 99 = "Any Deny". actionId 1 = Permit (live sample row).
const ACTION_ID: Record<string, number> = { permit: 1, deny: 99 };

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_audit_search',
      description: 'Search the Unified Audit by name: filter by hostname, user, action (Permit or Deny), actionType (execute, install, network, read, write, ...), exact file path, application, or policy; time window defaults to the last 24 hours. Returns time, device, user, action, application, policy, path. Use contains for a substring match on the fetched page.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          hostname: { type: 'string', description: 'Only events from this device.' },
          username: { type: 'string', description: 'Only events for this user; the account name alone (e.g. jsmith) or DOMAIN\\user.' },
          action: { type: 'string', enum: ['Permit', 'Deny'], description: 'Permit or Deny (Deny covers every deny type).' },
          actionType: { type: 'string', description: 'execute, install, network, read, write, move, delete, elevate, ...' },
          path: { type: 'string', description: 'Exact full file path as ThreatLocker logs it (server-side; ThreatLocker has no substring filter).' },
          application: { type: 'string', description: 'Exact application name as ThreatLocker logs it (server-side).' },
          policy: { type: 'string', description: 'Exact policy name (server-side).' },
          contains: { type: 'string', description: 'Substring matched against path, application, policy, and process on the fetched page (client-side; raise pageSize to widen it).' },
          hours: { type: 'number', description: 'Look back this many hours from now (default 24). Ignored when startDate is given.' },
          startDate: { type: 'string', description: 'ISO 8601 start, UTC.' },
          endDate: { type: 'string', description: 'ISO 8601 end, UTC (default now).' },
          includeChildOrganizations: { type: 'boolean', description: 'Include child organizations (default false).' },
          pageNumber: { type: 'number', description: 'Page number (default 1).' },
          pageSize: { type: 'number', description: 'Rows per page (default 50, max 10000).' },
        },
      },
    },
    {
      name: 'threatlocker_audit_get',
      description: 'Full detail of one audit event (hash, certificate, parent process, policy location) by its auditEntryId from full:true output of threatlocker_audit_search.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          auditEntryId: { type: 'string', description: 'The eActionLogId GUID of the event.' },
          sourceTableId: { type: 'number', description: 'sourceTableId from the same event (default 1).' },
        },
        required: ['auditEntryId'],
      },
    },
    {
      name: 'threatlocker_audit_file_history',
      description: 'Every recorded event for one file on one device: hostname plus full path (e.g. C:\\Windows\\System32\\cmd.exe).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          hostname: { type: 'string', description: 'Device hostname.' },
          fullPath: { type: 'string', description: 'Absolute file path exactly as ThreatLocker logs it.' },
          pageNumber: { type: 'number', description: 'Page number (default 1).' },
          pageSize: { type: 'number', description: 'Rows per page (default 25).' },
        },
        required: ['hostname', 'fullPath'],
      },
    },
  ];
}

function timeWindow(args: Record<string, unknown>): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = toPortalDate(typeof args.endDate === 'string' ? args.endDate : now);
  if (typeof args.startDate === 'string') return { startDate: toPortalDate(args.startDate), endDate };
  const hours = typeof args.hours === 'number' && args.hours > 0 ? args.hours : 24;
  return { startDate: toPortalDate(new Date(new Date(endDate).getTime() - hours * 3600_000)), endDate };
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case 'threatlocker_audit_search': {
      let window: { startDate: string; endDate: string };
      try { window = timeWindow(args); }
      catch (err) { return toolError('INVALID_ARGS', (err as Error).message, { hint: 'Use ISO 8601, e.g. 2026-09-01T00:00:00Z.' }); }
      const action = typeof args.action === 'string' ? args.action.toLowerCase() : '';
      if (action && ACTION_ID[action] === undefined) return toolError('INVALID_ARGS', `action must be Permit or Deny, got "${args.action}".`);
      const params = {
        ...window,
        hostname: args.hostname as string | undefined,
        username: args.username as string | undefined,
        fullPath: args.path as string | undefined,
        applicationName: args.application as string | undefined,
        policyName: args.policy as string | undefined,
        actionType: args.actionType as string | undefined,
        actionId: action ? ACTION_ID[action] : undefined,
        showChildOrganizations: (args.includeChildOrganizations as boolean | undefined) ?? false,
        pageNumber: args.pageNumber as number | undefined,
        pageSize: Math.min((args.pageSize as number | undefined) ?? 50, 10000),
      };
      logger.info('API call: auditLog.search', params);
      try {
        const client = await getClient();
        const page = await client.auditLog.search(params);
        let items = page.items as Record<string, unknown>[];
        const contains = typeof args.contains === 'string' ? args.contains.toLowerCase() : '';
        if (contains) {
          items = items.filter(i => ['fullPath', 'applicationName', 'policyName', 'processPath']
            .some(k => String(i[k] ?? '').toLowerCase().includes(contains)));
        }
        return withSummary(shapeList(items, auditSummary, shapeArgs), {
          window: `${window.startDate} to ${window.endDate}`, eventsOnPage: items.length, page: page.page, hasMore: page.hasMore,
          ...(contains ? { containsFilter: `${contains} (client-side on ${page.items.length} fetched rows)` } : {}),
        });
      } catch (err) {
        return toolErrorFromCatch(toolName, err, { hint: 'Narrow the window (hours) or add hostname. The API User needs the View Unified Audit role.' });
      }
    }
    case 'threatlocker_audit_get': {
      const auditEntryId = args.auditEntryId as string;
      logger.info('API call: auditLog.get', { auditEntryId });
      try {
        const client = await getClient();
        const entry = await client.auditLog.get(auditEntryId, args.sourceTableId as number | undefined);
        return shapeItem(entry as Record<string, unknown>, auditDetail, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch(toolName, err, { hint: 'Get auditEntryId from threatlocker_audit_search with full:true.' });
      }
    }
    case 'threatlocker_audit_file_history': {
      const hostname = args.hostname as string;
      const fullPath = args.fullPath as string;
      logger.info('API call: auditLog.fileHistory', { hostname, fullPath });
      try {
        const client = await getClient();
        const row = await resolveComputer(client, hostname);
        const history = await client.auditLog.getFileHistory({
          fullPath, hostname: row.hostname ?? hostname, computerId: row.computerId,
          pageNumber: args.pageNumber as number | undefined, pageSize: args.pageSize as number | undefined,
        });
        return withSummary(shapeList(history, auditSummary, shapeArgs), { hostname: row.hostname ?? hostname, file: fullPath, events: history.length });
      } catch (err) {
        if (err instanceof ResolutionError) return toolError('NOT_FOUND', `${toolName}: ${err.message}`);
        return toolErrorFromCatch(toolName, err, { hint: 'fullPath must be the exact absolute path as ThreatLocker logged it.' });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const auditLogHandler: DomainHandler = { getTools, handleCall };
