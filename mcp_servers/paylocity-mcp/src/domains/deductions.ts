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

const deductionSummary: SummaryFn = (d) => ({
  deductionCode:  d['deductionCode'],
  deductionName:  d['deductionName'],
  deductionAmount: d['deductionAmount'] ?? d['amount'],
  effectiveDate:  d['effectiveDate'],
  endDate:        d['endDate'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'paylocity_deductions_list',
      description:
        "List all payroll deductions for a single Paylocity employee (employeeId required). Returns deduction codes, amounts, and effective dates by default via legacy /api/v1.",
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          ...{
            companyId: {
              type: 'string',
              description:
                'Override the default companyId for this call (defaults to PAYLOCITY_COMPANY_ID env var).',
            },
            employeeId: {
              type: 'string',
              description: 'Paylocity employeeId (required).',
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
    case 'paylocity_deductions_list': {
      const { employeeId, ...rest } = args as { employeeId?: string; [k: string]: unknown };
      if (!employeeId) {
        return toolError('INVALID_ARGS', 'employeeId is required.', {
          hint: 'Pass the Paylocity employeeId returned by paylocity_employees_list.',
        });
      }
      logger.info('API call: deductions.list', { employeeId });
      try {
        const resp = await client.deductions.list(employeeId, rest);
        const items = (resp as { items: unknown[] }).items;
        return shapeList(items as Record<string, unknown>[], deductionSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('paylocity_deductions_list', err, {
          hint: 'Verify the employeeId with paylocity_employees_list first.',
        });
      }
    }

    default:
      return toolError('INVALID_ARGS', `Unknown tool: ${toolName}`);
  }
}

export const deductionsHandler: DomainHandler = { getTools, handleCall };
