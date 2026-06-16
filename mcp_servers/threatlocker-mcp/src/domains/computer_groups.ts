import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeList, shapeRaw,
  extractShapeArgs, SHAPE_PROPS,
  toolErrorFromCatch,
  type SummaryFn,
} from './_helpers.js';

// Compact summary: id, name, os type, computer count
const groupSummary: SummaryFn = (item) => ({
  id:            item.id,
  name:          item.name,
  osType:        item.osType,
  computerCount: item.computerCount ?? item.computers?.length,
});

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_computer_groups_list',
      description: 'List ThreatLocker computer groups; filter by osType (Windows/macOS/Linux), and optionally include the All-Computers or global groups. Use to find group names for scoped computer queries. Returns compact summaries by default; pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          osType: { type: 'string', description: 'Filter by operating system type (e.g. Windows, macOS, Linux).' },
          includeAllComputers: { type: 'boolean', description: 'When true, includes the built-in "All Computers" group in results.' },
          includeGlobal: { type: 'boolean', description: 'When true, includes groups shared across all organizations.' },
        },
      },
    },
    {
      name: 'threatlocker_computer_groups_dropdown',
      description: 'Get ThreatLocker computer groups as a compact list (id/name pairs). Use when you need a quick lookup of group IDs for UI-like selection.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case 'threatlocker_computer_groups_list': {
      const params = {
        osType: args.osType as string | undefined,
        includeAllComputers: args.includeAllComputers as boolean | undefined,
        includeGlobal: args.includeGlobal as boolean | undefined,
      };
      logger.info('API call: computerGroups.list', params);
      try {
        const client = await getClient();
        const result = await client.computerGroups.list(params);
        const items = Array.isArray(result) ? result : (result?.items ?? result?.data ?? [result]);
        return shapeList(items, groupSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_computer_groups_list', err, {
          hint: 'Verify THREATLOCKER_API_KEY and THREATLOCKER_ORGANIZATION_ID are set correctly.',
        });
      }
    }
    case 'threatlocker_computer_groups_dropdown': {
      logger.info('API call: computerGroups.dropdown');
      try {
        const client = await getClient();
        const dropdown = await client.computerGroups.getDropdown();
        return shapeRaw(dropdown);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_computer_groups_dropdown', err, {
          hint: 'Verify THREATLOCKER_API_KEY and THREATLOCKER_ORGANIZATION_ID are set correctly.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const computerGroupsHandler: DomainHandler = { getTools, handleCall };
