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

const testSummary: SummaryFn = (item) => ({
  id:          item.id,
  name:        item.name,
  status:      item.status,
  controlId:   item.controlId,
  frameworkId: item.frameworkId,
  updatedAt:   item.updatedAt,
});

function getTools(): Tool[] {
  return [
    listTool('vanta_tests_list', 'List Vanta automated control tests; filter by statusFilter (OK, NEEDS_ATTENTION, DEACTIVATED) or frameworkFilter (framework ID). Use to audit which tests are failing or deactivated for a given compliance framework. Pass full:true for the complete object.', {
      statusFilter: { type: 'string', description: 'Status filter (e.g. NEEDS_ATTENTION, OK, DEACTIVATED).' },
      frameworkFilter: { type: 'string', description: 'Framework ID to restrict tests to a single framework.' },
      ...SHAPE_PROPS,
    }),
    getTool('vanta_tests_get', 'Get a single Vanta automated control test by ID (required). Returns test name, linked control, current status, and failure details. Pass full:true for the complete object.', 'id', 'Test ID (required). Obtain from vanta_tests_list.'),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  switch (toolName) {
    case 'vanta_tests_list': {
      logger.info('API call: tests.list', args);
      try {
        const page = await client.tests.list(args);
        return shapeList(
          page.items,
          testSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_tests_list', err, {
          hint: 'Check VANTA_CLIENT_ID and VANTA_CLIENT_SECRET. Verify the OAuth scope includes tests:read.',
        });
      }
    }
    case 'vanta_tests_get': {
      logger.info('API call: tests.get', { id: args.id });
      try {
        const item = await client.tests.get(args.id as string);
        return shapeItem(item as unknown as Record<string, unknown>, testSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_tests_get', err, {
          hint: 'Verify the test ID with vanta_tests_list first.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const testsHandler: DomainHandler = { getTools, handleCall };
