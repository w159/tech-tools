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

const companyEarningSummary: SummaryFn = (e) => ({
  earningCodeId: e['earningCodeId'] ?? e['id'],
  description:   e['description'] ?? e['name'],
  earningType:   e['earningType'],
  isTaxable:     e['isTaxable'],
});

const employeeEarningSummary: SummaryFn = (e) => ({
  earningCodeId: e['earningCodeId'],
  amount:        e['amount'],
  annualMaximum: e['annualMaximum'],
  effectiveDate: e['effectiveDate'],
  endDate:       e['endDate'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'paylocity_earnings_company_list',
      description:
        'List company-level earning codes (Modern Payroll API). Returns earning code IDs, descriptions, and taxability flags by default. Use to discover valid earnings codes before reading employee pay statements with paylocity_pay_statements_*.',
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
    {
      name: 'paylocity_earnings_employee_list',
      description:
        "List a single employee's configured earnings (read-only; legacy WebLink GET /api/v2/.../earnings). Returns earning code, amounts, and effective dates by default. employeeId is required.",
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
    case 'paylocity_earnings_company_list':
      logger.info('API call: earnings.listCompanyEarnings', args);
      try {
        const resp = await client.earnings.listCompanyEarnings(args);
        const items = (resp as { items: unknown[] }).items;
        const hint = (resp as { nextToken?: string | null }).nextToken
          ? `Pass nextToken='${(resp as { nextToken: string }).nextToken}' to get the next page.`
          : undefined;
        return shapeList(
          items as Record<string, unknown>[],
          companyEarningSummary,
          shapeArgs,
          undefined,
          hint
        );
      } catch (err) {
        return toolErrorFromCatch('paylocity_earnings_company_list', err, {
          hint: 'Verify PAYLOCITY_CLIENT_ID, PAYLOCITY_CLIENT_SECRET, and PAYLOCITY_COMPANY_ID are set.',
        });
      }

    case 'paylocity_earnings_employee_list': {
      const { employeeId, ...rest } = args as { employeeId?: string; [k: string]: unknown };
      if (!employeeId) {
        return toolError('INVALID_ARGS', 'employeeId is required.', {
          hint: 'Pass the Paylocity employeeId returned by paylocity_employees_list.',
        });
      }
      logger.info('API call: earnings.listEmployeeEarnings', { employeeId });
      try {
        const resp = await client.earnings.listEmployeeEarnings(employeeId, rest);
        const items = (resp as { items: unknown[] }).items;
        return shapeList(items as Record<string, unknown>[], employeeEarningSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('paylocity_earnings_employee_list', err, {
          hint: 'Verify the employeeId with paylocity_employees_list first.',
        });
      }
    }

    default:
      return toolError('INVALID_ARGS', `Unknown tool: ${toolName}`);
  }
}

export const earningsHandler: DomainHandler = { getTools, handleCall };
