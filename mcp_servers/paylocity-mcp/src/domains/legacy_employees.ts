import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  SHAPE_PROPS,
  shapeList,
  shapeItem,
  extractShapeArgs,
  toolError,
  toolErrorFromCatch,
  type SummaryFn,
  legacyListTool,
  getTool,
} from './_helpers.js';

/**
 * Compact legacy employee summary — omits SSN, salary, and raw audit fields.
 * The legacy /api/v2 list endpoint returns only {employeeId, statusCode,
 * statusTypeCode} per record; firstName/lastName and address fields are only
 * available on individual GET responses. Pass full:true or fields:[...] to
 * retrieve additional fields explicitly.
 */
const legacyEmployeeSummary: SummaryFn = (emp) => ({
  employeeId:     emp['employeeId'],
  firstName:      emp['firstName'],
  lastName:       emp['lastName'],
  statusCode:     emp['statusCode'],
  statusTypeCode: emp['statusTypeCode'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'paylocity_legacy_employees_list',
      description:
        'List employees via the legacy /api/v2 endpoint. Returns a compact summary (employeeId, name, status, department, hireDate) by default. Pass full:true or fields:[...] to include compensation fields. No cursor pagination — all records returned at once.',
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
          },
        },
      },
    },
    {
      name: 'paylocity_legacy_employees_get',
      description:
        'Get a single employee by employeeId (required) via the legacy /api/v2 endpoint. Returns a compact summary by default; pass full:true or fields:[...] for compensation details.',
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
        required: ['employeeId'],
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
    case 'paylocity_legacy_employees_list':
      logger.info('API call: legacyEmployees.list', args);
      try {
        const resp = await client.legacyEmployees.list(args);
        const items = (resp as { items: unknown[] }).items;
        return shapeList(items as Record<string, unknown>[], legacyEmployeeSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('paylocity_legacy_employees_list', err, {
          hint: 'Verify PAYLOCITY_CLIENT_ID, PAYLOCITY_CLIENT_SECRET, and PAYLOCITY_COMPANY_ID are set.',
        });
      }

    case 'paylocity_legacy_employees_get': {
      const { employeeId, ...rest } = args as { employeeId?: string; [k: string]: unknown };
      if (!employeeId) {
        return toolError('INVALID_ARGS', 'employeeId is required.', {
          hint: 'Pass the Paylocity employeeId returned by paylocity_legacy_employees_list.',
        });
      }
      try {
        const emp = await client.legacyEmployees.get(employeeId, rest);
        return shapeItem(emp as Record<string, unknown>, legacyEmployeeSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('paylocity_legacy_employees_get', err, {
          hint: 'Verify the employeeId with paylocity_legacy_employees_list first.',
        });
      }
    }

    default:
      return toolError('INVALID_ARGS', `Unknown tool: ${toolName}`);
  }
}

export const legacyEmployeesHandler: DomainHandler = { getTools, handleCall };
