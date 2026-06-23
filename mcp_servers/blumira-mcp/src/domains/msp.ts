import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeList,
  shapeItem,
  shapeRaw,
  extractShapeArgs,
  SHAPE_PROPS,
  toolError,
  toolErrorFromCatch,
  type SummaryFn,
} from './_helpers.js';

// ---------------------------------------------------------------------------
// Compact summaries
// ---------------------------------------------------------------------------

const accountSummary: SummaryFn = (item) => ({
  account_id:            item.account_id ?? item.id,
  name:                  item.name,
  open_findings:         item.open_findings,
  license:               item.license,
  agent_count_used:      item.agent_count_used,
  agent_count_available: item.agent_count_available,
  user_count:            item.user_count,
});

const findingSummary: SummaryFn = (item) => ({
  finding_id:  item.finding_id ?? item.id,
  short_id:    item.short_id,
  name:        item.name,
  type_name:   item.type_name,
  priority:    item.priority,
  status:      item.status,
  status_name: item.status_name,
  org_id:      item.org_id,
  org_name:    item.org_name,
  created:     item.created,
  modified:    item.modified,
});

const deviceSummary: SummaryFn = (item) => ({
  device_id:   item.device_id ?? item.id,
  hostname:    item.hostname,
  plat:        item.plat,
  arch:        item.arch,
  is_isolated: item.is_isolated,
  keyname:     item.keyname,
  org_id:      item.org_id,
  alive:       item.alive,
});

const keySummary: SummaryFn = (item) => ({
  key_id:      item.key_id ?? item.id,
  description: item.description,
  agent_count: item.agent_count,
  org_id:      item.org_id,
  created:     item.created,
});

const userSummary: SummaryFn = (item) => ({
  id:         item.id,
  email:      item.email,
  first_name: item.first_name,
  last_name:  item.last_name,
  org_roles:  item.org_roles,
});

