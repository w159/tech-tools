import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler } from '../utils/types.js';
import { logger } from '../utils/logger.js';
import { resolveApplication, ResolutionError } from '../utils/resolve.js';
import {
  shapeList, shapeItem, SHAPE_PROPS,
  toolError, withSummary, OS_TYPE_NAME, OS_TYPE_BY_NAME,
  type SummaryFn,
} from './_helpers.js';
import {
  callApi, dispatchTool, label, namedId, oneOf, parseArgs, OS_TYPE_HINT, STATUS_HINT, type ToolFn,
} from './_args.js';

/** category values (threatlocker.kb.help/portalapiapplication/). */
const CATEGORY_BY_NAME: Record<string, number> = { all: 0, custom: 1, 'built-in': 2, 'patch-supported': 4 };
const CATEGORY_NAME: Record<number, string> = { 0: 'All', 1: 'Custom', 2: 'Built-In', 4: 'Patch Supported' };

const ORDER_BY = ['name', 'date-created', 'review-rating', 'computer-count', 'policy'];
const SEARCH_BY = ['app', 'full', 'process', 'hash', 'cert', 'created', 'categories', 'countries'];

export const applicationSummary: SummaryFn = (item: Record<string, unknown>) => ({
  applicationId: item.applicationId,
  name: item.name,
  description: item.description || undefined,
  category: label(CATEGORY_NAME, item.category, item.category ?? undefined),
  osType: label(OS_TYPE_NAME, item.osType),
  appVer: item.appVer || undefined,
  policyCount: item.policyCount ?? undefined,
});

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_applications_list',
      description: 'List Application Control applications from the vendor catalog: name, description, category, OS, version. Search free text, pick searchBy (app, process, hash, cert, ...), and scope to custom/built-in/patch-supported categories.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          searchText: { type: 'string', description: 'Free text matched against the selected searchBy field.' },
          searchBy: { type: 'string', enum: SEARCH_BY, description: 'Field to search (default app).' },
          category: { type: 'string', enum: ['all', 'custom', 'built-in', 'patch-supported'], description: 'Category (default all).' },
          osType: { type: 'string', enum: ['all', 'windows', 'mac', 'linux', 'windows xp'], description: 'Operating system (default all).' },
          includeChildOrganizations: { type: 'boolean', description: 'Include child organizations.' },
          isHidden: { type: 'boolean', description: 'Include applications hidden in the portal UI.' },
          permittedApplications: { type: 'boolean', description: 'Only applications referenced by a permitted policy.' },
          orderBy: { type: 'string', enum: ORDER_BY, description: 'Sort order (default name).' },
          isAscending: { type: 'boolean', description: 'Ascending sort.' },
          pageNumber: { type: 'number', description: 'Page number (default 1).' },
          pageSize: { type: 'number', description: 'Rows per page (default 25).' },
        },
      },
    },
    {
      name: 'threatlocker_applications_get',
      description: 'Full detail of one application by name (exact match; closest candidates are returned on miss) or by applicationId GUID.',
      inputSchema: {
        type: 'object' as const,
        properties: { ...SHAPE_PROPS, name: { type: 'string', description: 'Application name (exact, case-insensitive).' }, applicationId: { type: 'string', description: 'Application GUID if you already have it (from full:true output).' } },
      },
    },
  ];
}

function listParams(args: Record<string, unknown>) {
  const osType = namedId(args, 'osType', OS_TYPE_BY_NAME, OS_TYPE_HINT);
  const category = namedId(args, 'category', CATEGORY_BY_NAME, 'Use all, custom, built-in, or patch-supported.');
  const orderBy = oneOf(args, 'orderBy', ORDER_BY);
  const searchBy = oneOf(args, 'searchBy', SEARCH_BY);
  return {
    searchText: args.searchText as string | undefined,
    searchBy,
    category,
    osType,
    includeChildOrganizations: args.includeChildOrganizations as boolean | undefined,
    isHidden: args.isHidden as boolean | undefined,
    permittedApplications: args.permittedApplications as boolean | undefined,
    orderBy,
    isAscending: args.isAscending as boolean | undefined,
    pageNumber: args.pageNumber as number | undefined,
    pageSize: args.pageSize as number | undefined,
  };
}

const listApplications: ToolFn = async (toolName, args, shapeArgs) => {
  const parsed = parseArgs(() => listParams(args));
  if (parsed.error) return parsed.error;
  logger.info('API call: applications.list', parsed.params);
  return callApi(toolName, STATUS_HINT, async client => {
    const page = await client.applications.list(parsed.params);
    return withSummary(shapeList(page.items, applicationSummary, shapeArgs), {
      applicationsOnPage: page.items.length, page: page.page, hasMore: page.hasMore,
    });
  });
};

const getApplication: ToolFn = async (toolName, args, shapeArgs) => {
  if (typeof args.name !== 'string' && typeof args.applicationId !== 'string') {
    return toolError('INVALID_ARGS', 'Give an application name or an applicationId GUID.');
  }
  logger.info('API call: applications.get', { name: args.name, applicationId: args.applicationId });
  return callApi(toolName, STATUS_HINT, async client => {
    const match = await resolveApplication(client, (args.applicationId as string) ?? (args.name as string));
    return shapeItem(await client.applications.get(match.applicationId), applicationSummary, shapeArgs);
  }, err => err instanceof ResolutionError
    ? toolError('NOT_FOUND', `${toolName}: ${err.message}`, { hint: 'List candidates with threatlocker_applications_list searchText.' })
    : undefined);
};

const handlers: Record<string, ToolFn> = {
  threatlocker_applications_list: listApplications,
  threatlocker_applications_get: getApplication,
};

const handleCall: DomainHandler['handleCall'] = (toolName, args) => dispatchTool(handlers, toolName, args);

export const applicationsHandler: DomainHandler = { getTools, handleCall };
