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

const vulnerabilitySummary: SummaryFn = (item) => ({
  id:             item.id,
  cveId:          item.cveId,
  severity:       item.severity,
  status:         item.status,
  isFixAvailable: item.isFixAvailable,
  slaDeadline:    item.slaDeadline,
  affectedCount:  item.affectedCount,
});

function getTools(): Tool[] {
  return [
    listTool('vanta_vulnerabilities_list', 'List Vanta discovered vulnerabilities with CVE IDs, SLA deadlines, and fix availability; optionally filter by free-text query (CVE ID, package name) or isFixAvailable (boolean). Use to triage open CVEs or find actionable vulnerabilities. Pass full:true for the complete object.', {
      q: { type: 'string', description: 'Free-text query (CVE ID, package name, etc.).' },
      isFixAvailable: { type: 'boolean', description: 'When true, restrict to vulnerabilities where a fix is published.' },
      ...SHAPE_PROPS,
    }),
    getTool('vanta_vulnerabilities_get', 'Get a single Vanta vulnerability by ID (required). Returns CVE details, affected resources, SLA deadline, and remediation guidance. Pass full:true for the complete object.', 'id', 'Vulnerability ID (required). Obtain from vanta_vulnerabilities_list.'),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  switch (toolName) {
    case 'vanta_vulnerabilities_list': {
      logger.info('API call: vulnerabilities.list', args);
      try {
        const page = await client.vulnerabilities.list(args);
        return shapeList(
          page.items,
          vulnerabilitySummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_vulnerabilities_list', err, {
          hint: 'Check VANTA_CLIENT_ID and VANTA_CLIENT_SECRET. Verify the OAuth scope includes vulnerabilities:read.',
        });
      }
    }
    case 'vanta_vulnerabilities_get': {
      try {
        const item = await client.vulnerabilities.get(args.id as string);
        return shapeItem(item as unknown as Record<string, unknown>, vulnerabilitySummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_vulnerabilities_get', err, {
          hint: 'Verify the vulnerability ID with vanta_vulnerabilities_list first.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const vulnerabilitiesHandler: DomainHandler = { getTools, handleCall };
