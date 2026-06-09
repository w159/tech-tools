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

const personSummary: SummaryFn = (item) => ({
  id:                  item.id,
  displayName:         item.displayName,
  email:               item.email,
  role:                item.role,
  taskCompletionStatus: item.taskCompletionStatus,
});

function getTools(): Tool[] {
  return [
    listTool('vanta_people_list', 'List Vanta workforce members with their compliance task status; optionally filter by emailAndNameFilter (free-text) or groupIdsMatchesAny (group ID array). Use to find a person ID for control ownership lookups or to audit outstanding employee tasks. Pass full:true for the complete object.', {
      emailAndNameFilter: { type: 'string', description: 'Free-text filter against email or display name.' },
      groupIdsMatchesAny: { type: 'array', items: { type: 'string' }, description: 'Restrict to people in any of these group IDs.' },
      ...SHAPE_PROPS,
    }),
    getTool('vanta_people_get', 'Get a single Vanta workforce member by ID (required). Returns email, role, group memberships, and outstanding compliance tasks. Pass full:true for the complete object.', 'id', 'Person ID (required). Obtain from vanta_people_list.'),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  switch (toolName) {
    case 'vanta_people_list': {
      logger.info('API call: people.list', args);
      try {
        const page = await client.people.list(args);
        return shapeList(
          page.items,
          personSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_people_list', err, {
          hint: 'Check VANTA_CLIENT_ID and VANTA_CLIENT_SECRET. Verify the OAuth scope includes people:read.',
        });
      }
    }
    case 'vanta_people_get': {
      try {
        const item = await client.people.get(args.id as string);
        return shapeItem(item as unknown as Record<string, unknown>, personSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_people_get', err, {
          hint: 'Verify the person ID with vanta_people_list first.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const peopleHandler: DomainHandler = { getTools, handleCall };
