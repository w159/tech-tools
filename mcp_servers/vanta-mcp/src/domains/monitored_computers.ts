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

const computerSummary: SummaryFn = (item) => ({
  id:               item.id,
  hostname:         item.hostname,
  owner:            item.owner,
  osVersion:        item.osVersion,
  complianceStatus: item.complianceStatus,
  lastCheckedInAt:  item.lastCheckedInAt,
});

function getTools(): Tool[] {
  return [
    listTool('vanta_monitored_computers_list', 'List Vanta endpoint agent records with compliance posture; filter by complianceStatusFilterMatchesAny (COMPLIANT, NON_COMPLIANT, UNKNOWN). Use to identify non-compliant laptops or workstations for remediation follow-up. Pass full:true for the complete object.', {
      complianceStatusFilterMatchesAny: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by compliance status (e.g. COMPLIANT, NON_COMPLIANT, UNKNOWN).',
      },
      ...SHAPE_PROPS,
    }),
    getTool('vanta_monitored_computers_get', 'Get a single Vanta monitored computer by ID (required). Returns OS version, last check-in, compliance checks, and assigned owner. Pass full:true for the complete object.', 'id', 'Monitored computer ID (required). Obtain from vanta_monitored_computers_list.'),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  switch (toolName) {
    case 'vanta_monitored_computers_list': {
      logger.info('API call: monitoredComputers.list', args);
      try {
        const page = await client.monitoredComputers.list(args);
        return shapeList(
          page.items,
          computerSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_monitored_computers_list', err, {
          hint: 'Check VANTA_CLIENT_ID and VANTA_CLIENT_SECRET. Verify the OAuth scope includes computers:read.',
        });
      }
    }
    case 'vanta_monitored_computers_get': {
      try {
        const item = await client.monitoredComputers.get(args.id as string);
        return shapeItem(item as unknown as Record<string, unknown>, computerSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_monitored_computers_get', err, {
          hint: 'Verify the computer ID with vanta_monitored_computers_list first.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const monitoredComputersHandler: DomainHandler = { getTools, handleCall };
