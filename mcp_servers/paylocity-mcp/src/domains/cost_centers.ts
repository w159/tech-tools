import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  SHAPE_PROPS,
  shapeList,
  extractShapeArgs,
  toolError,
  toolErrorFromCatch,
  type SummaryFn,
} from './_helpers.js';

const costCenterSummary: SummaryFn = (cc) => ({
  costCenterId: cc['costCenterId'] ?? cc['id'],
  name:         cc['name'] ?? cc['description'],
  isActive:     cc['isActive'] ?? cc['active'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'paylocity_cost_centers_list',
      description:
        'List Paylocity cost centers (CoreHR Modern API). Returns id/name pairs needed for cost-center filtering on employees and earnings. Use to discover valid costCenter1/2/3 values before filtering employee or earnings tools.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          ...{
            limit: {
              type: 'number',
              description: 'Page size (max 20 for Paylocity cursor endpoints).',
            },
            nextToken: {
              type: 'string',
              description: 'Opaque cursor from the previous page (pagination.nextToken).',
            },
            companyId: {
              type: 'string',
              description:
                'Override the default companyId for this call (defaults to PAYLOCITY_COMPANY_ID env var).',
            },
          },
        },
      },
    },
  ];
}

async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case 'paylocity_cost_centers_list':
      logger.info('API call: costCenters.list', args);
      try {
        const resp = await client.costCenters.list(args);
        const items = (resp as { items: unknown[] }).items;
        const hint = (resp as { nextToken?: string | null }).nextToken
          ? `Pass nextToken='${(resp as { nextToken: string }).nextToken}' to get the next page.`
          : undefined;
        return shapeList(
          items as Record<string, unknown>[],
          costCenterSummary,
          shapeArgs,
          undefined,
          hint
        );
      } catch (err) {
        return toolErrorFromCatch('paylocity_cost_centers_list', err, {
          hint: 'Verify PAYLOCITY_CLIENT_ID, PAYLOCITY_CLIENT_SECRET, and PAYLOCITY_COMPANY_ID are set.',
        });
      }

    default:
      return toolError('INVALID_ARGS', `Unknown tool: ${toolName}`);
  }
}

export const costCentersHandler: DomainHandler = { getTools, handleCall };
