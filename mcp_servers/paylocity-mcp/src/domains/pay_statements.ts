import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  SHAPE_PROPS,
  shapeItem,
  extractShapeArgs,
  toolError,
  toolErrorFromCatch,
  type SummaryFn,
} from './_helpers.js';

/**
 * Pay statement summary — keeps year-level totals, omits per-period breakdowns
 * by default. Pass full:true to get the complete period-by-period detail.
 */
const payStatementSummary: SummaryFn = (ps) => ({
  year:            ps['year'],
  grossPay:        ps['grossPay'],
  netPay:          ps['netPay'],
  totalDeductions: ps['totalDeductions'],
  totalTaxes:      ps['totalTaxes'],
  payPeriodCount:  Array.isArray(ps['payPeriods'])
    ? (ps['payPeriods'] as unknown[]).length
    : ps['payPeriodCount'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'paylocity_pay_statements_summary',
      description:
        'Get the yearly pay statement summary for a Paylocity employee (employeeId and year both required). Returns gross pay, net pay, total deductions, and total taxes by default. Pass full:true for the full period-by-period detail.',
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
            year: {
              type: 'number',
              description: 'Calendar year (required, e.g. 2024).',
            },
          },
        },
        required: ['employeeId', 'year'],
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
    case 'paylocity_pay_statements_summary': {
      const { employeeId, year, companyId } = args as {
        employeeId?: string;
        year?: number;
        companyId?: string;
      };
      if (!employeeId) {
        return toolError('INVALID_ARGS', 'employeeId is required.', {
          hint: 'Pass the Paylocity employeeId returned by paylocity_employees_list.',
        });
      }
      if (typeof year !== 'number') {
        return toolError('INVALID_ARGS', 'year (number) is required.', {
          hint: 'Pass a four-digit calendar year, e.g. 2024.',
        });
      }
      logger.info('API call: payStatements.getYearlySummary', { employeeId, year });
      try {
        const resp = await client.payStatements.getYearlySummary(employeeId, year, { companyId });
        return shapeItem(resp as Record<string, unknown>, payStatementSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('paylocity_pay_statements_summary', err, {
          hint: 'Verify the employeeId and year. The year must be a calendar year for which the employee has pay records.',
        });
      }
    }

    default:
      return toolError('INVALID_ARGS', `Unknown tool: ${toolName}`);
  }
}

export const payStatementsHandler: DomainHandler = { getTools, handleCall };
