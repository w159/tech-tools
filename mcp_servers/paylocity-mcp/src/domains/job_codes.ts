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

const jobCodeSummary: SummaryFn = (jc) => ({
  jobCodeId: jc['jobCodeId'] ?? jc['id'],
  code:      jc['code'],
  title:     jc['title'] ?? jc['name'],
  grade:     jc['grade'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'paylocity_job_codes_list',
      description:
        'List Paylocity job codes (Position Management Modern API). Returns code, title, and grade rows by default. Use to discover valid jobCode values for employee position records or pay-band analysis.',
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
    case 'paylocity_job_codes_list':
      logger.info('API call: jobCodes.list', args);
      try {
        const resp = await client.jobCodes.list(args);
        const items = (resp as { items: unknown[] }).items;
        const hint = (resp as { nextToken?: string | null }).nextToken
          ? `Pass nextToken='${(resp as { nextToken: string }).nextToken}' to get the next page.`
          : undefined;
        return shapeList(
          items as Record<string, unknown>[],
          jobCodeSummary,
          shapeArgs,
          undefined,
          hint
        );
      } catch (err) {
        return toolErrorFromCatch('paylocity_job_codes_list', err, {
          hint: 'Verify PAYLOCITY_CLIENT_ID, PAYLOCITY_CLIENT_SECRET, and PAYLOCITY_COMPANY_ID are set.',
        });
      }

    default:
      return toolError('INVALID_ARGS', `Unknown tool: ${toolName}`);
  }
}

export const jobCodesHandler: DomainHandler = { getTools, handleCall };
