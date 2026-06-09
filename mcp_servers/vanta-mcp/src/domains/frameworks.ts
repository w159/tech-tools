import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeList, shapeItem, extractShapeArgs, SHAPE_PROPS,
  toolErrorFromCatch,
  listTool, getTool,
  type SummaryFn,
} from './_helpers.js';

const frameworkSummary: SummaryFn = (item) => ({
  id:                   item.id,
  displayName:          item.displayName,
  shorthandName:        item.shorthandName,
  numControlsCompleted: item.numControlsCompleted,
  numControlsTotal:     item.numControlsTotal,
  numTestsPassing:      item.numTestsPassing,
  numTestsTotal:        item.numTestsTotal,
});

const controlSummary: SummaryFn = (item) => ({
  id:     item.id,
  name:   item.name,
  status: item.status,
  owner:  item.owner,
});

function getTools(): Tool[] {
  return [
    listTool('vanta_frameworks_list', 'List Vanta compliance frameworks the workspace is tracking (SOC 2, ISO 27001, HIPAA, etc.). Returns framework IDs needed for filtering controls and tests. Pass full:true for the complete object.', {
      ...SHAPE_PROPS,
    }),
    {
      name: 'vanta_frameworks_get',
      description: 'Get a single Vanta framework by ID (required). Returns readiness percentage, control counts, and deadline. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'Framework ID (required). Obtain from vanta_frameworks_list.' },
          ...SHAPE_PROPS,
        },
        required: ['id'],
      },
    },
    {
      name: 'vanta_frameworks_list_controls',
      description: 'List Vanta controls scoped to a specific compliance framework by framework ID (required). Use to enumerate all controls required for a single framework like SOC 2 or ISO 27001. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'Framework ID (required). Obtain from vanta_frameworks_list.' },
          pageSize: { type: 'number' },
          pageCursor: { type: 'string' },
          ...SHAPE_PROPS,
        },
        required: ['id'],
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  switch (toolName) {
    case 'vanta_frameworks_list': {
      logger.info('API call: frameworks.list', args);
      try {
        const page = await client.frameworks.list(args);
        return shapeList(
          page.items,
          frameworkSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_frameworks_list', err, {
          hint: 'Check VANTA_CLIENT_ID and VANTA_CLIENT_SECRET.',
        });
      }
    }
    case 'vanta_frameworks_get': {
      const id = args.id as string;
      logger.info('API call: frameworks.get', { id });
      try {
        const item = await client.frameworks.get(id);
        return shapeItem(item as unknown as Record<string, unknown>, frameworkSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_frameworks_get', err, {
          hint: 'Verify the framework ID with vanta_frameworks_list first.',
        });
      }
    }
    case 'vanta_frameworks_list_controls': {
      const { id, ...rest } = args as { id: string; [k: string]: unknown };
      logger.info('API call: frameworks.listControls', { id, ...rest });
      try {
        const page = await client.frameworks.listControls(id, rest);
        return shapeList(
          page.items,
          controlSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_frameworks_list_controls', err, {
          hint: 'Verify the framework ID with vanta_frameworks_list first.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const frameworksHandler: DomainHandler = { getTools, handleCall };
