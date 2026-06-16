import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeList,
  extractShapeArgs,
  SHAPE_PROPS,
  toolError,
  toolErrorFromCatch,
  type SummaryFn,
} from './_helpers.js';

// ---------------------------------------------------------------------------
// Compact summary
// ---------------------------------------------------------------------------

const userSummary: SummaryFn = (item) => ({
  id:         item.id,
  email:      item.email,
  first_name: item.first_name,
  last_name:  item.last_name,
  org_roles:  item.org_roles,
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function getTools(): Tool[] {
  return [
    {
      name: 'blumira_users_list',
      description: 'List Blumira organization users. Returns user UUIDs, emails, names, and roles. Use to look up sender/owner UUIDs before assigning findings or adding comments.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          page: { type: 'number', description: 'Page number for pagination (default: 1).' },
          page_size: { type: 'number', description: 'Results per page (default: 100).' },
          limit: { type: 'number', description: 'Maximum total records to return (max: 5000).' },
          order_by: { type: 'string', description: 'Sort field and direction, e.g. "email;asc" or "created;desc".' },
        },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);

  try {
    const client = await getClient();

    switch (toolName) {
      case 'blumira_users_list': {
        logger.info('API call: users.list', args);
        const res = await client.users.list(args as any);
        const items = Array.isArray(res) ? res : (res as any)?.results ?? (res as any)?.data ?? [];
        return shapeList(items, userSummary, shapeArgs);
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

export const usersHandler: DomainHandler = { getTools, handleCall };
