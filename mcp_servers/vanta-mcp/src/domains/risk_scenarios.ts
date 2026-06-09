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

const riskScenarioSummary: SummaryFn = (item) => ({
  id:               item.id,
  name:             item.name,
  likelihood:       item.likelihood,
  impact:           item.impact,
  mitigationStatus: item.mitigationStatus,
  owner:            item.owner,
});

function getTools(): Tool[] {
  return [
    listTool('vanta_risk_scenarios_list', 'List Vanta enterprise risk register scenarios with likelihood, impact, and mitigation status. Use to review the full risk register or find a risk scenario ID for deeper inspection. Pass full:true for the complete object.', {
      ...SHAPE_PROPS,
    }),
    getTool('vanta_risk_scenarios_get', 'Get a single Vanta risk scenario by ID (required). Returns risk description, likelihood, impact score, owner, and mitigation plan. Pass full:true for the complete object.', 'id', 'Risk scenario ID (required). Obtain from vanta_risk_scenarios_list.'),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  switch (toolName) {
    case 'vanta_risk_scenarios_list': {
      logger.info('API call: riskScenarios.list', args);
      try {
        const page = await client.riskScenarios.list(args);
        return shapeList(
          page.items,
          riskScenarioSummary,
          shapeArgs,
          undefined,
          page.endCursor ? `Pass pageCursor="${page.endCursor}" to get the next page.` : undefined,
        );
      } catch (err) {
        return toolErrorFromCatch('vanta_risk_scenarios_list', err, {
          hint: 'Check VANTA_CLIENT_ID and VANTA_CLIENT_SECRET. Verify the OAuth scope includes risk:read.',
        });
      }
    }
    case 'vanta_risk_scenarios_get': {
      try {
        const item = await client.riskScenarios.get(args.id as string);
        return shapeItem(item as unknown as Record<string, unknown>, riskScenarioSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch('vanta_risk_scenarios_get', err, {
          hint: 'Verify the risk scenario ID with vanta_risk_scenarios_list first.',
        });
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const riskScenariosHandler: DomainHandler = { getTools, handleCall };
