import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { elicitText } from '../utils/elicitation.js';
import {
  shapeList, shapeItem, shapeRaw,
  extractShapeArgs, SHAPE_PROPS,
  toolErrorFromCatch,
  type SummaryFn,
} from './_helpers.js';

// Compact summary: id, hostname, os, last check-in, group, policy status
const computerSummary: SummaryFn = (item) => ({
  id:             item.id ?? item.computerId,
  hostName:       item.hostName ?? item.computerName,
  operatingSystem: item.operatingSystem ?? item.os,
  lastCheckin:    item.lastCheckin ?? item.lastCheckIn,
  computerGroup:  item.computerGroup ?? item.groupName,
  policyStatus:   item.policyStatus,
});

// Compact summary for check-in events
const checkinSummary: SummaryFn = (item) => ({
  dateTime:         item.dateTime ?? item.checkInTime,
  connectionStatus: item.connectionStatus ?? item.status,
});

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_computers_list',
      description: 'List ThreatLocker-managed computers; filter by searchText, computerGroup, or childOrganizations. Returns computer IDs and hostnames needed for detailed queries. Returns compact summaries by default; pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          searchText: { type: 'string', description: 'Free-text search applied to computer name or hostname.' },
          computerGroup: { type: 'string', description: 'Filter by computer group name to scope results to one group.' },
          pageNumber: { type: 'number', description: 'Page number for pagination (default: 1).' },
          pageSize: { type: 'number', description: 'Page size — records per page (default: 50).' },
          childOrganizations: { type: 'boolean', description: 'When true, includes computers from child organizations.' },
        },
      },
    },
    {
      name: 'threatlocker_computers_get',
      description: 'Get details of a single ThreatLocker computer by computerId (required). Returns OS, last-check-in, group membership, and policy status. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          computerId: { type: 'string', description: 'UUID string identifying the ThreatLocker computer.' },
        },
        required: ['computerId'],
      },
    },
    {
      name: 'threatlocker_computers_get_checkins',
      description: 'Get check-in history for a ThreatLocker computer by computerId (required). Returns timestamps and connection status for each check-in event. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          computerId: { type: 'string', description: 'UUID string identifying the ThreatLocker computer.' },
          pageNumber: { type: 'number', description: 'Page number for pagination (default: 1).' },
          pageSize: { type: 'number', description: 'Page size — records per page (default: 50).' },
        },
        required: ['computerId'],
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case 'threatlocker_computers_list': {
      // Elicitation: if no filters provided, ask for search term
      let searchText = args.searchText as string | undefined;
      if (!searchText && !args.computerGroup) {
        const elicited = await elicitText('Enter search term for computers (or press Enter to list all):');
        searchText = elicited || undefined;
      }

      const params = {
        searchText,
        computerGroup: args.computerGroup as string | undefined,
        pageNumber: args.pageNumber as number | undefined,
        pageSize: args.pageSize as number | undefined,
        childOrganizations: args.childOrganizations as boolean | undefined,
      };
      logger.info('API call: computers.list', params);
      try {
        const client = await getClient();
        const result = await client.computers.list(params);
        const items = Array.isArray(result) ? result : (result?.items ?? result?.data ?? [result]);
        return shapeList(items, computerSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_computers_list', err, {
          hint: 'Verify THREATLOCKER_API_KEY and THREATLOCKER_ORGANIZATION_ID are set correctly.',
        });
      }
    }
    case 'threatlocker_computers_get': {
      const computerId = args.computerId as string;
      logger.info('API call: computers.get', { computerId });
      try {
        const client = await getClient();
        const computer = await client.computers.get(computerId);
        return shapeItem(computer as Record<string, unknown>, computerSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_computers_get', err, {
          hint: 'Verify the computerId with threatlocker_computers_list first.',
        });
      }
    }
    case 'threatlocker_computers_get_checkins': {
      const params = {
        computerId: args.computerId as string,
        pageNumber: args.pageNumber as number | undefined,
        pageSize: args.pageSize as number | undefined,
      };
      logger.info('API call: computers.getCheckins', params);
      try {
        const client = await getClient();
        const checkins = await client.computers.getCheckins(params.computerId, {
          pageNumber: params.pageNumber,
          pageSize: params.pageSize,
        });
        const items = Array.isArray(checkins) ? checkins : (checkins?.items ?? checkins?.data ?? [checkins]);
        return shapeList(items, checkinSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_computers_get_checkins', err, {
          hint: 'Verify the computerId with threatlocker_computers_list first.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const computersHandler: DomainHandler = { getTools, handleCall };
