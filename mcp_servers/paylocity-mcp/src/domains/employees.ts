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
  modernListTool,
  getTool,
} from './_helpers.js';

/**
 * Compact employee summary — omits SSN, salary-like pay rate fields, and raw
 * audit timestamps. Pass full:true or fields:["payRate","..."] to retrieve
 * sensitive compensation fields explicitly.
 */
const employeeSummary: SummaryFn = (emp) => ({
  employeeId: emp['employeeId'],
  firstName:  emp['firstName'],
  lastName:   emp['lastName'],
  status:     emp['status'],
  department: emp['department'],
  jobTitle:   emp['jobTitle'],
  location:   emp['location'],
  hireDate:   emp['hireDate'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'paylocity_employees_list',
      description:
        'List Paylocity employees from the modern CoreHR API. Returns a compact summary (name, status, department, jobTitle, hireDate) by default. Use include to expand fields server-side (info, position, status, payRate, futurePayRate); use fields or full to control which fields the tool returns. Sensitive compensation fields (payRate, futurePayRate) are only included when you explicitly pass full:true or name them in fields.',
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
            include: {
              type: 'string',
              description:
                'CSV of server-side expansion fields. Allowed: info, position, status, payRate, futurePayRate.',
            },
            activeOnly: {
              type: 'boolean',
              description: 'When true, only return active employees.',
            },
            testMode: {
              type: 'boolean',
              description: 'Optional Paylocity test-mode flag.',
            },
          },
        },
      },
    },
    {
      name: 'paylocity_employees_get',
      description:
        'Get a single Paylocity employee by employeeId (required) from the modern CoreHR API. Returns a compact summary by default; pass full:true or fields:[...] to retrieve compensation fields (payRate, futurePayRate). Use include to expand position, payRate, or status server-side.',
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
            include: {
              type: 'string',
              description:
                'CSV of server-side expansion fields (info, position, status, payRate, futurePayRate).',
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
    case 'paylocity_employees_list': {
      logger.info('API call: employees.list', args);
      try {
        const resp = await client.employees.list(args);
        const items = (resp as { items: unknown[] }).items;
        const hint = (resp as { nextToken?: string | null }).nextToken
          ? `Pass nextToken='${(resp as { nextToken: string }).nextToken}' to get the next page.`
          : undefined;
        return shapeList(
          items as Record<string, unknown>[],
          employeeSummary,
          shapeArgs,
          undefined,
          hint
        );
      } catch (err) {
        return toolErrorFromCatch('paylocity_employees_list', err, {
          hint: 'Verify PAYLOCITY_CLIENT_ID, PAYLOCITY_CLIENT_SECRET, and PAYLOCITY_COMPANY_ID are set.',
        });
      }
    }

    case 'paylocity_employees_get': {
      const { employeeId, ...rest } = args as { employeeId?: string; [k: string]: unknown };
      if (!employeeId) {
        return toolError('INVALID_ARGS', 'employeeId is required.', {
          hint: 'Pass the Paylocity employeeId returned by paylocity_employees_list.',
        });
      }
      logger.info('API call: employees.get', { employeeId });
      try {
        const emp = await client.employees.get(employeeId, rest);
        return shapeItem(
          emp as Record<string, unknown>,
          employeeSummary,
          shapeArgs
        );
      } catch (err) {
        return toolErrorFromCatch('paylocity_employees_get', err, {
          hint: 'Verify the employeeId with paylocity_employees_list first.',
        });
      }
    }

    default:
      return toolError('INVALID_ARGS', `Unknown tool: ${toolName}`);
  }
}

export const employeesHandler: DomainHandler = { getTools, handleCall };