const commentSummary: SummaryFn = (item) => ({
  id:     item.id,
  sender: item.sender,
  body:   item.body,
  age:    item.age,
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function getTools(): Tool[] {
  return [
    {
      name: 'blumira_msp_accounts_list',
      description: 'List all Blumira MSP sub-accounts. Returns account UUIDs, names, and open finding counts. Use to choose an account_id for scoped operations.',
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
      name: 'blumira_msp_accounts_get',
      description: 'Get details of a Blumira MSP sub-account by account_id (required): license type, agent count, user count, and feature flags.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          account_id: { type: 'string', description: 'Account UUID (required).' },
        },
        required: ['account_id'],
      },
    },
    {
      name: 'blumira_msp_findings_all',
      description: 'List Blumira findings across all MSP sub-accounts in one call; filter by status, priority, or date range. Use for MSP-wide security posture review.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          page: { type: 'number', description: 'Page number.' },
          page_size: { type: 'number', description: 'Results per page.' },
          limit: { type: 'number', description: 'Maximum records to return.' },
          status: { type: 'number', description: 'Filter by status code (10=Open, 40=Resolved).' },
          priority: { type: 'number', description: 'Filter by priority (1–5).' },
          created_after: { type: 'string', description: 'ISO 8601 UTC lower bound for creation time.' },
          created_before: { type: 'string', description: 'ISO 8601 UTC upper bound for creation time.' },
        },
      },
    },
    {
      name: 'blumira_msp_findings_list',
      description: 'List Blumira findings scoped to a single MSP sub-account (account_id required); filter by status or priority.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          account_id: { type: 'string', description: 'Account UUID (required).' },
          page: { type: 'number', description: 'Page number.' },
          page_size: { type: 'number', description: 'Results per page.' },
          status: { type: 'number', description: 'Filter by status code (10=Open, 40=Resolved).' },
          priority: { type: 'number', description: 'Filter by priority (1–5).' },
        },
        required: ['account_id'],
      },
    },
    {
      name: 'blumira_msp_findings_get',
      description: 'Get a single Blumira finding from an MSP sub-account (account_id and finding_id both required).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          account_id: { type: 'string', description: 'Account UUID (required).' },
          finding_id: { type: 'string', description: 'Finding UUID (required).' },
        },
        required: ['account_id', 'finding_id'],
      },
    },
    {
      name: 'blumira_msp_findings_evidence',
      description: 'Get the raw evidence behind a Blumira finding in an MSP sub-account (account_id and finding_id both required): returns the evidence schema (column keys) plus a paginated first page of evidence rows. Use when investigating a sub-account finding. Supports page/page_size.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          account_id: { type: 'string', description: 'Account UUID (required).' },
          finding_id: { type: 'string', description: 'Finding UUID (required).' },
          page: { type: 'number', description: 'Evidence page number (default: 1).' },
          page_size: { type: 'number', description: 'Evidence rows per page.' },
        },
        required: ['account_id', 'finding_id'],
      },
    },
    {
      name: 'blumira_msp_findings_resolve',
      description: 'DESTRUCTIVE: Resolve a Blumira finding in an MSP sub-account — permanently changes finding status and resolution code. Requires account_id, finding_id, and resolution code: 10=Valid, 20=False Positive, 30=No Action Needed, 40=Risk Accepted.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          account_id: { type: 'string', description: 'Account UUID (required).' },
          finding_id: { type: 'string', description: 'Finding UUID (required).' },
          resolution: { type: 'number', description: 'Resolution ID (required): 10=Valid, 20=False Positive, 30=No Action Needed, 40=Risk Accepted.' },
          resolution_notes: { type: 'string', description: 'Optional resolution notes.' },
        },
        required: ['account_id', 'finding_id', 'resolution'],
      },
    },
    {
      name: 'blumira_msp_findings_assign',
      description: 'DESTRUCTIVE: Assign owners to a Blumira finding in an MSP sub-account — overwrites the current owner list for the given role. Requires account_id, finding_id, owner_type (responder|analyst|manager), and owners array of user UUIDs (pass [] to clear).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          account_id: { type: 'string', description: 'Account UUID (required).' },
          finding_id: { type: 'string', description: 'Finding UUID (required).' },
          owner_type: { type: 'string', enum: ['responder', 'analyst', 'manager'], description: 'Type of owner (required).' },
          owners: { type: 'array', items: { type: 'string' }, description: 'Array of user UUIDs (required); pass [] to clear.' },
        },
        required: ['account_id', 'finding_id', 'owner_type', 'owners'],
      },
    },
    {
      name: 'blumira_msp_findings_comments_list',
      description: 'List comments on a Blumira finding within an MSP sub-account (account_id and finding_id required).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          account_id: { type: 'string', description: 'Account UUID (required).' },
          finding_id: { type: 'string', description: 'Finding UUID (required).' },
        },
        required: ['account_id', 'finding_id'],
      },
    },
    {
      name: 'blumira_msp_findings_comments_add',
      description: 'VISIBLE-TO-OTHERS: Add a comment to a Blumira finding in an MSP sub-account — visible to all team members with access to that account. Requires account_id, finding_id, body (HTML allowed), and sender UUID.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          account_id: { type: 'string', description: 'Account UUID (required).' },
          finding_id: { type: 'string', description: 'Finding UUID (required).' },
          body: { type: 'string', description: 'Comment body (required, HTML allowed).' },
          sender: { type: 'string', description: 'UUID of the commenting user (required).' },
        },
        required: ['account_id', 'finding_id', 'body', 'sender'],
      },
    },
    {
      name: 'blumira_msp_devices_list',
      description: 'List Blumira agent devices enrolled under a specific MSP sub-account (account_id required).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          account_id: { type: 'string', description: 'Account UUID (required).' },
          page: { type: 'number', description: 'Page number.' },
          page_size: { type: 'number', description: 'Results per page.' },
        },
        required: ['account_id'],
      },
    },
    {
      name: 'blumira_msp_devices_get',
      description: 'Get a single Blumira agent device from an MSP sub-account (account_id and device_id both required).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          account_id: { type: 'string', description: 'Account UUID (required).' },
          device_id: { type: 'string', description: 'Device UUID (required).' },
        },
        required: ['account_id', 'device_id'],
      },
    },
    {
      name: 'blumira_msp_keys_list',
      description: 'List Blumira agent enrollment keys for an MSP sub-account (account_id required). Use to find keys for agent provisioning.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          account_id: { type: 'string', description: 'Account UUID (required).' },
          page: { type: 'number', description: 'Page number.' },
          page_size: { type: 'number', description: 'Results per page.' },
        },
        required: ['account_id'],
      },
    },
    {
      name: 'blumira_msp_keys_get',
      description: 'Get a single Blumira agent enrollment key from an MSP sub-account (account_id and key_id both required).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          account_id: { type: 'string', description: 'Account UUID (required).' },
          key_id: { type: 'string', description: 'Key UUID (required).' },
        },
        required: ['account_id', 'key_id'],
      },
    },
    {
      name: 'blumira_msp_users_list',
      description: 'List users for a Blumira MSP sub-account (account_id required). Returns user UUIDs needed for finding assignments in that account.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          account_id: { type: 'string', description: 'Account UUID (required).' },
          page: { type: 'number', description: 'Page number.' },
          page_size: { type: 'number', description: 'Results per page.' },
        },
        required: ['account_id'],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);
  const accountId = args.account_id as string;
  const findingId = args.finding_id as string;

  try {
    const client = await getClient();

    switch (toolName) {
      case 'blumira_msp_accounts_list': {
        logger.info('API call: msp.listAccounts', args);
        const res = await client.msp.listAccounts(args as any);
        const items = Array.isArray(res) ? res : (res as any)?.results ?? (res as any)?.data ?? [];
        return shapeList(items, accountSummary, shapeArgs);
      }
      case 'blumira_msp_accounts_get': {
        if (!accountId) return toolError('INVALID_ARGS', 'account_id is required.', { hint: 'Pass the account UUID string.' });
        logger.info('API call: msp.getAccount', { accountId });
        const res = await client.msp.getAccount(accountId);
        return shapeItem(res as Record<string, unknown>, accountSummary, shapeArgs);
      }
      case 'blumira_msp_findings_all': {
        logger.info('API call: msp.listAllFindings', args);
        const res = await client.msp.listAllFindings(args as any);
        const items = Array.isArray(res) ? res : (res as any)?.results ?? (res as any)?.data ?? [];
        return shapeList(items, findingSummary, shapeArgs);
      }
      case 'blumira_msp_findings_list': {
        if (!accountId) return toolError('INVALID_ARGS', 'account_id is required.', { hint: 'Pass the account UUID string.' });
        logger.info('API call: msp.listFindings', { accountId });
        const res = await client.msp.listFindings(accountId, args as any);
        const items = Array.isArray(res) ? res : (res as any)?.results ?? (res as any)?.data ?? [];
        return shapeList(items, findingSummary, shapeArgs);
      }
      case 'blumira_msp_findings_get': {
        if (!accountId) return toolError('INVALID_ARGS', 'account_id is required.', { hint: 'Pass the account UUID string.' });
        if (!findingId) return toolError('INVALID_ARGS', 'finding_id is required.', { hint: 'Pass the finding UUID string.' });
        logger.info('API call: msp.getFinding', { accountId, findingId });
        const res = await client.msp.getFinding(accountId, findingId);
        return shapeItem(res as Record<string, unknown>, findingSummary, shapeArgs);
      }
      case 'blumira_msp_findings_evidence': {
        if (!accountId) return toolError('INVALID_ARGS', 'account_id is required.', { hint: 'Pass the account UUID string.' });
        if (!findingId) return toolError('INVALID_ARGS', 'finding_id is required.', { hint: 'Pass the finding UUID string.' });
        logger.info('API call: msp.getFindingEvidence', { accountId, findingId });
        const res = await client.msp.getFindingEvidence(accountId, findingId, {
          page: args.page as number | undefined,
          page_size: args.page_size as number | undefined,
        });
        return shapeRaw(res);
      }
      case 'blumira_msp_findings_resolve': {
        if (!accountId) return toolError('INVALID_ARGS', 'account_id is required.', { hint: 'Pass the account UUID string.' });
        if (!findingId) return toolError('INVALID_ARGS', 'finding_id is required.', { hint: 'Pass the finding UUID string.' });
        if (args.resolution === undefined) return toolError('INVALID_ARGS', 'resolution is required.', { hint: 'Use 10=Valid, 20=False Positive, 30=No Action Needed, 40=Risk Accepted.' });
        logger.info('API call: msp.resolveFinding', { accountId, findingId });
        const res = await client.msp.resolveFinding(accountId, findingId, {
          resolution: args.resolution as number,
          resolution_notes: args.resolution_notes as string | undefined,
        });
        return shapeRaw(res);
      }
      case 'blumira_msp_findings_assign': {
        if (!accountId) return toolError('INVALID_ARGS', 'account_id is required.', { hint: 'Pass the account UUID string.' });
        if (!findingId) return toolError('INVALID_ARGS', 'finding_id is required.', { hint: 'Pass the finding UUID string.' });
        if (!args.owner_type) return toolError('INVALID_ARGS', 'owner_type is required.', { hint: 'Use one of: responder, analyst, manager.' });
        if (!args.owners) return toolError('INVALID_ARGS', 'owners is required.', { hint: 'Pass an array of user UUID strings; pass [] to clear.' });
        logger.info('API call: msp.assignFindingOwners', { accountId, findingId });
        const res = await client.msp.assignFindingOwners(accountId, findingId, {
          owner_type: args.owner_type as 'responder' | 'analyst' | 'manager',
          owners: args.owners as string[],
        });
        return shapeRaw(res);
      }
      case 'blumira_msp_findings_comments_list': {
        if (!accountId) return toolError('INVALID_ARGS', 'account_id is required.', { hint: 'Pass the account UUID string.' });
        if (!findingId) return toolError('INVALID_ARGS', 'finding_id is required.', { hint: 'Pass the finding UUID string.' });
        logger.info('API call: msp.listFindingComments', { accountId, findingId });
        const res = await client.msp.listFindingComments(accountId, findingId);
        const items = Array.isArray(res) ? res : (res as any)?.results ?? (res as any)?.data ?? [];
        return shapeList(items, commentSummary, shapeArgs);
      }
      case 'blumira_msp_findings_comments_add': {
        if (!accountId) return toolError('INVALID_ARGS', 'account_id is required.', { hint: 'Pass the account UUID string.' });
        if (!findingId) return toolError('INVALID_ARGS', 'finding_id is required.', { hint: 'Pass the finding UUID string.' });
        if (!args.body) return toolError('INVALID_ARGS', 'body is required.', { hint: 'Pass the comment text (HTML allowed).' });
        if (!args.sender) return toolError('INVALID_ARGS', 'sender is required.', { hint: 'Pass the user UUID from blumira_msp_users_list.' });
        logger.info('API call: msp.addFindingComment', { accountId, findingId });
        const res = await client.msp.addFindingComment(accountId, findingId, {
          body: args.body as string,
          sender: args.sender as string,
        });
        return shapeRaw(res);
      }
      case 'blumira_msp_devices_list': {
        if (!accountId) return toolError('INVALID_ARGS', 'account_id is required.', { hint: 'Pass the account UUID string.' });
        logger.info('API call: msp.listDevices', { accountId });
        const res = await client.msp.listDevices(accountId, args as any);
        const items = Array.isArray(res) ? res : (res as any)?.results ?? (res as any)?.data ?? [];
        return shapeList(items, deviceSummary, shapeArgs);
      }
      case 'blumira_msp_devices_get': {
        if (!accountId) return toolError('INVALID_ARGS', 'account_id is required.', { hint: 'Pass the account UUID string.' });
        const deviceId = args.device_id as string;
        if (!deviceId) return toolError('INVALID_ARGS', 'device_id is required.', { hint: 'Pass the device UUID string.' });
        logger.info('API call: msp.getDevice', { accountId, deviceId });
        const res = await client.msp.getDevice(accountId, deviceId);
        return shapeItem(res as Record<string, unknown>, deviceSummary, shapeArgs);
      }
      case 'blumira_msp_keys_list': {
        if (!accountId) return toolError('INVALID_ARGS', 'account_id is required.', { hint: 'Pass the account UUID string.' });
        logger.info('API call: msp.listKeys', { accountId });
        const res = await client.msp.listKeys(accountId, args as any);
        const items = Array.isArray(res) ? res : (res as any)?.results ?? (res as any)?.data ?? [];
        return shapeList(items, keySummary, shapeArgs);
      }
      case 'blumira_msp_keys_get': {
        if (!accountId) return toolError('INVALID_ARGS', 'account_id is required.', { hint: 'Pass the account UUID string.' });
        const keyId = args.key_id as string;
        if (!keyId) return toolError('INVALID_ARGS', 'key_id is required.', { hint: 'Pass the key UUID string.' });
        logger.info('API call: msp.getKey', { accountId, keyId });
        const res = await client.msp.getKey(accountId, keyId);
        return shapeItem(res as Record<string, unknown>, keySummary, shapeArgs);
      }
      case 'blumira_msp_users_list': {
        if (!accountId) return toolError('INVALID_ARGS', 'account_id is required.', { hint: 'Pass the account UUID string.' });
        logger.info('API call: msp.listUsers', { accountId });
        const res = await client.msp.listUsers(accountId, args as any);
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

export const mspHandler: DomainHandler = { getTools, handleCall };
