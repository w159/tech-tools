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
  unknownTool,
  type SummaryFn,
} from './_helpers.js';

// Compact summary: id, user, status, lastBackup date, and error count.
const backupSummary: SummaryFn = (b) => ({
  backupId:   b['backupId']   ?? b['id'],
  userId:     b['userId']     ?? b['user'],
  service:    b['service']    ?? b['serviceName'],
  status:     b['status']     ?? b['backupStatus'],
  lastBackup: b['lastBackup'] ?? b['backupDate'] ?? b['timestamp'],
  errorCount: b['errorCount'] ?? b['errors'] ?? b['errorItems'],
  itemCount:  b['itemCount']  ?? b['totalItems'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'spanning_backups_list',
      description:
        'Returns one page of backup runs for a specific user and service (one record per day). ' +
        'Pass userId from spanning_users_list and service from spanning_services_list. ' +
        'Cursor-paginated — pass cursor from the previous response to advance.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          userId:  { type: 'string', description: 'Spanning user ID (required) — opaque string from spanning_users_list.' },
          service: { type: 'string', description: 'Service name (required) — e.g. mail, drive, calendar, contacts. Use spanning_services_list to enumerate valid values.' },
          limit:   { type: 'number', description: 'Page size — backups per page (integer 1-500, default 100).' },
          cursor:  { type: 'string', description: 'Opaque cursor from the previous page response.' },
        },
        required: ['userId', 'service'],
      },
    },
    {
      name: 'spanning_backups_list_all',
      description:
        'Iterates every backup run for a user/service across all pages and returns the full collection. ' +
        'Use sparingly — Spanning enforces 100 req/min. ' +
        'Both userId and service are required.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          userId:   { type: 'string', description: 'Spanning user ID (required) — opaque string from spanning_users_list.' },
          service:  { type: 'string', description: 'Service name (required) — e.g. mail, drive, calendar, contacts.' },
          limit:    { type: 'number', description: 'Page size per fetch (integer 1-500, default 100).' },
          maxItems: { type: 'number', description: 'Optional hard cap on total items returned across all pages.' },
        },
        required: ['userId', 'service'],
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case 'spanning_backups_list': {
      const userId  = args.userId  as string;
      const service = args.service as string;
      if (!userId)  return toolError('INVALID_ARGS', 'userId is required.', { hint: 'Pass the opaque userId string from spanning_users_list.' });
      if (!service) return toolError('INVALID_ARGS', 'service is required.', { hint: 'Pass the service name from spanning_services_list (e.g. mail, drive, calendar, contacts).' });
      try {
        const client = getClient();
        const params = {
          limit:  args.limit  as number | undefined,
          cursor: args.cursor as string | undefined,
        };
        logger.info('API call: backups.list', { userId, service, ...params });
        const result = await client.backups.list(userId, service, params);
        const items: unknown[] = Array.isArray(result)
          ? result
          : (result as Record<string, unknown>)['backups'] as unknown[] ?? (result as Record<string, unknown>)['items'] as unknown[] ?? [];
        const next = (result as Record<string, unknown>)['next'] as string | undefined;
        return shapeList(
          items as Record<string, unknown>[],
          backupSummary,
          shapeArgs,
          undefined,
          next ? `Pass cursor='${next}' to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('spanning_backups_list', err, {
          hint: 'Verify userId with spanning_users_list and service with spanning_services_list.',
        });
      }
    }

    case 'spanning_backups_list_all': {
      const userId  = args.userId  as string;
      const service = args.service as string;
      if (!userId)  return toolError('INVALID_ARGS', 'userId is required.', { hint: 'Pass the opaque userId string from spanning_users_list.' });
      if (!service) return toolError('INVALID_ARGS', 'service is required.', { hint: 'Pass the service name from spanning_services_list (e.g. mail, drive, calendar, contacts).' });
      try {
        const client  = getClient();
        const limit    = args.limit    as number | undefined;
        const maxItems = (args.maxItems as number | undefined) ?? Infinity;
        const items: Record<string, unknown>[] = [];
        logger.info('API call: backups.listAll', { userId, service, limit, maxItems });
        for await (const item of client.backups.listAll(userId, service, limit ? { limit } : undefined)) {
          items.push(item as Record<string, unknown>);
          if (items.length >= maxItems) break;
        }
        return shapeList(items, backupSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('spanning_backups_list_all', err, {
          hint: 'Verify userId and service are correct.',
        });
      }
    }

    default:
      return unknownTool(toolName);
  }
}

export const backupsHandler: DomainHandler = { getTools, handleCall };
