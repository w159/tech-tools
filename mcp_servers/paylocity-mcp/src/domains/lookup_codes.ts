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

const lookupCodeSummary: SummaryFn = (lc) => ({
  code:        lc['code'],
  description: lc['description'] ?? lc['name'],
  isActive:    lc['isActive'] ?? lc['active'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'paylocity_lookup_codes_list',
      description:
        'List lookup codes for a given resource (e.g. paygroup, EEO, positions, departments). Returns code and description by default. codeResource is required. Legacy /api/v2.',
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
            codeResource: {
              type: 'string',
              description:
                'Code resource name (required). Common values: paygroup, EEO, positions, departments, supervisor, costCenter1, costCenter2, costCenter3.',
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
    case 'paylocity_lookup_codes_list': {
      const { codeResource, ...rest } = args as {
        codeResource?: string;
        [k: string]: unknown;
      };
      if (!codeResource) {
        return toolError('INVALID_ARGS', 'codeResource is required.', {
          hint: 'Common values: paygroup, EEO, positions, departments, supervisor, costCenter1, costCenter2, costCenter3.',
        });
      }
      logger.info('API call: lookupCodes.list', { codeResource });
      try {
        const resp = await client.lookupCodes.list(codeResource, rest);
        const items = (resp as { items: unknown[] }).items;
        return shapeList(items as Record<string, unknown>[], lookupCodeSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('paylocity_lookup_codes_list', err, {
          hint: 'Verify codeResource is a valid Paylocity lookup resource name.',
        });
      }
    }

    default:
      return toolError('INVALID_ARGS', `Unknown tool: ${toolName}`);
  }
}

export const lookupCodesHandler: DomainHandler = { getTools, handleCall };
