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

/**
 * Direct deposit summary — omits full account/routing numbers by default.
 * Pass full:true to retrieve the complete record including banking details.
 */
const directDepositSummary: SummaryFn = (dd) => ({
  accountType:    dd['accountType'],
  financialInstitution: dd['financialInstitution'],
  depositType:    dd['depositType'],
  amount:         dd['amount'],
  amountType:     dd['amountType'],
  isActive:       dd['isActive'] ?? dd['active'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'paylocity_direct_deposit_list',
      description:
        "List a single employee's direct deposit accounts (legacy /api/v2). Returns account type, institution, and deposit amount by default. Full account/routing numbers are omitted unless full:true is passed. employeeId is required.",
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
    case 'paylocity_direct_deposit_list': {
      const { employeeId, ...rest } = args as { employeeId?: string; [k: string]: unknown };
      if (!employeeId) {
        return toolError('INVALID_ARGS', 'employeeId is required.', {
          hint: 'Pass the Paylocity employeeId returned by paylocity_employees_list.',
        });
      }
      logger.info('API call: directDeposit.list', { employeeId });
      try {
        const resp = await client.directDeposit.list(employeeId, rest);
        const items = (resp as { items: unknown[] }).items;
        return shapeList(items as Record<string, unknown>[], directDepositSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('paylocity_direct_deposit_list', err, {
          hint: 'Verify the employeeId with paylocity_employees_list first.',
        });
      }
    }

    default:
      return toolError('INVALID_ARGS', `Unknown tool: ${toolName}`);
  }
}

export const directDepositHandler: DomainHandler = { getTools, handleCall };
