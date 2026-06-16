import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeList,
  toolError,
  toolErrorFromCatch,
  type SummaryFn,
} from './_helpers.js';

// ---------------------------------------------------------------------------
// Compact summary
// ---------------------------------------------------------------------------

const resolutionSummary: SummaryFn = (item) => ({
  id:   item.id,
  name: item.name ?? item.label,
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function getTools(): Tool[] {
  return [
    {
      name: 'blumira_resolutions_list',
      description: 'List all Blumira finding resolution codes and labels. Use to confirm valid resolution IDs before calling blumira_findings_resolve.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleCall(toolName: string, _args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const client = await getClient();

    switch (toolName) {
      case 'blumira_resolutions_list': {
        logger.info('API call: resolutions.list');
        const res = await client.resolutions.list();
        const items = Array.isArray(res) ? res : (res as any)?.results ?? (res as any)?.data ?? [];
        return shapeList(items, resolutionSummary, {});
      }
      default:
        return toolError('INVALID_ARGS', `Unknown tool: ${toolName}`);
    }
  } catch (err: unknown) {
    return toolErrorFromCatch(toolName, err, {
      hint: 'Verify BLUMIRA_JWT_TOKEN or BLUMIRA_CLIENT_ID + BLUMIRA_CLIENT_SECRET are correct.',
    });
  }
}

export const resolutionsHandler: DomainHandler = { getTools, handleCall };
