import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeItem,
  shapeRaw,
  extractShapeArgs,
  SHAPE_PROPS,
  toolError,
  toolErrorFromCatch,
  unknownTool,
  type SummaryFn,
} from './_helpers.js';

// Compact summary for a restore job: id, state, progress, and timing.
const restoreSummary: SummaryFn = (r) => ({
  restoreId:    r['restoreId']    ?? r['id'],
  status:       r['status']       ?? r['state'],
  userId:       r['userId']       ?? r['user'],
  service:      r['service']      ?? r['serviceName'],
  itemsRestored: r['itemsRestored'] ?? r['restoredCount'],
  itemsTotal:   r['itemsTotal']   ?? r['totalCount'],
  startedAt:    r['startedAt']    ?? r['createdAt'],
  completedAt:  r['completedAt'],
  error:        r['error']        ?? r['errorMessage'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'spanning_restores_queue',
      description:
        'DESTRUCTIVE: Queues a restore from a backup for a user/service — overwrites existing data in the target mailbox, drive, or calendar. ' +
        'Asynchronous — returns a restoreId immediately. ' +
        'Poll with spanning_restores_get or block with spanning_restores_wait_for. ' +
        'The payload shape varies by service — pass the JSON the API expects for the target service.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          userId:      { type: 'string', description: 'Spanning user ID (required) — opaque string from spanning_users_list.' },
          service:     { type: 'string', description: 'Service name to restore (required) — e.g. mail, drive, calendar, contacts. Use spanning_services_list to enumerate valid values.' },
          backupId:    { type: 'string', description: 'ID of the specific backup/restore-point to restore from (from spanning_backups_list).' },
          destination: { type: 'string', description: 'Optional restore destination override (e.g. alternative mailbox address). Omit to restore to the original user.' },
          itemIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of item IDs for a partial restore. Omit to restore all items from the backup.',
          },
          extra: {
            type: 'object',
            description: 'Optional additional service-specific properties merged into the restore request body.',
            additionalProperties: true,
          },
        },
        required: ['userId', 'service'],
      },
    },
    {
      name: 'spanning_restores_get',
      description:
        'Returns the current status of a queued Spanning restore by restoreId (required). ' +
        'Shows state (pending/running/completed/failed) and progress counters. ' +
        'Obtain restoreId from spanning_restores_queue.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          restoreId: { type: 'string', description: 'Restore ID (required) — from spanning_restores_queue.' },
        },
        required: ['restoreId'],
      },
    },
    {
      name: 'spanning_restores_wait_for',
      description:
        'Polls a restore until it reaches a terminal status (completed, failed, cancelled) or times out. ' +
        'Default interval 30 s, default timeout 10 minutes — chosen to stay within the 100 req/min budget. ' +
        'Production restores of large mailboxes can take hours; set timeoutMs accordingly.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          restoreId:  { type: 'string', description: 'Restore ID (required) — from spanning_restores_queue.' },
          intervalMs: { type: 'number', description: 'Polling interval in milliseconds (default 30000, minimum 5000).' },
          timeoutMs:  { type: 'number', description: 'Total wait timeout in milliseconds (default 600000).' },
        },
        required: ['restoreId'],
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case 'spanning_restores_queue': {
      const userId  = args.userId  as string;
      const service = args.service as string;
      if (!userId)  return toolError('INVALID_ARGS', 'userId is required.', { hint: 'Pass the opaque userId string from spanning_users_list.' });
      if (!service) return toolError('INVALID_ARGS', 'service is required.', { hint: 'Pass the service name from spanning_services_list (e.g. mail, drive, calendar, contacts).' });
      try {
        const client = getClient();
        const extra   = (args.extra as Record<string, unknown> | undefined) || {};
        const payload: Record<string, unknown> = { ...extra };
        if (args.backupId    !== undefined) payload['backupId']    = args.backupId;
        if (args.destination !== undefined) payload['destination'] = args.destination;
        if (args.itemIds     !== undefined) payload['itemIds']     = args.itemIds;
        logger.info('API call: restores.queue', { userId, service, payloadKeys: Object.keys(payload) });
        const result = await client.restores.queue(userId, service, payload);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch('spanning_restores_queue', err, {
          hint: 'Verify userId, service, and backupId are valid. Check SPANNING_ADMIN_EMAIL and SPANNING_API_TOKEN.',
        });
      }
    }

    case 'spanning_restores_get': {
      const restoreId = args.restoreId as string;
      if (!restoreId) {
        return toolError('INVALID_ARGS', 'restoreId is required.', {
          hint: 'Pass the restoreId string returned by spanning_restores_queue.',
        });
      }
      try {
        const client = getClient();
        logger.info('API call: restores.get', { restoreId });
        const result = await client.restores.get(restoreId);
        return shapeItem(result as Record<string, unknown>, restoreSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('spanning_restores_get', err, {
          hint: 'Verify restoreId with spanning_restores_queue output.',
        });
      }
    }

    case 'spanning_restores_wait_for': {
      const restoreId = args.restoreId as string;
      if (!restoreId) {
        return toolError('INVALID_ARGS', 'restoreId is required.', {
          hint: 'Pass the restoreId string returned by spanning_restores_queue.',
        });
      }
      try {
        const client     = getClient();
        const intervalMs = Math.max((args.intervalMs as number | undefined) ?? 30_000, 5_000);
        const timeoutMs  = (args.timeoutMs as number | undefined) ?? 600_000;
        logger.info('API call: restores.waitFor', { restoreId, intervalMs, timeoutMs });
        const result = await client.restores.waitFor(restoreId, { intervalMs, timeoutMs });
        return shapeItem(result as Record<string, unknown>, restoreSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('spanning_restores_wait_for', err, {
          hint: 'The restore may have timed out or the restoreId is invalid.',
        });
      }
    }

    default:
      return unknownTool(toolName);
  }
}

export const restoresHandler: DomainHandler = { getTools, handleCall };
