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
      name: 'blumira_findings_list',
      description: 'List Blumira SIEM findings; filter by status (10=Open, 40=Resolved), priority (1–5), category, date range, or name pattern. Returns finding IDs and summary fields.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          page: { type: 'number', description: 'Page number (default: 1).' },
          page_size: { type: 'number', description: 'Results per page (default: 100).' },
          limit: { type: 'number', description: 'Maximum records to return (max: 5000).' },
          order_by: { type: 'string', description: 'Sort field and direction, e.g. "created;desc".' },
          status: { type: 'number', description: 'Filter by status code (10=Open, 40=Resolved).' },
          priority: { type: 'number', description: 'Filter by priority (1–5, where 1 is highest).' },
          category: { type: 'number', description: 'Filter by category ID.' },
          name: { type: 'string', description: 'Filter by exact name match.' },
          'name.contains': { type: 'string', description: 'Filter by name substring.' },
          'name.regex': { type: 'string', description: 'Filter by name regex.' },
          created_after: { type: 'string', description: 'ISO 8601 UTC lower bound for creation time, e.g. 2024-01-01T00:00:00Z.' },
          created_before: { type: 'string', description: 'ISO 8601 UTC upper bound for creation time.' },
          modified_after: { type: 'string', description: 'ISO 8601 UTC lower bound for last-modified time.' },
          modified_before: { type: 'string', description: 'ISO 8601 UTC upper bound for last-modified time.' },
          blocked: { type: 'boolean', description: 'Filter by blocked status.' },
        },
      },
    },
    {
      name: 'blumira_findings_get',
      description: 'Get a Blumira finding by finding_id (required). Returns status, priority, category, and timestamps.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          finding_id: { type: 'string', description: 'Finding UUID (required).' },
        },
        required: ['finding_id'],
      },
    },
    {
      name: 'blumira_findings_details',
      description: 'Get extended Blumira finding detail (owners, resolution, category summary, UI URL) by finding_id (required). Use when basic get lacks enough context.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          finding_id: { type: 'string', description: 'Finding UUID (required).' },
        },
        required: ['finding_id'],
      },
    },
    {
      name: 'blumira_findings_evidence',
      description: 'Get the raw evidence behind a Blumira finding by finding_id (required): returns the evidence schema (column keys) plus a paginated first page of evidence rows (the underlying log/detection data). Use when investigating why a finding fired. Supports page/page_size for additional rows.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          finding_id: { type: 'string', description: 'Finding UUID (required).' },
          page: { type: 'number', description: 'Evidence page number (default: 1).' },
          page_size: { type: 'number', description: 'Evidence rows per page.' },
        },
        required: ['finding_id'],
      },
    },
    {
      name: 'blumira_findings_resolve',
      description: 'DESTRUCTIVE: Resolve a Blumira finding — permanently changes finding status and resolution code. Requires finding_id and resolution code: 10=Valid, 20=False Positive, 30=No Action Needed, 40=Risk Accepted. Optional resolution_notes.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          finding_id: { type: 'string', description: 'Finding UUID (required).' },
          resolution: { type: 'number', description: 'Resolution ID (required): 10=Valid, 20=False Positive, 30=No Action Needed, 40=Risk Accepted.' },
          resolution_notes: { type: 'string', description: 'Optional resolution notes.' },
        },
        required: ['finding_id', 'resolution'],
      },
    },
    {
      name: 'blumira_findings_assign',
      description: 'DESTRUCTIVE: Assign owners to a Blumira finding — overwrites the current owner list for the given role. Specify finding_id, owner_type (responder|analyst|manager), and owners array of user UUIDs (use blumira_users_list to look up UUIDs). Pass empty array to clear.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          finding_id: { type: 'string', description: 'Finding UUID (required).' },
          owner_type: { type: 'string', enum: ['responder', 'analyst', 'manager'], description: 'Type of owner (required).' },
          owners: { type: 'array', items: { type: 'string' }, description: 'Array of user UUIDs to assign (required). Pass empty array to clear.' },
        },
        required: ['finding_id', 'owner_type', 'owners'],
      },
    },
    {
      name: 'blumira_findings_comments_list',
      description: 'List all comments on a Blumira finding by finding_id (required). Use to review investigation notes before adding a new comment.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          finding_id: { type: 'string', description: 'Finding UUID (required).' },
        },
        required: ['finding_id'],
      },
    },
    {
      name: 'blumira_findings_comments_add',
      description: 'VISIBLE-TO-OTHERS: Add a comment to a Blumira finding — visible to all team members with access to the finding. Requires finding_id, body (HTML allowed), and sender UUID (use blumira_users_list to get IDs).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          finding_id: { type: 'string', description: 'Finding UUID (required).' },
          body: { type: 'string', description: 'Comment body (required, HTML allowed).' },
          sender: { type: 'string', description: 'UUID of the commenting user (required; use blumira_users_list to get IDs).' },
        },
        required: ['finding_id', 'body', 'sender'],
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
      case 'blumira_findings_list': {
        logger.info('API call: findings.list', args);
        const res = await client.findings.list(args as any);
        const items = Array.isArray(res) ? res : (res as any)?.results ?? (res as any)?.data ?? [];
        return shapeList(items, findingSummary, shapeArgs);
      }
      case 'blumira_findings_get': {
        const id = args.finding_id as string;
        if (!id) return toolError('INVALID_ARGS', 'finding_id is required.', { hint: 'Pass the finding UUID string.' });
        logger.info('API call: findings.get', { id });
        const res = await client.findings.get(id);
        return shapeItem(res as Record<string, unknown>, findingSummary, shapeArgs);
      }
      case 'blumira_findings_details': {
        const id = args.finding_id as string;
        if (!id) return toolError('INVALID_ARGS', 'finding_id is required.', { hint: 'Pass the finding UUID string.' });
        logger.info('API call: findings.getDetails', { id });
        const res = await client.findings.getDetails(id);
        return shapeItem(res as Record<string, unknown>, findingSummary, shapeArgs);
      }
      case 'blumira_findings_evidence': {
        const id = args.finding_id as string;
        if (!id) return toolError('INVALID_ARGS', 'finding_id is required.', { hint: 'Pass the finding UUID string.' });
        logger.info('API call: findings.getEvidence', { id });
        const res = await client.findings.getEvidence(id, {
          page: args.page as number | undefined,
          page_size: args.page_size as number | undefined,
        });
        return shapeRaw(res);
      }
      case 'blumira_findings_resolve': {
        const id = args.finding_id as string;
        if (!id) return toolError('INVALID_ARGS', 'finding_id is required.', { hint: 'Pass the finding UUID string.' });
        if (args.resolution === undefined) return toolError('INVALID_ARGS', 'resolution is required.', { hint: 'Use 10=Valid, 20=False Positive, 30=No Action Needed, 40=Risk Accepted.' });
        logger.info('API call: findings.resolve', { id, resolution: args.resolution });
        const res = await client.findings.resolve(id, {
          resolution: args.resolution as number,
          resolution_notes: args.resolution_notes as string | undefined,
        });
        return shapeRaw(res);
      }
      case 'blumira_findings_assign': {
        const id = args.finding_id as string;
        if (!id) return toolError('INVALID_ARGS', 'finding_id is required.', { hint: 'Pass the finding UUID string.' });
        if (!args.owner_type) return toolError('INVALID_ARGS', 'owner_type is required.', { hint: 'Use one of: responder, analyst, manager.' });
        if (!args.owners) return toolError('INVALID_ARGS', 'owners is required.', { hint: 'Pass an array of user UUID strings; use blumira_users_list to get IDs. Pass [] to clear.' });
        logger.info('API call: findings.assignOwners', { id, owner_type: args.owner_type });
        const res = await client.findings.assignOwners(id, {
          owner_type: args.owner_type as 'responder' | 'analyst' | 'manager',
          owners: args.owners as string[],
        });
        return shapeRaw(res);
      }
      case 'blumira_findings_comments_list': {
        const id = args.finding_id as string;
        if (!id) return toolError('INVALID_ARGS', 'finding_id is required.', { hint: 'Pass the finding UUID string.' });
        logger.info('API call: findings.listComments', { id });
        const res = await client.findings.listComments(id);
        const items = Array.isArray(res) ? res : (res as any)?.results ?? (res as any)?.data ?? [];
        return shapeList(items, commentSummary, shapeArgs);
      }
      case 'blumira_findings_comments_add': {
        const id = args.finding_id as string;
        if (!id) return toolError('INVALID_ARGS', 'finding_id is required.', { hint: 'Pass the finding UUID string.' });
        if (!args.body) return toolError('INVALID_ARGS', 'body is required.', { hint: 'Pass the comment text (HTML allowed).' });
        if (!args.sender) return toolError('INVALID_ARGS', 'sender is required.', { hint: 'Pass the user UUID from blumira_users_list.' });
        logger.info('API call: findings.addComment', { id });
        const res = await client.findings.addComment(id, {
          body: args.body as string,
          sender: args.sender as string,
        });
        return shapeRaw(res);
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

export const findingsHandler: DomainHandler = { getTools, handleCall };
