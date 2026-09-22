import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { statusTool, handleStatus } from './status.js';
import { decideTool, handleDecide } from './decide.js';
import { listModelsTool, handleListModels } from './models.js';
import type { CallToolResult } from './_helpers.js';

// Flat tool list, no navigate/domain-gating step: three tools total, all
// listed up front in every credential state. typesafe_status always answers;
// typesafe_decide and typesafe_list_models return a MISSING_CREDENTIALS tool
// error (naming both TYPESAFE_API_KEY and OPENROUTER_API_KEY) rather than
// disappearing from the list when no provider is configured yet.
export function getAllTools(): Tool[] {
  return [statusTool, decideTool, listModelsTool];
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult | null> {
  switch (name) {
    case 'typesafe_status':
      return handleStatus();
    case 'typesafe_decide':
      return handleDecide(args);
    case 'typesafe_list_models':
      return handleListModels(args);
    default:
      return null;
  }
}
