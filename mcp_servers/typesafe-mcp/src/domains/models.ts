import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Provider } from 'node-typesafe';
import { readOnlyTool, shapeRaw, toolError, typesafeToolError, type CallToolResult } from './_helpers.js';
import { getClient } from '../utils/client.js';

const VALID_PROVIDERS = new Set(['typesafe', 'openrouter']);

export const listModelsTool: Tool = readOnlyTool({
  name: 'typesafe_list_models',
  description:
    'List available Jev models for the resolved provider. Provider "typesafe" does a live ' +
    'GET /v1/models against console.typesafe.ai. OpenRouter publishes no Jev model-discovery ' +
    'endpoint, so provider "openrouter" returns the two statically known slugs ' +
    '(~typesafe/jev-latest, typesafe/jev-1.13) marked source:"static" rather than a live lookup.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      provider: {
        type: 'string' as const,
        enum: ['typesafe', 'openrouter'],
        description: 'Optional provider override for this call only, bypassing auto-resolution.',
      },
    },
  },
});

export async function handleListModels(args: Record<string, unknown>): Promise<CallToolResult> {
  const provider = args.provider === undefined ? undefined : (VALID_PROVIDERS.has(args.provider as string) ? (args.provider as Provider) : undefined);
  if (args.provider !== undefined && provider === undefined) {
    return toolError('INVALID_ARGS', 'provider, if set, must be "typesafe" or "openrouter".');
  }

  try {
    const client = getClient();
    const result = await client.listModels({ provider });
    return shapeRaw(result);
  } catch (err) {
    return typesafeToolError('typesafe_list_models', err);
  }
}
