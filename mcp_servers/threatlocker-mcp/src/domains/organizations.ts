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

// Compact summary: id, name, and a couple of identifying fields
const orgSummary: SummaryFn = (item) => ({
  id:   item.id ?? item.organizationId,
  name: item.name ?? item.organizationName,
});

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_organizations_list_children',
      description: 'List ThreatLocker child (managed) organizations; optionally filter by searchText. Returns organization IDs needed to scope the managedOrganizationId header for child-org operations. Returns compact summaries by default; pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          searchText: { type: 'string', description: 'Free-text search applied to organization name.' },
          pageNumber: { type: 'number', description: 'Page number for pagination (default: 1).' },
          pageSize: { type: 'number', description: 'Page size — records per page (default: 50).' },
        },
      },
    },
    {
      name: 'threatlocker_organizations_get_auth_key',
      description: 'Get the ThreatLocker organization auth key for the current org. Used when deploying new ThreatLocker agents to enroll computers.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'threatlocker_organizations_for_move_computers',
      description: 'Get ThreatLocker organizations available as move destinations for computers. Use before reassigning a computer to a different managed organization. Returns compact summaries by default; pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
        },
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case 'threatlocker_organizations_list_children': {
      const params = {
        searchText: args.searchText as string | undefined,
        pageNumber: args.pageNumber as number | undefined,
        pageSize: args.pageSize as number | undefined,
      };
      logger.info('API call: organizations.listChildren', params);
      try {
        const client = await getClient();
        const result = await client.organizations.listChildren(params);
        const items = Array.isArray(result) ? result : (result?.items ?? result?.data ?? [result]);
        return shapeList(items, orgSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_organizations_list_children', err, {
          hint: 'Verify THREATLOCKER_API_KEY is set and the key has MSP/parent-org access.',
        });
      }
    }
    case 'threatlocker_organizations_get_auth_key': {
      logger.info('API call: organizations.getAuthKey');
      try {
        const client = await getClient();
        const authKey = await client.organizations.getAuthKey();
        return shapeRaw(authKey);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_organizations_get_auth_key', err, {
          hint: 'Verify THREATLOCKER_API_KEY and THREATLOCKER_ORGANIZATION_ID are set correctly.',
        });
      }
    }
    case 'threatlocker_organizations_for_move_computers': {
      logger.info('API call: organizations.forMoveComputers');
      try {
        const client = await getClient();
        const organizations = await client.organizations.listForMoveComputers();
        const items = Array.isArray(organizations) ? organizations : (organizations?.items ?? organizations?.data ?? [organizations]);
        return shapeList(items, orgSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_organizations_for_move_computers', err, {
          hint: 'Verify THREATLOCKER_API_KEY and THREATLOCKER_ORGANIZATION_ID are set correctly.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const organizationsHandler: DomainHandler = { getTools, handleCall };
