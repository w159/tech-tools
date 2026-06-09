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
  type SummaryFn,
} from './_helpers.js';

// ---------------------------------------------------------------------------
// Compact summaries
// ---------------------------------------------------------------------------

const deviceSummary: SummaryFn = (item) => ({
  id:       item.id,
  hostname: item.hostname,
  status:   item.status,
  lastSeen: item.lastSeen ?? item.last_seen,
  os:       item.os,
  org:      item.org,
});

const keySummary: SummaryFn = (item) => ({
  id:      item.id,
  label:   item.label,
  key:     item.key,
  active:  item.active,
  created: item.created,
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function getTools(): Tool[] {
  return [
    {
      name: 'blumira_agents_devices_list',
      description: 'List Blumira agent-enrolled devices in the organization. Returns device IDs, hostnames, and status. Use to audit agent coverage.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          page: { type: 'number', description: 'Page number.' },
          page_size: { type: 'number', description: 'Results per page.' },
          limit: { type: 'number', description: 'Maximum records to return.' },
          order_by: { type: 'string', description: 'Sort field and direction, e.g. "hostname;asc".' },
        },
      },
    },
    {
      name: 'blumira_agents_devices_get',
      description: 'Get details of a single Blumira agent device by device_id (required). Returns OS, last-seen, and connection state.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          device_id: { type: 'string', description: 'Device UUID (required).' },
        },
        required: ['device_id'],
      },
    },
    {
      name: 'blumira_agents_keys_list',
      description: 'List Blumira agent enrollment keys in the organization. Returns key IDs and labels. Use to identify which keys are active for agent provisioning.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          page: { type: 'number', description: 'Page number.' },
          page_size: { type: 'number', description: 'Results per page.' },
          limit: { type: 'number', description: 'Maximum records to return.' },
          order_by: { type: 'string', description: 'Sort field and direction.' },
        },
      },
    },
    {
      name: 'blumira_agents_keys_get',
      description: 'Get a single Blumira agent enrollment key by key_id (required). Returns the key value and associated metadata.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          key_id: { type: 'string', description: 'Key UUID (required).' },
        },
        required: ['key_id'],
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
      case 'blumira_agents_devices_list': {
        logger.info('API call: agents.listDevices', args);
        const res = await client.agents.listDevices(args as any);
        const items = Array.isArray(res) ? res : (res as any)?.results ?? (res as any)?.data ?? [];
        return shapeList(items, deviceSummary, shapeArgs);
      }
      case 'blumira_agents_devices_get': {
        const id = args.device_id as string;
        if (!id) return toolError('INVALID_ARGS', 'device_id is required.', { hint: 'Pass the device UUID string.' });
        logger.info('API call: agents.getDevice', { id });
        const res = await client.agents.getDevice(id);
        return shapeItem(res as Record<string, unknown>, deviceSummary, shapeArgs);
      }
      case 'blumira_agents_keys_list': {
        logger.info('API call: agents.listKeys', args);
        const res = await client.agents.listKeys(args as any);
        const items = Array.isArray(res) ? res : (res as any)?.results ?? (res as any)?.data ?? [];
        return shapeList(items, keySummary, shapeArgs);
      }
      case 'blumira_agents_keys_get': {
        const id = args.key_id as string;
        if (!id) return toolError('INVALID_ARGS', 'key_id is required.', { hint: 'Pass the key UUID string.' });
        logger.info('API call: agents.getKey', { id });
        const res = await client.agents.getKey(id);
        return shapeItem(res as Record<string, unknown>, keySummary, shapeArgs);
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

export const agentsHandler: DomainHandler = { getTools, handleCall };
