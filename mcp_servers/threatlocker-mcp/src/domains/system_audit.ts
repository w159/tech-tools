import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler } from '../utils/types.js';
import { logger } from '../utils/logger.js';
import { shapeList, SHAPE_PROPS, withSummary, type SummaryFn } from './_helpers.js';
import {
  callApi, dispatchTool, parseArgs, parseTimeWindow, InvalidArgsError, STATUS_HINT, TIME_WINDOW_PROPS, type ToolFn,
} from './_args.js';

const ACTIONS = ['Create', 'Delete', 'Logon', 'Modify', 'Read'];
const EFFECTIVE_ACTIONS = ['Denied', 'Permitted'];

export const systemAuditSummary: SummaryFn = (item: Record<string, unknown>) => ({
  time: item.dateTime,
  action: item.action || undefined,
  details: item.details || undefined,
  user: item.emailAddress || undefined,
  ipAddress: item.iPAddress || undefined,
  effective: item.effectiveAction || undefined,
});

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_system_audit_search',
      description: 'Search the ThreatLocker Portal System Audit — the administrator/login audit trail of who changed what in the ThreatLocker portal (config changes, logons, admin actions). This is NOT the endpoint Unified Audit device event log; use threatlocker_audit_search for that.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          actions: { type: 'array', items: { type: 'string', enum: ACTIONS }, description: 'Action types to include: Create, Delete, Logon, Modify, Read.' },
          effectiveAction: { type: 'string', enum: ['Denied', 'Permitted'], description: 'Only Denied or Permitted actions.' },
          emailAddress: { type: 'string', description: 'Only actions by this admin email address.' },
          iPAddress: { type: 'string', description: 'Only actions from this IP address.' },
          objectId: { type: 'string', description: 'Only actions on this object GUID.' },
          details: { type: 'string', description: 'Free text matched against audit details.' },
          viewChildOrganizations: { type: 'boolean', description: 'Include child organizations.' },
          ...TIME_WINDOW_PROPS,
          pageNumber: { type: 'number', description: 'Page number (default 1).' },
          pageSize: { type: 'number', description: 'Rows per page (default 100).' },
        },
      },
    },
  ];
}

function listParams(args: Record<string, unknown>) {
  const window = parseTimeWindow(args);
  const actions = Array.isArray(args.actions)
    ? (args.actions as unknown[]).filter((a): a is string => typeof a === 'string')
    : undefined;
  if (actions?.some(a => !ACTIONS.includes(a))) {
    throw new InvalidArgsError('Unknown action in actions.', `Use one or more of: ${ACTIONS.join(', ')}.`);
  }
  const effectiveAction = typeof args.effectiveAction === 'string' ? args.effectiveAction : undefined;
  if (effectiveAction && !EFFECTIVE_ACTIONS.includes(effectiveAction)) {
    throw new InvalidArgsError(`effectiveAction must be Denied or Permitted, got "${args.effectiveAction}".`);
  }
  return {
    ...window,
    actions,
    effectiveAction,
    emailAddress: args.emailAddress as string | undefined,
    iPAddress: args.iPAddress as string | undefined,
    objectId: args.objectId as string | undefined,
    details: args.details as string | undefined,
    viewChildOrganizations: args.viewChildOrganizations as boolean | undefined,
    pageNumber: args.pageNumber as number | undefined,
    pageSize: args.pageSize as number | undefined,
  };
}

const searchSystemAudit: ToolFn = async (toolName, args, shapeArgs) => {
  const parsed = parseArgs(() => listParams(args));
  if (parsed.error) return parsed.error;
  const { params } = parsed;
  logger.info('API call: systemAudit.search', params);
  return callApi(toolName, STATUS_HINT, async client => {
    const page = await client.systemAudit.search(params);
    return withSummary(shapeList(page.items, systemAuditSummary, shapeArgs), {
      window: `${params.startDate} to ${params.endDate}`, eventsOnPage: page.items.length, page: page.page, hasMore: page.hasMore,
    });
  });
};

const handlers: Record<string, ToolFn> = { threatlocker_system_audit_search: searchSystemAudit };

const handleCall: DomainHandler['handleCall'] = (toolName, args) => dispatchTool(handlers, toolName, args);

export const systemAuditHandler: DomainHandler = { getTools, handleCall };
