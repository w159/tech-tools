import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { elicitSelection } from '../utils/elicitation.js';
import {
  shapeList, shapeItem, shapeRaw,
  extractShapeArgs, SHAPE_PROPS,
  toolErrorFromCatch,
  type SummaryFn,
} from './_helpers.js';

// Compact summary: id, action, user, computer, policy, timestamp
const auditSummary: SummaryFn = (item) => ({
  id:           item.id ?? item.actionLogId,
  action:       item.action ?? item.actionType,
  userName:     item.userName ?? item.user,
  computerName: item.computerName ?? item.computer,
  policyName:   item.policyName ?? item.policy,
  dateTime:     item.dateTime ?? item.actionDateTime,
  status:       item.status ?? item.actionStatus,
});

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_audit_search',
      description: 'Search ThreatLocker audit log for application execution events; filter by searchText, startDate/endDate (ISO 8601), and childOrganizations. Use to investigate blocked or allowed application events. Returns compact summaries by default; pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          searchText: { type: 'string', description: 'Free-text search applied to application name, path, or user.' },
          startDate: { type: 'string', description: 'ISO 8601 datetime — return only entries at or after this time (e.g. 2024-01-01T00:00:00Z).' },
          endDate: { type: 'string', description: 'ISO 8601 datetime — return only entries at or before this time.' },
          pageNumber: { type: 'number', description: 'Page number for pagination (default: 1).' },
          pageSize: { type: 'number', description: 'Page size — records per page (default: 50).' },
          childOrganizations: { type: 'boolean', description: 'When true, includes audit entries from child organizations.' },
        },
      },
    },
    {
      name: 'threatlocker_audit_get',
      description: 'Get a single ThreatLocker audit log entry by actionLogId (required). Returns full event details including application path, hash, user, and action taken. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          actionLogId: { type: 'string', description: 'UUID string identifying the specific audit log action entry.' },
        },
        required: ['actionLogId'],
      },
    },
    {
      name: 'threatlocker_audit_file_history',
      description: 'Get ThreatLocker audit history for a specific file path (fullPath required, e.g. C:\\Windows\\System32\\cmd.exe). Returns all execution and block events for that file. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          fullPath: { type: 'string', description: 'Absolute filesystem path of the file to retrieve audit history for (e.g. C:\\Windows\\System32\\cmd.exe).' },
        },
        required: ['fullPath'],
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case 'threatlocker_audit_search': {
      // Elicitation: if no searchText AND no date range, elicit date range
      const hasSearchText = !!args.searchText;
      const hasDateRange = !!(args.startDate || args.endDate);

      let startDate = args.startDate as string | undefined;
      let endDate = args.endDate as string | undefined;

      if (!hasSearchText && !hasDateRange) {
        const dateChoice = await elicitSelection(
          'Select audit log date range:',
          ['Last 24h', 'Last 7d', 'Last 30d', 'Custom'],
          'Last 24h'
        );

        const now = new Date();
        if (dateChoice === 'Last 24h') {
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
          endDate = now.toISOString();
        } else if (dateChoice === 'Last 7d') {
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
          endDate = now.toISOString();
        } else if (dateChoice === 'Last 30d') {
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
          endDate = now.toISOString();
        }
        // For 'Custom', leave dates undefined to prompt user to specify
      }

      const params = {
        searchText: args.searchText as string | undefined,
        startDate,
        endDate,
        pageNumber: args.pageNumber as number | undefined,
        pageSize: args.pageSize as number | undefined,
        childOrganizations: args.childOrganizations as boolean | undefined,
      };
      logger.info('API call: auditLog.search', params);
      try {
        const client = await getClient();
        const result = await client.auditLog.search(params);
        const items = Array.isArray(result) ? result : (result?.items ?? result?.data ?? [result]);
        return shapeList(items, auditSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_audit_search', err, {
          hint: 'Verify THREATLOCKER_API_KEY and THREATLOCKER_ORGANIZATION_ID are set. Try narrowing the date range.',
        });
      }
    }
    case 'threatlocker_audit_get': {
      const actionLogId = args.actionLogId as string;
      logger.info('API call: auditLog.get', { actionLogId });
      try {
        const client = await getClient();
        const auditEntry = await client.auditLog.get(actionLogId);
        return shapeItem(auditEntry as Record<string, unknown>, auditSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_audit_get', err, {
          hint: 'Verify the actionLogId with threatlocker_audit_search first.',
        });
      }
    }
    case 'threatlocker_audit_file_history': {
      const fullPath = args.fullPath as string;
      logger.info('API call: auditLog.fileHistory', { fullPath });
      try {
        const client = await getClient();
        const history = await client.auditLog.fileHistory(fullPath);
        const items = Array.isArray(history) ? history : (history?.items ?? history?.data ?? [history]);
        return shapeList(items, auditSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_audit_file_history', err, {
          hint: 'Verify the fullPath is a valid absolute file path (e.g. C:\\Windows\\System32\\cmd.exe).',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const auditLogHandler: DomainHandler = { getTools, handleCall };
