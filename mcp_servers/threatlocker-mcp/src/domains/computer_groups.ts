import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeList, extractShapeArgs, SHAPE_PROPS,
  toolError, toolErrorFromCatch, withSummary, OS_TYPE_NAME, OS_TYPE_BY_NAME,
  type SummaryFn,
} from './_helpers.js';

// ComputerGroupGetDropdownByOrganizationId rows: {label, value, numericValue}
// where numericValue is the osType (verified live 2026-09-01).
const groupSummary: SummaryFn = (item) => ({
  name:            item.label,
  operatingSystem: typeof item.numericValue === 'number' ? (OS_TYPE_NAME[item.numericValue] ?? item.numericValue) : undefined,
});

const OS_PROP = { operatingSystem: { type: 'string', description: 'Windows, macOS, or Linux. Omit for all.' } };

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_computer_groups_list',
      description: 'List ThreatLocker computer groups by name with their operating system. Use the group name with threatlocker_computers_list group:<name>.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS, ...OS_PROP,
          includeGlobal: { type: 'boolean', description: 'Include groups shared across organizations (default true).' },
        },
      },
    },
    {
      name: 'threatlocker_computer_groups_dropdown',
      description: 'Same as threatlocker_computer_groups_list (kept for compatibility): group names with operating system.',
      inputSchema: { type: 'object' as const, properties: { ...SHAPE_PROPS, ...OS_PROP } },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);
  if (toolName !== 'threatlocker_computer_groups_list' && toolName !== 'threatlocker_computer_groups_dropdown') {
    return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
  const osName = typeof args.operatingSystem === 'string' ? args.operatingSystem.trim().toLowerCase() : '';
  const osType = osName ? OS_TYPE_BY_NAME[osName] : undefined;
  if (osName && osType === undefined) {
    return toolError('INVALID_ARGS', `Unknown operatingSystem "${args.operatingSystem}".`, { hint: 'Use Windows, macOS, or Linux.' });
  }
  logger.info('API call: computerGroups.list', { osType });
  try {
    const client = await getClient();
    const groups = await client.computerGroups.list({
      computerGroupOSTypeId: osType || undefined,
      hideGlobals: args.includeGlobal === false,
    });
    return withSummary(shapeList(groups, groupSummary, shapeArgs), { totalGroups: groups.length });
  } catch (err) {
    return toolErrorFromCatch(toolName, err, { hint: 'Call threatlocker_status to confirm the key and instance letter.' });
  }
}

export const computerGroupsHandler: DomainHandler = { getTools, handleCall };
