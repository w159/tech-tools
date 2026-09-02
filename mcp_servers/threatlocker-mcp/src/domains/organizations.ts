import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeList, shapeRaw, extractShapeArgs, SHAPE_PROPS,
  toolErrorFromCatch, withSummary,
  type SummaryFn,
} from './_helpers.js';

const childOrgSummary: SummaryFn = (item) => ({
  name:         item.organizationName ?? item.name ?? item.displayName,
  computers:    item.computerCount ?? item.computersCount,
  dateCreated:  item.dateCreated ?? item.createdDate,
});

// OrganizationGetForMoveComputers rows are {label, value} (verified live).
const orgOptionSummary: SummaryFn = (item) => ({ name: item.label });

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_organizations_list_children',
      description: 'List child (managed) organizations by name under the configured organization. Empty for a single-organization tenant, which is normal.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          search: { type: 'string', description: 'Text matched against the organization name.' },
          includeAllChildren: { type: 'boolean', description: 'Include grandchildren (default false).' },
          pageNumber: { type: 'number', description: 'Page number (default 1).' },
          pageSize: { type: 'number', description: 'Rows per page (default 50).' },
        },
      },
    },
    {
      name: 'threatlocker_organizations_get_auth_key',
      description: 'Get the organization Auth Key used to enroll new ThreatLocker agents. This is the agent install key, not an API token; treat it as a secret.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'threatlocker_organizations_for_move_computers',
      description: 'Organizations this API key can act on, by name (the configured organization plus any it manages). Also a quick check of which organization the key is scoped to.',
      inputSchema: { type: 'object' as const, properties: { ...SHAPE_PROPS, search: { type: 'string', description: 'Text matched against the organization name.' } } },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case 'threatlocker_organizations_list_children': {
      const params = {
        searchText: args.search as string | undefined,
        includeAllChildren: args.includeAllChildren as boolean | undefined,
        pageNumber: args.pageNumber as number | undefined,
        pageSize: (args.pageSize as number | undefined) ?? 50,
      };
      logger.info('API call: organizations.listChildren', params);
      try {
        const client = await getClient();
        const page = await client.organizations.listChildren(params);
        return withSummary(shapeList(page.items, childOrgSummary, shapeArgs), { childOrganizations: page.total });
      } catch (err) {
        return toolErrorFromCatch(toolName, err, { hint: 'Child organizations exist only for MSP/parent tenants. Check threatlocker_organizations_for_move_computers for the organization the key is scoped to.' });
      }
    }
    case 'threatlocker_organizations_get_auth_key': {
      logger.info('API call: organizations.getAuthKey');
      try {
        const client = await getClient();
        return shapeRaw(await client.organizations.getAuthKey());
      } catch (err) {
        return toolErrorFromCatch(toolName, err, { hint: 'The API User needs the Edit Organizations permission for this call.' });
      }
    }
    case 'threatlocker_organizations_for_move_computers': {
      logger.info('API call: organizations.forMoveComputers');
      try {
        const client = await getClient();
        const orgs = await client.organizations.listForMoveComputers((args.search as string | undefined) ?? '');
        return withSummary(shapeList(orgs, orgOptionSummary, shapeArgs), { organizations: orgs.length });
      } catch (err) {
        return toolErrorFromCatch(toolName, err, { hint: 'Call threatlocker_status to confirm the key and instance letter.' });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const organizationsHandler: DomainHandler = { getTools, handleCall };
