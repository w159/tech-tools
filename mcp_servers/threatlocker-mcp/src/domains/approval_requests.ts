import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { resolveApprovalRequest, ResolutionError } from '../utils/resolve.js';
import {
  shapeList, shapeItem, shapeRaw,
  extractShapeArgs, SHAPE_PROPS,
  toolError, toolErrorFromCatch, withSummary,
  approvalStatusId, APPROVAL_STATUS_NAME,
  type SummaryFn,
} from './_helpers.js';

// Live ApprovalRequestGetByParameters row shape (instance h, 2026-09-01).
const approvalSummary: SummaryFn = (item) => ({
  requestedAt:   item.dateTime,
  hostname:      item.hostname,
  user:          item.username,
  file:          item.path,
  organization:  item.organizationName,
  status:        typeof item.statusId === 'number' ? (APPROVAL_STATUS_NAME[item.statusId] ?? item.statusId) : item.status,
  requestor:     item.requestor || undefined,
  reason:        item.requestorReason || undefined,
  approvedBy:    item.approvedBy || undefined,
  decidedAt:     item.actionDate ?? undefined,
  ticket:        item.ticketId || undefined,
});

const SELECTOR_PROPS = {
  hostname: { type: 'string', description: 'Device hostname the request came from.' },
  pathContains: { type: 'string', description: 'Fragment of the requested file path or name (e.g. "setup.exe"). Together with hostname it must match exactly one request.' },
  status: { type: 'string', description: 'Status to search in when resolving by name (default Pending).' },
  approvalRequestId: { type: 'string', description: 'Optional GUID if you already have it (from full:true output).' },
};

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_approvals_list',
      description: 'List software approval requests by name: when, which device, which user, which file, status, requestor reason. Status defaults to Pending; others: Approved, Rejected, Not Learned, Added to Application, Escalated, Self-Approved.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          status: { type: 'string', description: 'Pending (default), Approved, Rejected, Not Learned, Added to Application, Escalated, Self-Approved.' },
          search: { type: 'string', description: 'Text matched by ThreatLocker against path, hostname, and user.' },
          includeChildOrganizations: { type: 'boolean', description: 'Include requests from child organizations (default true).' },
          pageNumber: { type: 'number', description: 'Page number (default 1).' },
          pageSize: { type: 'number', description: 'Rows per page (default 50).' },
        },
      },
    },
    {
      name: 'threatlocker_approvals_get',
      description: 'Details of one approval request, selected by hostname plus a fragment of the file path (or its GUID): file, hash, user, reason, comments, status, who approved it and when.',
      inputSchema: { type: 'object' as const, properties: { ...SHAPE_PROPS, ...SELECTOR_PROPS } },
    },
    {
      name: 'threatlocker_approvals_pending_count',
      description: 'Number of pending approval requests for the organization (optionally including child organizations).',
      inputSchema: {
        type: 'object' as const,
        properties: { includeChildOrganizations: { type: 'boolean', description: 'Count child organizations too (default true).' } },
      },
    },
    {
      name: 'threatlocker_approvals_get_permit_application',
      description: 'What approving a request would permit (application, files, policy scope), selected by hostname plus path fragment or GUID. Call before threatlocker_approvals_approve and pass its json field through unchanged.',
      inputSchema: { type: 'object' as const, properties: { ...SHAPE_PROPS, ...SELECTOR_PROPS } },
    },
    {
      name: 'threatlocker_approvals_approve',
      description: 'DESTRUCTIVE: approve an Application Control request, creating a permanent allow policy. Select it by hostname plus path fragment (must match exactly one pending request) or GUID, and pass the unmodified json from threatlocker_approvals_get_permit_application.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SELECTOR_PROPS,
          json: { description: '(required) Complete permit-application JSON from threatlocker_approvals_get_permit_application, unmodified.' },
          comments: { type: 'string', description: 'Reason recorded in the Ticket Details comments.' },
          requestorEmailAddress: { type: 'string', description: 'Email to notify when processed.' },
        },
        required: ['json'],
      },
    },
  ];
}

