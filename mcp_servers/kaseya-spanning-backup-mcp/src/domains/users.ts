import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeList,
  shapeItem,
  extractShapeArgs,
  SHAPE_PROPS,
  toolError,
  toolErrorFromCatch,
  unknownTool,
  type SummaryFn,
} from './_helpers.js';

// Compact summary: enough to identify the user and understand their backup state.
const userSummary: SummaryFn = (u) => ({
  userId:           u['userId']           ?? u['id'],
  email:            u['email']            ?? u['userPrincipalName'],
  displayName:      u['displayName']      ?? u['name'],
  backupEnabled:    u['backupEnabled']    ?? u['isBackupEnabled'],
  assignedLicense:  u['assignedLicense']  ?? u['licenseAssigned'],
  lastBackupStatus: u['lastBackupStatus'] ?? u['status'],
  lastBackupDate:   u['lastBackupDate']   ?? u['lastBackup'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'spanning_users_list',
      description:
        'Returns one page of Spanning backed-up users with their backup-enabled state and last-backup status. ' +
        'Cursor-paginated — pass cursor from the previous response to advance. ' +
        'Use spanning_users_get to fetch a single user by ID.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          limit:  { type: 'number', description: 'Page size — users per page (integer 1-500, default 100).' },
          cursor: { type: 'string', description: 'Opaque cursor returned from the previous page response.' },
        },
      },
    },
    {
      name: 'spanning_users_list_all',
      description:
        'Iterates every backed-up user across all pages and returns the full collection. ' +
        'Use sparingly on large tenants — Spanning enforces 100 req/min. ' +
        'Prefer spanning_users_list with cursor pagination for large orgs.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          limit:    { type: 'number', description: 'Page size per fetch (integer 1-500, default 100).' },
          maxItems: { type: 'number', description: 'Optional hard cap on total items returned across all pages.' },
        },
      },
    },
    {
      name: 'spanning_users_get',
      description:
        'Returns a single Spanning backed-up user by userId (required). ' +
        'Includes backup-enabled state, email, and per-service summary. ' +
        'Obtain userId from spanning_users_list.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          userId: { type: 'string', description: 'Spanning user ID (required) — opaque string from spanning_users_list.' },
        },
        required: ['userId'],
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case 'spanning_users_list': {
      try {
        const client = getClient();
        const params = {
          limit:  args.limit  as number | undefined,
          cursor: args.cursor as string | undefined,
        };
        logger.info('API call: users.list', params);
        const result = await client.users.list(params);
        const items: unknown[] = Array.isArray(result)
          ? result
          : (result as Record<string, unknown>)['users'] as unknown[] ?? (result as Record<string, unknown>)['items'] as unknown[] ?? [];
        const next = (result as Record<string, unknown>)['next'] as string | undefined;
        return shapeList(
          items as Record<string, unknown>[],
          userSummary,
          shapeArgs,
          undefined,
          next ? `Pass cursor='${next}' to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('spanning_users_list', err, {
          hint: 'Verify SPANNING_ADMIN_EMAIL, SPANNING_API_TOKEN, and SPANNING_PLATFORM are correct.',
        });
      }
    }

    case 'spanning_users_list_all': {
      try {
        const client = getClient();
        const limit    = args.limit    as number | undefined;
        const maxItems = (args.maxItems as number | undefined) ?? Infinity;
        const items: Record<string, unknown>[] = [];
        logger.info('API call: users.listAll', { limit, maxItems });
        for await (const item of client.users.listAll(limit ? { limit } : undefined)) {
          items.push(item as Record<string, unknown>);
          if (items.length >= maxItems) break;
        }
        return shapeList(items, userSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('spanning_users_list_all', err, {
          hint: 'Verify SPANNING_ADMIN_EMAIL, SPANNING_API_TOKEN, and SPANNING_PLATFORM are correct.',
        });
      }
    }

    case 'spanning_users_get': {
      const userId = args.userId as string;
      if (!userId) {
        return toolError('INVALID_ARGS', 'userId is required.', {
          hint: 'Pass the opaque userId string returned by spanning_users_list.',
        });
      }
      try {
        const client = getClient();
        logger.info('API call: users.get', { userId });
        const user = await client.users.get(userId);
        return shapeItem(user as Record<string, unknown>, userSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('spanning_users_get', err, {
          hint: 'Verify userId with spanning_users_list.',
        });
      }
    }

    default:
      return unknownTool(toolName);
  }
}

export const usersHandler: DomainHandler = { getTools, handleCall };
