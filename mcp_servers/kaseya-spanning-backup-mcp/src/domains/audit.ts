import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeList,
  extractShapeArgs,
  SHAPE_PROPS,
  toolErrorFromCatch,
  unknownTool,
  type SummaryFn,
} from './_helpers.js';

// Compact summary: id, action type, acting user, and timestamp.
const auditSummary: SummaryFn = (e) => ({
  auditId:    e['auditId']    ?? e['id'],
  action:     e['action']     ?? e['eventType'] ?? e['type'],
  user:       e['user']       ?? e['adminEmail'] ?? e['actorEmail'],
  targetUser: e['targetUser'] ?? e['affectedUser'],
  timestamp:  e['timestamp']  ?? e['createdAt']  ?? e['date'],
  details:    e['details']    ?? e['description'],
});

function getTools(): Tool[] {
  return [
    {
      name: 'spanning_audit_list',
      description:
        'Returns one page of admin audit log entries (token generation, restore actions, license changes, sign-ins). ' +
        'Optionally bounded by ISO 8601 from/to dates. ' +
        'Cursor-paginated — pass cursor from the previous response to advance.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          from:   { type: 'string', description: 'ISO 8601 datetime lower bound (inclusive), e.g. 2024-01-01T00:00:00Z.' },
          to:     { type: 'string', description: 'ISO 8601 datetime upper bound (inclusive), e.g. 2024-12-31T23:59:59Z.' },
          limit:  { type: 'number', description: 'Page size — entries per page (integer 1-500, default 100).' },
          cursor: { type: 'string', description: 'Opaque cursor from the previous page response.' },
        },
      },
    },
    {
      name: 'spanning_audit_list_all',
      description:
        'Iterates every audit entry across all pages (within optional from/to bounds) and returns the full collection. ' +
        'Use sparingly on large date windows — Spanning enforces 100 req/min.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          from:     { type: 'string', description: 'ISO 8601 datetime lower bound (inclusive), e.g. 2024-01-01T00:00:00Z.' },
          to:       { type: 'string', description: 'ISO 8601 datetime upper bound (inclusive), e.g. 2024-12-31T23:59:59Z.' },
          limit:    { type: 'number', description: 'Page size per fetch (integer 1-500, default 100).' },
          maxItems: { type: 'number', description: 'Optional hard cap on total items returned across all pages.' },
        },
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case 'spanning_audit_list': {
      try {
        const client = getClient();
        const params = {
          from:   args.from   as string | undefined,
          to:     args.to     as string | undefined,
          limit:  args.limit  as number | undefined,
          cursor: args.cursor as string | undefined,
        };
        logger.info('API call: audit.list', params);
        const result = await client.audit.list(params);
        const items: unknown[] = Array.isArray(result)
          ? result
          : (result as Record<string, unknown>)['auditEvents'] as unknown[] ?? (result as Record<string, unknown>)['items'] as unknown[] ?? [];
        const next = (result as Record<string, unknown>)['next'] as string | undefined;
        return shapeList(
          items as Record<string, unknown>[],
          auditSummary,
          shapeArgs,
          undefined,
          next ? `Pass cursor='${next}' to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('spanning_audit_list', err, {
          hint: 'Verify SPANNING_ADMIN_EMAIL, SPANNING_API_TOKEN, and SPANNING_PLATFORM are correct.',
        });
      }
    }

    case 'spanning_audit_list_all': {
      try {
        const client = getClient();
        const from     = args.from     as string | undefined;
        const to       = args.to       as string | undefined;
        const limit    = args.limit    as number | undefined;
        const maxItems = (args.maxItems as number | undefined) ?? Infinity;
        const items: Record<string, unknown>[] = [];
        logger.info('API call: audit.listAll', { from, to, limit, maxItems });
        const iterParams: Record<string, unknown> = {};
        if (limit) iterParams['limit'] = limit;
        if (from)  iterParams['from']  = from;
        if (to)    iterParams['to']    = to;
        for await (const item of client.audit.listAll(iterParams as Parameters<typeof client.audit.listAll>[0])) {
          items.push(item as Record<string, unknown>);
          if (items.length >= maxItems) break;
        }
        return shapeList(items, auditSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('spanning_audit_list_all', err, {
          hint: 'Verify SPANNING_ADMIN_EMAIL, SPANNING_API_TOKEN, and SPANNING_PLATFORM are correct.',
        });
      }
    }

    default:
      return unknownTool(toolName);
  }
}

export const auditHandler: DomainHandler = { getTools, handleCall };
