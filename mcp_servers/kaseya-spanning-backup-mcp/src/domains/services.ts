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

// Compact summary: service name, status, and last backup date.
const serviceSummary: SummaryFn = (s) => ({
  service:      s['service']      ?? s['serviceName'] ?? s['name'],
  status:       s['status']       ?? s['backupStatus'],
  lastBackup:   s['lastBackup']   ?? s['lastBackupDate'],
  enabled:      s['enabled']      ?? s['isEnabled'],
  itemCount:    s['itemCount']    ?? s['totalItems'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'spanning_services_list',
      description:
        'Returns the backed-up services for one user (e.g. mail, drive, calendar, contacts). ' +
        'Use this to discover valid service names before calling spanning_backups_list. ' +
        'Requires userId from spanning_users_list.',
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
    case 'spanning_services_list': {
      const userId = args.userId as string;
      if (!userId) {
        return toolError('INVALID_ARGS', 'userId is required.', {
          hint: 'Pass the opaque userId string returned by spanning_users_list.',
        });
      }
      try {
        const client = getClient();
        logger.info('API call: services.list', { userId });
        const result = await client.services.list(userId);
        const items: unknown[] = Array.isArray(result)
          ? result
          : (result as Record<string, unknown>)['services'] as unknown[] ?? (result as Record<string, unknown>)['items'] as unknown[] ?? [];
        return shapeList(items as Record<string, unknown>[], serviceSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('spanning_services_list', err, {
          hint: 'Verify userId with spanning_users_list and that the user has active services.',
        });
      }
    }

    default:
      return unknownTool(toolName);
  }
}

export const servicesHandler: DomainHandler = { getTools, handleCall };
