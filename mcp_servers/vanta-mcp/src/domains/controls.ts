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

const controlSummary: SummaryFn = (item) => ({
  id:          item.id,
  name:        item.name,
  status:      item.status,
  owner:       item.owner,
  frameworkIds: item.frameworkIds,
});

function getTools(): Tool[] {
  return [
    listTool('vanta_controls_list', 'List Vanta GRC controls; optionally filter by frameworkMatchesAny (array of framework IDs) to narrow to a specific compliance framework. Returns control names, statuses, and owners. Pass full:true for the complete object.', {
      frameworkMatchesAny: {
        type: 'array',
        items: { type: 'string' },
        description: 'Restrict to controls present in any of these framework IDs.',
      },
      ...SHAPE_PROPS,
    }),
    getTool('vanta_controls_get', 'Get a single Vanta GRC control by ID (required). Returns status, description, linked tests, and assigned owners. Pass full:true for the complete object.', 'id', 'Control ID (required). Obtain from vanta_controls_list.'),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  switch (toolName) {
    case 'vanta_controls_list': {
      logger.info('API call: controls.list', args);
      try {
        const page = await client.controls.list(args);
        return shapeList(
          page.items,
          controlSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_controls_list', err, {
          hint: 'Check VANTA_CLIENT_ID and VANTA_CLIENT_SECRET. Verify the OAuth scope includes controls:read.',
        });
      }
    }
    case 'vanta_controls_get': {
      logger.info('API call: controls.get', { id: args.id });
      try {
        const item = await client.controls.get(args.id as string);
        return shapeItem(item as unknown as Record<string, unknown>, controlSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_controls_get', err, {
          hint: 'Verify the control ID with vanta_controls_list first.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const controlsHandler: DomainHandler = { getTools, handleCall };
