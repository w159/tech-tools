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

const payGradeSummary: SummaryFn = (pg) => ({
  payGradeId:  pg['payGradeId'] ?? pg['id'],
  name:        pg['name'] ?? pg['grade'],
  minRate:     pg['minRate'] ?? pg['minimumRate'],
  midRate:     pg['midRate'] ?? pg['midpointRate'],
  maxRate:     pg['maxRate'] ?? pg['maximumRate'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'paylocity_pay_grades_list',
      description:
        'List Paylocity pay grades (Position Management Modern API). Returns grade IDs and min/mid/max ranges by default. Use to map employee positions to their compensation band — combine with paylocity_employees_get to audit pay equity.',
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
    case 'paylocity_pay_grades_list':
      logger.info('API call: payGrades.list', args);
      try {
        const resp = await client.payGrades.list(args);
        const items = (resp as { items: unknown[] }).items;
        const hint = (resp as { nextToken?: string | null }).nextToken
          ? `Pass nextToken='${(resp as { nextToken: string }).nextToken}' to get the next page.`
          : undefined;
        return shapeList(
          items as Record<string, unknown>[],
          payGradeSummary,
          shapeArgs,
          undefined,
          hint
        );
      } catch (err) {
        return toolErrorFromCatch('paylocity_pay_grades_list', err, {
          hint: 'Verify PAYLOCITY_CLIENT_ID, PAYLOCITY_CLIENT_SECRET, and PAYLOCITY_COMPANY_ID are set.',
        });
      }

    default:
      return toolError('INVALID_ARGS', `Unknown tool: ${toolName}`);
  }
}

export const payGradesHandler: DomainHandler = { getTools, handleCall };
