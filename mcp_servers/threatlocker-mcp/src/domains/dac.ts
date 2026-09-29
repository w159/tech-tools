import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler } from '../utils/types.js';
import { logger } from '../utils/logger.js';
import {
  shapeList, shapeItem, SHAPE_PROPS, withSummary,
  type SummaryFn,
} from './_helpers.js';
import { callApi, dispatchTool, label, namedId, oneOf, parseArgs, STATUS_HINT, type ToolFn } from './_args.js';

/** DAC category, criticality and entityType ids (threatlocker.kb.help/portalapidadalysisresult/). */
const CATEGORY_BY_NAME: Record<string, number> = {
  'network-policy': 1, 'storage-policy': 2, 'application-control': 3, 'registry-policy': 4,
  'group-policy': 6, 'account-and-authentication': 7, 'advanced-audit-configuration': 8,
  'local-security': 9, 'patch-management': 10, 'remote-desktop-and-access-control': 11,
  'user-rights-assignment': 12, 'detect-and-response': 13,
};
const CATEGORY_NAME: Record<number, string> = {
  1: 'Network Policy', 2: 'Storage Policy', 3: 'Application Control', 4: 'Registry Policy',
  6: 'Group Policy', 7: 'Account and Authentication', 8: 'Advanced Audit Configuration',
  9: 'Local Security', 10: 'Patch Management', 11: 'Remote Desktop and Access Control',
  12: 'User Rights Assignment', 13: 'Detect and Response',
};
const CRITICALITY_BY_NAME: Record<string, number> = { low: 1, moderate: 2, high: 3, critical: 4 };
const CRITICALITY_NAME: Record<number, string> = { 1: 'Low', 2: 'Moderate', 3: 'High', 4: 'Critical' };
const ENTITY_TYPE_BY_NAME: Record<string, number> = { organization: 1, 'computer-group': 2, computer: 3 };
const ENTITY_TYPE_NAME: Record<number, string> = { 1: 'Organization', 2: 'Computer Group', 3: 'Computer' };

const SORT_BY = ['category', 'combined-impact', 'criticality'];

export const dacSummary: SummaryFn = (item: Record<string, unknown>) => ({
  analysisItemId: item.analysisItemId,
  category: label(CATEGORY_NAME, item.categoryId, item.categoryId),
  criticality: label(CRITICALITY_NAME, item.criticalityId, item.criticalityId),
  entityType: label(ENTITY_TYPE_NAME, item.entityTypeId, item.entityTypeId),
  appliesTo: item.appliesToId ?? undefined,
});

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_dac_results_list',
      description: 'List Defense Against Configurations (DAC) Health Center risk findings: security-analysis results per category, criticality, and entity. This is also the closest available read source for Storage Control / storage-policy and Network Control / network-policy posture — neither Storage Control nor Network Control policies have a documented list/get endpoint in the ThreatLocker KB or the live public swagger (checked on two instances, 2026-09-28), but the swagger is a known partial subset (it also omits Policy/PolicyGetByParameters, which this server does use, since it is KB-documented) — so treat this as unprobed rather than proven absent. Category 2 = storage-policy, 1 = network-policy.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          category: {
            type: 'string',
            enum: Object.keys(CATEGORY_BY_NAME),
            description: 'DAC analysis category (e.g. storage-policy, network-policy, application-control).',
          },
          criticality: { type: 'string', enum: Object.keys(CRITICALITY_BY_NAME), description: 'Finding criticality (default all).' },
          appliesToId: { type: 'string', description: 'Organization/computer-group/computer GUID the analysis applies to.' },
          entityType: { type: 'string', enum: Object.keys(ENTITY_TYPE_BY_NAME), description: 'What appliesToId is: organization, computer-group, or computer.' },
          includeChildOrgs: { type: 'boolean', description: 'Include child organizations.' },
          searchText: { type: 'string', description: 'Free text filter.' },
          sortBy: { type: 'string', enum: SORT_BY, description: 'Sort order (default vendor order).' },
          pageNumber: { type: 'number', description: 'Page number (default 1).' },
          pageSize: { type: 'number', description: 'Rows per page (default 25).' },
        },
      },
    },
    {
      name: 'threatlocker_dac_item_get',
      description: 'Full detail of one DAC analysis item. NOTE: takes the integer analysisItemId (NOT a GUID) from threatlocker_dac_results_list.',
      inputSchema: {
        type: 'object' as const,
        properties: { ...SHAPE_PROPS, analysisItemId: { type: 'number', description: 'Integer analysis item id (not a GUID).' } },
        required: ['analysisItemId'],
      },
    },
  ];
}

function listParams(args: Record<string, unknown>) {
  const categoryId = namedId(args, 'category', CATEGORY_BY_NAME, `Use one of: ${Object.keys(CATEGORY_BY_NAME).join(', ')}.`);
  const criticalityId = namedId(args, 'criticality', CRITICALITY_BY_NAME, 'Use low, moderate, high, or critical.');
  const entityTypeId = namedId(args, 'entityType', ENTITY_TYPE_BY_NAME, 'Use organization, computer-group, or computer.');
  const sortBy = oneOf(args, 'sortBy', SORT_BY);
  return {
    appliesToId: args.appliesToId as string | undefined,
    categoryId,
    criticalityId,
    entityTypeId,
    includeChildOrgs: args.includeChildOrgs as boolean | undefined,
    searchText: args.searchText as string | undefined,
    sortBy,
    pageNumber: args.pageNumber as number | undefined,
    pageSize: args.pageSize as number | undefined,
  };
}

const listResults: ToolFn = async (toolName, args, shapeArgs) => {
  const parsed = parseArgs(() => listParams(args));
  if (parsed.error) return parsed.error;
  logger.info('API call: dac.listResults', parsed.params);
  return callApi(toolName, STATUS_HINT, async client => {
    const page = await client.dac.listResults(parsed.params);
    return withSummary(shapeList(page.items, dacSummary, shapeArgs), {
      findingsOnPage: page.items.length, page: page.page, hasMore: page.hasMore,
    });
  });
};

const getItem: ToolFn = async (toolName, args, shapeArgs) => {
  const analysisItemId = args.analysisItemId as number;
  logger.info('API call: dac.getItem', { analysisItemId });
  return callApi(
    toolName,
    'analysisItemId is the integer id from threatlocker_dac_results_list, not a GUID.',
    async client => shapeItem(await client.dac.getItem(analysisItemId), dacSummary, shapeArgs),
  );
};

const handlers: Record<string, ToolFn> = {
  threatlocker_dac_results_list: listResults,
  threatlocker_dac_item_get: getItem,
};

const handleCall: DomainHandler['handleCall'] = (toolName, args) => dispatchTool(handlers, toolName, args);

export const dacHandler: DomainHandler = { getTools, handleCall };
