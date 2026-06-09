import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeList, shapeItem, extractShapeArgs, SHAPE_PROPS,
  toolErrorFromCatch,
  listTool,
  type SummaryFn,
} from './_helpers.js';

const integrationSummary: SummaryFn = (item) => ({
  connectionId: item.connectionId,
  name:         item.name,
  status:       item.status,
  lastSyncedAt: item.lastSyncedAt,
  provider:     item.provider,
});

const resourceKindSummary: SummaryFn = (item) => ({
  kind:        item.kind,
  displayName: item.displayName,
  count:       item.count,
});

const resourceSummary: SummaryFn = (item) => ({
  id:           item.id,
  name:         item.name,
  kind:         item.kind,
  status:       item.status,
  complianceStatus: item.complianceStatus,
});

function getTools(): Tool[] {
  return [
    listTool('vanta_integrations_list', 'List Vanta connected integrations (AWS, Okta, GitHub, etc.) with sync status. Use to find a connectionId before calling resource or resource-kind tools. Pass full:true for the complete object.', {
      ...SHAPE_PROPS,
    }),
    {
      name: 'vanta_integrations_get',
      description: 'Get a single Vanta integration by connectionId (required). Returns sync status, last sync timestamp, and configuration details. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          connectionId: { type: 'string', description: 'Connection ID (required). Obtain from vanta_integrations_list.' },
          ...SHAPE_PROPS,
        },
        required: ['connectionId'],
      },
    },
    {
      name: 'vanta_integrations_list_resource_kinds',
      description: 'List resource kinds exposed by a Vanta integration (e.g. ec2_instance, s3_bucket) by connectionId (required). Use to discover what resource types can be queried before calling vanta_integrations_list_resources. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          connectionId: { type: 'string', description: 'Connection ID (required). Obtain from vanta_integrations_list.' },
          pageSize: { type: 'number' },
          pageCursor: { type: 'string' },
          ...SHAPE_PROPS,
        },
        required: ['connectionId'],
      },
    },
    {
      name: 'vanta_integrations_list_resources',
      description: 'List Vanta integration resources of a specific kind; requires connectionId and resourceKind (both required). Use to enumerate cloud resources (e.g. all EC2 instances or S3 buckets) inventoried by the integration. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          connectionId: { type: 'string', description: 'Connection ID (required). Obtain from vanta_integrations_list.' },
          resourceKind: { type: 'string', description: 'Resource kind (required). Obtain from vanta_integrations_list_resource_kinds.' },
          pageSize: { type: 'number' },
          pageCursor: { type: 'string' },
          ...SHAPE_PROPS,
        },
        required: ['connectionId', 'resourceKind'],
      },
    },
    {
      name: 'vanta_integrations_get_resource',
      description: 'Get a single Vanta integration resource by resourceId (required). Returns resource attributes, compliance findings, and linked controls. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          resourceId: { type: 'string', description: 'Resource ID (required). Obtain from vanta_integrations_list_resources.' },
          ...SHAPE_PROPS,
        },
        required: ['resourceId'],
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  switch (toolName) {
    case 'vanta_integrations_list': {
      logger.info('API call: integrations.list', args);
      try {
        const page = await client.integrations.list(args);
        return shapeList(
          page.items,
          integrationSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_integrations_list', err, {
          hint: 'Check VANTA_CLIENT_ID and VANTA_CLIENT_SECRET.',
        });
      }
    }
    case 'vanta_integrations_get': {
      try {
        const item = await client.integrations.get(args.connectionId as string);
        return shapeItem(item as unknown as Record<string, unknown>, integrationSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_integrations_get', err, {
          hint: 'Verify connectionId with vanta_integrations_list first.',
        });
      }
    }
    case 'vanta_integrations_list_resource_kinds': {
      const { connectionId, ...rest } = args as { connectionId: string; [k: string]: unknown };
      try {
        const page = await client.integrations.listResourceKinds(connectionId, rest);
        return shapeList(
          page.items,
          resourceKindSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_integrations_list_resource_kinds', err, {
          hint: 'Verify connectionId with vanta_integrations_list first.',
        });
      }
    }
    case 'vanta_integrations_list_resources': {
      const { connectionId, resourceKind, ...rest } = args as { connectionId: string; resourceKind: string; [k: string]: unknown };
      try {
        const page = await client.integrations.listResources(connectionId, resourceKind, rest);
        return shapeList(
          page.items,
          resourceSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_integrations_list_resources', err, {
          hint: 'Verify connectionId and resourceKind. Use vanta_integrations_list_resource_kinds to find valid resource kinds.',
        });
      }
    }
    case 'vanta_integrations_get_resource': {
      try {
        const item = await client.integrations.getResource(args.resourceId as string);
        return shapeItem(item as unknown as Record<string, unknown>, resourceSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_integrations_get_resource', err, {
          hint: 'Verify resourceId with vanta_integrations_list_resources first.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const integrationsHandler: DomainHandler = { getTools, handleCall };
