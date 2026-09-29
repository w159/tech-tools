import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler } from '../utils/types.js';
import { logger } from '../utils/logger.js';
import { resolvePolicy, ResolutionError } from '../utils/resolve.js';
import {
  shapeList, shapeItem, SHAPE_PROPS,
  toolError, withSummary, OS_TYPE_NAME, OS_TYPE_BY_NAME,
  type SummaryFn,
} from './_helpers.js';
import {
  callApi, dispatchTool, label, namedId, parseArgs, InvalidArgsError, OS_TYPE_HINT, STATUS_HINT, type ToolFn,
} from './_args.js';

/** policyActionId values (threatlocker.kb.help/portalapipolicy/). */
const POLICY_ACTION_NAME: Record<number, string> = {
  1: 'Permit', 2: 'Deny', 6: 'Permit with Ringfencing',
};

const FILTERS = ['', 'nomatch', 'match', 'oversixweeks', 'ringfence', 'noringfence',
  'elevation', 'permitonly', 'inherit', 'monitor', 'secured'];

export const policySummary: SummaryFn = (item: Record<string, unknown>) => ({
  policyId: item.policyId,
  name: item.name,
  action: label(POLICY_ACTION_NAME, item.policyActionId),
  enabled: item.isEnabled,
  osType: label(OS_TYPE_NAME, item.osType),
  lastMatch: item.lastMatchDateTime || undefined,
  neverExpires: item.neverExpires,
  expires: item.endDate ?? undefined,
  ...(item.computerGroupId !== undefined ? { computerGroupId: item.computerGroupId } : {}),
});

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_policies_list',
      description: 'List Application Control policies: name, action (Permit/Deny/Ringfencing), enabled state, OS, last match. Filter by computer group GUID, filter type, or OS. Use scopeId for a specific computer group; omit for all.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          scopeId: { type: 'string', description: 'Optional computer group GUID (from threatlocker_computer_groups_list full:true) to scope policies to a group.' },
          filter: { type: 'string', enum: FILTERS.map(f => f || 'any'), description: 'Policy filter: any (default), nomatch, match, oversixweeks, ringfence, noringfence, elevation, permitonly, inherit, monitor, secured.' },
          osType: { type: 'string', enum: ['all', 'windows', 'mac', 'linux', 'windows xp'], description: 'Operating system (default all).' },
          activeOnly: { type: 'boolean', description: 'Only active policies.' },
          searchText: { type: 'string', description: 'Free text matched against policy name.' },
          showAllPolicies: { type: 'boolean', description: 'Include policies hidden in the portal UI.' },
          pageNumber: { type: 'number', description: 'Page number (default 1).' },
          pageSize: { type: 'number', description: 'Rows per page (default 25).' },
        },
      },
    },
    {
      name: 'threatlocker_policies_get',
      description: 'Full detail of one Application Control policy by name (exact match; closest candidates are returned on miss) or by policyId GUID.',
      inputSchema: {
        type: 'object' as const,
        properties: { ...SHAPE_PROPS, name: { type: 'string', description: 'Policy name (exact, case-insensitive).' }, policyId: { type: 'string', description: 'Policy GUID if you already have it (from full:true output).' } },
      },
    },
  ];
}

/** '' and 'any' both mean no filter; anything else must be a known filter. */
function parseFilter(args: Record<string, unknown>): string {
  const filter = typeof args.filter === 'string' ? args.filter.trim().toLowerCase() : '';
  if (filter && filter !== 'any' && !FILTERS.includes(filter)) {
    throw new InvalidArgsError(`Unknown filter "${args.filter}".`, `Use one of: ${FILTERS.map(f => f || 'any').join(', ')}.`);
  }
  return filter === 'any' ? '' : filter;
}

function listParams(args: Record<string, unknown>) {
  const osType = namedId(args, 'osType', OS_TYPE_BY_NAME, OS_TYPE_HINT);
  return {
    computerGroupId: args.scopeId as string | undefined,
    filter: parseFilter(args),
    osType,
    activeOnly: args.activeOnly as boolean | undefined,
    searchText: args.searchText as string | undefined,
    showAllPolicies: args.showAllPolicies as boolean | undefined,
    pageNumber: args.pageNumber as number | undefined,
    pageSize: args.pageSize as number | undefined,
  };
}

const listPolicies: ToolFn = async (toolName, args, shapeArgs) => {
  const parsed = parseArgs(() => listParams(args));
  if (parsed.error) return parsed.error;
  logger.info('API call: policies.list', parsed.params);
  return callApi(toolName, STATUS_HINT, async client => {
    const page = await client.policies.list(parsed.params);
    return withSummary(shapeList(page.items, policySummary, shapeArgs), {
      policiesOnPage: page.items.length, page: page.page, hasMore: page.hasMore,
    });
  });
};

const getPolicy: ToolFn = async (toolName, args, shapeArgs) => {
  if (typeof args.name !== 'string' && typeof args.policyId !== 'string') {
    return toolError('INVALID_ARGS', 'Give a policy name or a policyId GUID.');
  }
  logger.info('API call: policies.get', { name: args.name, policyId: args.policyId });
  return callApi(toolName, STATUS_HINT, async client => {
    const match = await resolvePolicy(client, (args.policyId as string) ?? (args.name as string));
    return shapeItem(await client.policies.get(match.policyId), policySummary, shapeArgs);
  }, err => err instanceof ResolutionError
    ? toolError('NOT_FOUND', `${toolName}: ${err.message}`, { hint: 'List candidates with threatlocker_policies_list searchText.' })
    : undefined);
};

const handlers: Record<string, ToolFn> = {
  threatlocker_policies_list: listPolicies,
  threatlocker_policies_get: getPolicy,
};

const handleCall: DomainHandler['handleCall'] = (toolName, args) => dispatchTool(handlers, toolName, args);

export const policiesHandler: DomainHandler = { getTools, handleCall };
