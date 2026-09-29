import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler } from '../utils/types.js';
import { logger } from '../utils/logger.js';
import { shapeList, SHAPE_PROPS, withSummary, type SummaryFn } from './_helpers.js';
import { callApi, dispatchTool, label, namedId, parseArgs, STATUS_HINT, type ToolFn } from './_args.js';

/** CMPolicy status values (threatlocker.kb.help/portalapicmpolicy/). */
const CM_STATUS_BY_NAME: Record<string, number> = { 'not-configured': -1, disabled: 0, enabled: 1, all: 99 };

const configurationSummary: SummaryFn = (item: Record<string, unknown>) => ({
  value: item.value,
  name: item.name,
  description: item.description || undefined,
  category: item.category ?? undefined,
});

const CM_STATUS_NAME: Record<number, string> = { [-1]: 'Not Configured', 0: 'Disabled', 1: 'Enabled' };

export const cmPolicySummary: SummaryFn = (item: Record<string, unknown>) => ({
  name: item.name,
  status: label(CM_STATUS_NAME, item.status, item.status),
  category: item.category ?? undefined,
  appliesTo: item.appliesTo ?? undefined,
});

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_config_manager_configurations_list',
      description: 'List the catalog of ThreatLocker Config Manager device-configuration checks: each check with its category and the integer value used to identify it in Config Manager policies. No required arguments.',
      inputSchema: { type: 'object' as const, properties: { ...SHAPE_PROPS } },
    },
    {
      name: 'threatlocker_config_manager_policies_list',
      description: 'List Config Manager device-configuration policies — the hardening/configuration settings (e.g. OS hardening, screen lock, storage control settings) enforced on which organization, computer group, or computer. Filter by appliesTo GUID and status.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          appliesTo: { type: 'string', description: 'Optional organization/computer-group/computer GUID the policy applies to; omit for all.' },
          status: { type: 'string', enum: ['not-configured', 'disabled', 'enabled', 'all'], description: 'Policy status (default all).' },
          searchText: { type: 'string', description: 'Free text matched against policy name.' },
          pageNumber: { type: 'number', description: 'Page number (default 1).' },
          pageSize: { type: 'number', description: 'Rows per page (default 25).' },
        },
      },
    },
  ];
}

const listConfigurations: ToolFn = async (toolName, _args, shapeArgs) => {
  logger.info('API call: configManager.listConfigurations');
  return callApi(toolName, STATUS_HINT, async client => {
    const rows = await client.configManager.listConfigurations();
    return withSummary(shapeList(rows, configurationSummary, shapeArgs), { configurations: rows.length });
  });
};

function policyParams(args: Record<string, unknown>) {
  const status = namedId(args, 'status', CM_STATUS_BY_NAME, 'Use not-configured, disabled, enabled, or all.');
  return {
    appliesTo: args.appliesTo as string | undefined,
    status,
    searchText: args.searchText as string | undefined,
    pageNumber: args.pageNumber as number | undefined,
    pageSize: args.pageSize as number | undefined,
  };
}

const listPolicies: ToolFn = async (toolName, args, shapeArgs) => {
  const parsed = parseArgs(() => policyParams(args));
  if (parsed.error) return parsed.error;
  logger.info('API call: configManager.listPolicies', parsed.params);
  return callApi(toolName, STATUS_HINT, async client => {
    const page = await client.configManager.listPolicies(parsed.params);
    return withSummary(shapeList(page.items, cmPolicySummary, shapeArgs), {
      policiesOnPage: page.items.length, page: page.page, hasMore: page.hasMore,
    });
  });
};

const handlers: Record<string, ToolFn> = {
  threatlocker_config_manager_configurations_list: listConfigurations,
  threatlocker_config_manager_policies_list: listPolicies,
};

const handleCall: DomainHandler['handleCall'] = (toolName, args) => dispatchTool(handlers, toolName, args);

export const configManagerHandler: DomainHandler = { getTools, handleCall };
