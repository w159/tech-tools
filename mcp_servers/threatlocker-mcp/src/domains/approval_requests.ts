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

// Compact summary: id, action, requesting app/file, user, computer, timestamp, status
const approvalSummary: SummaryFn = (item) => ({
  id:               item.id,
  actionRequested:  item.actionRequested,
  applicationName:  item.applicationName ?? item.fileName,
  requestedBy:      item.requestedBy ?? item.userName,
  computerName:     item.computerName,
  dateTime:         item.dateTime ?? item.requestDateTime,
  status:           item.status,
});

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_approvals_list',
      description: 'List ThreatLocker software approval requests; filter by status (Pending/Approved/Denied), searchText, or childOrganizations. Use to review pending application allow requests. Returns compact summaries by default; pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          status: { type: 'string', description: 'Filter by approval status (e.g. Pending, Approved, Denied).' },
          pageNumber: { type: 'number', description: 'Page number for pagination (default: 1).' },
          pageSize: { type: 'number', description: 'Page size — records per page (default: 50).' },
          searchText: { type: 'string', description: 'Free-text search filter applied to application name, path, or requestor.' },
          childOrganizations: { type: 'boolean', description: 'When true, includes approval requests from child organizations.' },
        },
      },
    },
    {
      name: 'threatlocker_approvals_get',
      description: 'Get details of a single ThreatLocker approval request by approvalRequestId (required). Returns application name, hash, requestor, and current status. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          approvalRequestId: { type: 'string', description: 'UUID string identifying the ThreatLocker approval request.' },
        },
        required: ['approvalRequestId'],
      },
    },
    {
      name: 'threatlocker_approvals_pending_count',
      description: 'Get the count of pending ThreatLocker approval requests. Use for a quick dashboard check before listing full approval details.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'threatlocker_approvals_get_permit_application',
      description: 'Get permit application details (allowed hash, policy assignment) for a ThreatLocker approval request by approvalRequestId (required). Use before approving to review what will be permitted. Pass full:true for the complete object.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          approvalRequestId: { type: 'string', description: 'UUID string identifying the ThreatLocker approval request.' },
        },
        required: ['approvalRequestId'],
      },
    },
    {
      name: 'threatlocker_approvals_approve',
      description: 'DESTRUCTIVE: Approve a ThreatLocker Application Control approval request, creating a permanent allow policy. Calls POST /ApprovalRequest/ApprovalRequestPermitApplication. Fetch the permit application JSON first with threatlocker_approvals_get_permit_application, then pass the complete json payload here. This action changes endpoint security posture.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          approvalRequestId: {
            type: 'string',
            description: '(required) UUID of the approval request to approve. Format: "00000000-0000-0000-0000-000000000000". Obtain from threatlocker_approvals_list.',
          },
          json: {
            description: '(required) Complete permit-application JSON object returned by threatlocker_approvals_get_permit_application. Must be passed as-is — do not modify fields.',
          },
          comments: {
            type: 'string',
            description: '(optional) Text to populate the Comments field in the Ticket Details tab. Overwrites any existing comment. Use to record the reason for approval.',
          },
          requestorEmailAddress: {
            type: 'string',
            description: '(optional) Email address to record as the requestor in the Ticket Details tab. Used to notify the requestor when the request is processed.',
          },
        },
        required: ['approvalRequestId', 'json'],
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case 'threatlocker_approvals_list': {
      // Elicitation: if no status filter provided, ask for status preference
      let status = args.status as string | undefined;
      if (!status) {
        const elicited = await elicitSelection(
          'Select approval request status:',
          ['Pending', 'Approved', 'Denied', 'All'],
          'Pending'
        );
        status = elicited || 'Pending';
      }

      const params = {
        status: status === 'All' ? undefined : status,
        pageNumber: args.pageNumber as number | undefined,
        pageSize: args.pageSize as number | undefined,
        searchText: args.searchText as string | undefined,
        childOrganizations: args.childOrganizations as boolean | undefined,
      };
      logger.info('API call: approvalRequests.list', params);
      try {
        const client = await getClient();
        const result = await client.approvalRequests.list(params);
        const items = Array.isArray(result) ? result : (result?.items ?? result?.data ?? [result]);
        return shapeList(items, approvalSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_approvals_list', err, {
          hint: 'Verify THREATLOCKER_API_KEY and THREATLOCKER_ORGANIZATION_ID are set correctly.',
        });
      }
    }
    case 'threatlocker_approvals_get': {
      const approvalRequestId = args.approvalRequestId as string;
      logger.info('API call: approvalRequests.get', { approvalRequestId });
      try {
        const client = await getClient();
        const approval = await client.approvalRequests.get(approvalRequestId);
        return shapeItem(approval as Record<string, unknown>, approvalSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_approvals_get', err, {
          hint: 'Verify the approvalRequestId with threatlocker_approvals_list first.',
        });
      }
    }
    case 'threatlocker_approvals_pending_count': {
      logger.info('API call: approvalRequests.pendingCount');
      try {
        const client = await getClient();
        const count = await client.approvalRequests.getPendingCount();
        return shapeRaw(count);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_approvals_pending_count', err, {
          hint: 'Verify THREATLOCKER_API_KEY is set correctly.',
        });
      }
    }
    case 'threatlocker_approvals_get_permit_application': {
      const approvalRequestId = args.approvalRequestId as string;
      logger.info('API call: approvalRequests.getPermitApplication', { approvalRequestId });
      try {
        const client = await getClient();
        const permitApp = await client.approvalRequests.getPermitApplication(approvalRequestId);
        return shapeRaw(permitApp);
      } catch (err) {
        return toolErrorFromCatch('threatlocker_approvals_get_permit_application', err, {
          hint: 'Verify the approvalRequestId with threatlocker_approvals_list first.',
        });
      }
    }
    case 'threatlocker_approvals_approve': {
      const approvalRequestId = args.approvalRequestId as string;
      const json = args.json;
      const comments = args.comments as string | undefined;
      const requestorEmailAddress = args.requestorEmailAddress as string | undefined;
      logger.info('API call: approvalRequests.approve', { approvalRequestId });
      try {
        const client = await getClient();
        const result = await client.approvalRequests.approve({
          approvalRequestId,
          json,
          comments,
          requestorEmailAddress,
        });
        return shapeRaw(result ?? { approved: true, approvalRequestId });
      } catch (err) {
        return toolErrorFromCatch('threatlocker_approvals_approve', err, {
          hint: 'Fetch the permit application JSON first with threatlocker_approvals_get_permit_application and pass the complete json field. Verify THREATLOCKER_API_KEY has Approve permissions.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const approvalRequestsHandler: DomainHandler = { getTools, handleCall };
