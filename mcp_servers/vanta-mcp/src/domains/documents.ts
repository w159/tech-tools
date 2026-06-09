import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeList, shapeItem, extractShapeArgs, SHAPE_PROPS,
  toolErrorFromCatch,
  listTool, getTool,
  type SummaryFn,
} from './_helpers.js';

const documentSummary: SummaryFn = (item) => ({
  id:          item.id,
  name:        item.name,
  status:      item.status,
  type:        item.type,
  expiresAt:   item.expiresAt,
  owner:       item.owner,
});

function getTools(): Tool[] {
  return [
    listTool('vanta_documents_list', 'List Vanta evidence documents (policies, training records, attestations); filter by frameworkMatchesAny (array of framework IDs) or statusMatchesAny (CURRENT, EXPIRING, MISSING). Use to find evidence gaps or documents approaching expiry for an audit. Pass full:true for the complete object.', {
      frameworkMatchesAny: { type: 'array', items: { type: 'string' }, description: 'Filter to documents tagged for any of these framework IDs.' },
      statusMatchesAny:   { type: 'array', items: { type: 'string' }, description: 'Filter by document status (e.g. CURRENT, EXPIRING, MISSING).' },
      ...SHAPE_PROPS,
    }),
    getTool('vanta_documents_get', 'Get a single Vanta evidence document by ID (required). Returns document type, status, expiry date, and linked controls. Pass full:true for the complete object.', 'id', 'Document ID (required). Obtain from vanta_documents_list.'),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  switch (toolName) {
    case 'vanta_documents_list': {
      logger.info('API call: documents.list', args);
      try {
        const page = await client.documents.list(args);
        return shapeList(
          page.items,
          documentSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_documents_list', err, {
          hint: 'Check VANTA_CLIENT_ID and VANTA_CLIENT_SECRET. Verify the OAuth scope includes documents:read.',
        });
      }
    }
    case 'vanta_documents_get': {
      logger.info('API call: documents.get', { id: args.id });
      try {
        const item = await client.documents.get(args.id as string);
        return shapeItem(item as unknown as Record<string, unknown>, documentSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_documents_get', err, {
          hint: 'Verify the document ID with vanta_documents_list first.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const documentsHandler: DomainHandler = { getTools, handleCall };
