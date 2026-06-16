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

const localTaxSummary: SummaryFn = (t) => ({
  taxCode:       t['taxCode'],
  taxName:       t['taxName'],
  exemptions:    t['exemptions'],
  filingStatus:  t['filingStatus'],
  effectiveDate: t['effectiveDate'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'paylocity_taxes_local_list',
      description:
        "List a single employee's local taxes (read-only; legacy WebLink GET /api/v2/.../localTaxes). Returns tax codes, filing status, and exemptions by default. employeeId is required.",
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
    case 'paylocity_taxes_local_list': {
      const { employeeId, ...rest } = args as { employeeId?: string; [k: string]: unknown };
      if (!employeeId) {
        return toolError('INVALID_ARGS', 'employeeId is required.', {
          hint: 'Pass the Paylocity employeeId returned by paylocity_employees_list.',
        });
      }
      logger.info('API call: localTaxes.list', { employeeId });
      try {
        const resp = await client.localTaxes.list(employeeId, rest);
        const items = (resp as { items: unknown[] }).items;
        return shapeList(items as Record<string, unknown>[], localTaxSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('paylocity_taxes_local_list', err, {
          hint: 'Verify the employeeId with paylocity_employees_list first.',
        });
      }
    }

    default:
      return toolError('INVALID_ARGS', `Unknown tool: ${toolName}`);
  }
}

export const taxesHandler: DomainHandler = { getTools, handleCall };
