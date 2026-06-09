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

const vendorSummary: SummaryFn = (item) => ({
  id:             item.id,
  name:           item.name,
  riskTier:       item.riskTier,
  reviewStatus:   item.reviewStatus,
  lastReviewedAt: item.lastReviewedAt,
});

function getTools(): Tool[] {
  return [
    listTool('vanta_vendors_list', 'List Vanta third-party vendors with risk tier, review status, and associated controls. Use to audit vendor security posture or find vendors pending review. Pass full:true for the complete object.', {
      ...SHAPE_PROPS,
    }),
    getTool('vanta_vendors_get', 'Get a single Vanta vendor record by ID (required). Returns risk tier, last review date, questionnaire status, and linked controls. Pass full:true for the complete object.', 'id', 'Vendor ID (required). Obtain from vanta_vendors_list.'),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  switch (toolName) {
    case 'vanta_vendors_list': {
      logger.info('API call: vendors.list', args);
      try {
        const page = await client.vendors.list(args);
        return shapeList(
          page.items,
          vendorSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_vendors_list', err, {
          hint: 'Check VANTA_CLIENT_ID and VANTA_CLIENT_SECRET. Verify the OAuth scope includes vendors:read.',
        });
      }
    }
    case 'vanta_vendors_get': {
      try {
        const item = await client.vendors.get(args.id as string);
        return shapeItem(item as unknown as Record<string, unknown>, vendorSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_vendors_get', err, {
          hint: 'Verify the vendor ID with vanta_vendors_list first.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const vendorsHandler: DomainHandler = { getTools, handleCall };
