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
  integrationId: item.integrationId,
  displayName:   item.displayName,
  resourceKinds: item.resourceKinds,
});

const resourceKindSummary: SummaryFn = (item) => ({
  integrationId: item.integrationId,
  resourceKind:  item.resourceKind,
  isScopable:    item.isScopable,
  numResources:  item.numResources,
  numInScope:    item.numInScope,
});

const resourceSummary: SummaryFn = (item) => ({
  resourceId:       item.resourceId,
  displayName:      item.displayName,
  resourceKind:     item.resourceKind,
  externalId:       item.externalId,
});

function getTools(): Tool[] {
  return [
    listTool('vanta_integrations_list', 'List Vanta connected integrations (AWS, Okta, GitHub, etc.). Use to find an integrationId before calling resource or resource-kind tools. Pass full:true for the complete object.', {
      ...SHAPE_PROPS,
    }),
    {
      name: 'vanta_integrations_get',
      description: 'Get a single Vanta integration by integrationId (required). Returns display name and the resource kinds the integration exposes. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          integrationId: { type: 'string', description: 'Integration ID (required), usually the integration slug (e.g. "aws", "github"). Obtain from vanta_integrations_list.' },
          ...SHAPE_PROPS,
        },
        required: ['integrationId'],
      },
    },
    {
      name: 'vanta_integrations_list_resource_kinds',
      description: 'List resource kinds exposed by a Vanta integration (e.g. S3Bucket, EC2Instance) by integrationId (required). Use to discover what resource types can be queried before calling vanta_integrations_list_resources. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          integrationId: { type: 'string', description: 'Integration ID (required), e.g. "aws". Obtain from vanta_integrations_list.' },
          pageSize: { type: 'number', description: 'Page size (default 25, max usually 100).' },
          pageCursor: { type: 'string', description: 'Opaque cursor returned by a previous page as endCursor.' },
          ...SHAPE_PROPS,
        },
        required: ['integrationId'],
      },
    },
    {
      name: 'vanta_integrations_list_resources',
      description: 'List Vanta integration resources of a specific kind; requires integrationId and resourceKind (both required). Use to enumerate cloud resources (e.g. all EC2 instances or S3 buckets) inventoried by the integration. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          integrationId: { type: 'string', description: 'Integration ID (required), e.g. "aws". Obtain from vanta_integrations_list.' },
          resourceKind: { type: 'string', description: 'Resource kind (required), e.g. "S3Bucket". Obtain from vanta_integrations_list_resource_kinds.' },
          connectionId: { type: 'string', description: 'Optional. Filter to a single account connection within the integration.' },
          isInScope: { type: 'boolean', description: 'Optional. When true, return only resources marked in audit scope.' },
          pageSize: { type: 'number', description: 'Page size (default 25, max usually 100).' },
          pageCursor: { type: 'string', description: 'Opaque cursor returned by a previous page as endCursor.' },
          ...SHAPE_PROPS,
        },
        required: ['integrationId', 'resourceKind'],
      },
    },
    {
      name: 'vanta_integrations_get_resource',
      description: 'Get a single Vanta integration resource by integrationId, resourceKind, and resourceId (all required). Returns resource attributes, owner, and scope/compliance details. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          integrationId: { type: 'string', description: 'Integration ID (required), e.g. "aws". Obtain from vanta_integrations_list.' },
          resourceKind: { type: 'string', description: 'Resource kind (required), e.g. "S3Bucket". Obtain from vanta_integrations_list_resource_kinds.' },
          resourceId: { type: 'string', description: 'Resource ID (required). Obtain from vanta_integrations_list_resources.' },
          ...SHAPE_PROPS,
        },
        required: ['integrationId', 'resourceKind', 'resourceId'],
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
        const item = await client.integrations.get(args.integrationId as string);
        return shapeItem(item as unknown as Record<string, unknown>, integrationSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_integrations_get', err, {
          hint: 'Verify integrationId with vanta_integrations_list first.',
        });
      }
    }
    case 'vanta_integrations_list_resource_kinds': {
      const { integrationId, ...rest } = args as { integrationId: string; [k: string]: unknown };
      try {
        const page = await client.integrations.listResourceKinds(integrationId, rest);
        return shapeList(
          page.items,
          resourceKindSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_integrations_list_resource_kinds', err, {
          hint: 'Verify integrationId with vanta_integrations_list first.',
        });
      }
    }
    case 'vanta_integrations_list_resources': {
      const { integrationId, resourceKind, ...rest } = args as { integrationId: string; resourceKind: string; [k: string]: unknown };
      try {
        const page = await client.integrations.listResources(integrationId, resourceKind, rest);
        return shapeList(
          page.items,
          resourceSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_integrations_list_resources', err, {
          hint: 'Verify integrationId and resourceKind. Use vanta_integrations_list_resource_kinds to find valid resource kinds.',
        });
      }
    }
    case 'vanta_integrations_get_resource': {
      try {
        const item = await client.integrations.getResource(
          args.integrationId as string,
          args.resourceKind as string,
          args.resourceId as string,
        );
        return shapeItem(item as unknown as Record<string, unknown>, resourceSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_integrations_get_resource', err, {
          hint: 'Verify integrationId, resourceKind, and resourceId. Use vanta_integrations_list_resources to find valid values.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const integrationsHandler: DomainHandler = { getTools, handleCall };
