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

const policySummary: SummaryFn = (item) => ({
  id:             item.id,
  name:           item.name,
  status:         item.status,
  version:        item.version,
  lastApprovedAt: item.lastApprovedAt,
  owner:          item.owner,
});

function getTools(): Tool[] {
  return [
    listTool('vanta_policies_list', 'List Vanta approved workspace policies with their approval status and owners. Use to enumerate policies for audit review or to find the policy ID for a specific domain (e.g. access control, incident response). Pass full:true for the complete object.', {
      ...SHAPE_PROPS,
    }),
    getTool('vanta_policies_get', 'Get a single Vanta policy by ID (required). Returns policy content, version, last approved date, and approver. Pass full:true for the complete object.', 'id', 'Policy ID (required). Obtain from vanta_policies_list.'),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  switch (toolName) {
    case 'vanta_policies_list': {
      logger.info('API call: policies.list', args);
      try {
        const page = await client.policies.list(args);
        return shapeList(
          page.items,
          policySummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_policies_list', err, {
          hint: 'Check VANTA_CLIENT_ID and VANTA_CLIENT_SECRET. Verify the OAuth scope includes policies:read.',
        });
      }
    }
    case 'vanta_policies_get': {
      try {
        const item = await client.policies.get(args.id as string);
        return shapeItem(item as unknown as Record<string, unknown>, policySummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_policies_get', err, {
          hint: 'Verify the policy ID with vanta_policies_list first.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const policiesHandler: DomainHandler = { getTools, handleCall };