function selectorFrom(args: Record<string, unknown>) {
  return {
    approvalRequestId: args.approvalRequestId as string | undefined,
    hostname: args.hostname as string | undefined,
    pathContains: args.pathContains as string | undefined,
    statusId: approvalStatusId(args.status as string | undefined),
  };
}

function resolutionResult(toolName: string, err: unknown): CallToolResult | null {
  if (!(err instanceof ResolutionError)) return null;
  return toolError('NOT_FOUND', `${toolName}: ${err.message}`, {
    hint: 'List candidates with threatlocker_approvals_list, then pass hostname plus a longer pathContains.',
  });
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case 'threatlocker_approvals_list': {
      let statusId: number;
      try { statusId = approvalStatusId(args.status as string | undefined); }
      catch (err) { return toolError('INVALID_ARGS', (err as Error).message); }
      const params = {
        statusId,
        searchText: args.search as string | undefined,
        showChildOrganizations: (args.includeChildOrganizations as boolean | undefined) ?? true,
        pageNumber: args.pageNumber as number | undefined,
        pageSize: (args.pageSize as number | undefined) ?? 50,
      };
      logger.info('API call: approvalRequests.list', params);
      try {
        const client = await getClient();
        const page = await client.approvalRequests.list(params);
        return withSummary(shapeList(page.items, approvalSummary, shapeArgs), {
          status: APPROVAL_STATUS_NAME[statusId], requestsOnPage: page.items.length, page: page.page, hasMore: page.hasMore,
        });
      } catch (err) {
        return toolErrorFromCatch(toolName, err, { hint: 'The API User needs an Approve or View Approvals role.' });
      }
    }
    case 'threatlocker_approvals_get': {
      try {
        const client = await getClient();
        const match = await resolveApprovalRequest(client, selectorFrom(args));
        const detail = await client.approvalRequests.get(match.approvalRequestId);
        return shapeItem({ ...match, ...detail } as Record<string, unknown>, approvalSummary, shapeArgs);
      } catch (err) {
        return resolutionResult(toolName, err) ?? toolErrorFromCatch(toolName, err, { hint: 'Find the request with threatlocker_approvals_list first.' });
      }
    }
    case 'threatlocker_approvals_pending_count': {
      logger.info('API call: approvalRequests.pendingCount');
      try {
        const client = await getClient();
        const includeChildren = (args.includeChildOrganizations as boolean | undefined) ?? true;
        const count = await client.approvalRequests.getPendingCount(includeChildren);
        return shapeRaw({ pendingApprovals: count, includesChildOrganizations: includeChildren });
      } catch (err) {
        return toolErrorFromCatch(toolName, err, { hint: 'The API User needs an Approve or View Approvals role.' });
      }
    }
    case 'threatlocker_approvals_get_permit_application': {
      try {
        const client = await getClient();
        const match = await resolveApprovalRequest(client, selectorFrom(args));
        const permitApp = await client.approvalRequests.getPermitApplication(match.approvalRequestId);
        return shapeRaw({ hostname: match.hostname, file: match.path, json: permitApp });
      } catch (err) {
        return resolutionResult(toolName, err) ?? toolErrorFromCatch(toolName, err, { hint: 'Find the request with threatlocker_approvals_list first.' });
      }
    }
    case 'threatlocker_approvals_approve': {
      if (args.json === undefined || args.json === null) {
        return toolError('INVALID_ARGS', 'json is required: fetch it with threatlocker_approvals_get_permit_application.');
      }
      try {
        const client = await getClient();
        const match = await resolveApprovalRequest(client, selectorFrom(args));
        logger.info('API call: approvalRequests.approve', { hostname: match.hostname, path: match.path });
        const result = await client.approvalRequests.approve({
          approvalRequestId: match.approvalRequestId,
          json: args.json,
          comments: args.comments as string | undefined,
          requestorEmailAddress: args.requestorEmailAddress as string | undefined,
        });
        return shapeRaw({ approved: true, hostname: match.hostname, file: match.path, response: result ?? null });
      } catch (err) {
        return resolutionResult(toolName, err) ?? toolErrorFromCatch(toolName, err, {
          hint: 'Pass the unmodified json from threatlocker_approvals_get_permit_application. The API User needs an Approve role.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const approvalRequestsHandler: DomainHandler = { getTools, handleCall };
