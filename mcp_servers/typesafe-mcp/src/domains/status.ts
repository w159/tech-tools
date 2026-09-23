import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_OPENROUTER_MAX_TOKENS, TypeSafeClient } from 'node-typesafe';
import { readOnlyTool, type CallToolResult } from './_helpers.js';
import { clientConfigFromEnv, readEnv } from '../utils/client.js';

export const statusTool: Tool = readOnlyTool({
  name: 'typesafe_status',
  description:
    'Show TypeSafe/Jev credential status: which of TYPESAFE_API_KEY (console.typesafe.ai) and ' +
    'OPENROUTER_API_KEY (openrouter.ai) are set (booleans only, never key values), the resolved ' +
    'provider, resolved base URL, resolved model, and the OpenRouter max_tokens budget for the ' +
    'active provider. Runs without any credentials configured.',
  inputSchema: { type: 'object' as const, properties: {} },
});

export async function handleStatus(): Promise<CallToolResult> {
  const env = readEnv();
  const client = new TypeSafeClient(clientConfigFromEnv(env));

  let providerLine = 'none configured';
  let baseUrlLine = 'n/a';
  let modelLine = 'n/a';
  let maxTokensLine = 'n/a (no provider resolved)';
  try {
    const { provider, reason } = client.resolveProvider();
    providerLine = `${provider} (${reason})`;
    baseUrlLine = client.resolveBaseUrl(provider);
    modelLine = client.resolveModel(provider);
    maxTokensLine =
      provider === 'openrouter'
        ? `${client.resolveMaxTokens()} (sent as max_tokens; Jev max_completion_tokens 28800, ` +
          'output tokens billed $0, precheck reserves this instead of 65536 when omitted)'
        : 'n/a (typesafe provider has no max_tokens parameter)';
  } catch {
    // Left at the "none configured" defaults above - typesafe_status must
    // never throw just because no credentials are set yet.
  }

  const lines = [
    'TypeSafe (Jev) MCP Server Status',
    '',
    `TYPESAFE_API_KEY (console.typesafe.ai): ${env.typesafeApiKey ? `configured (${env.typesafeApiKey.length} chars)` : 'not set'}`,
    `OPENROUTER_API_KEY (openrouter.ai): ${env.openrouterApiKey ? `configured (${env.openrouterApiKey.length} chars)` : 'not set'}`,
    `Resolved provider: ${providerLine}`,
    `Resolved base URL: ${baseUrlLine}`,
    `Resolved model: ${modelLine}`,
    `Resolved OpenRouter max_tokens: ${maxTokensLine}`,
    `TYPESAFE_PROVIDER override: ${env.provider || 'not set (auto)'}`,
    `TYPESAFE_MODEL override: ${env.model || 'not set'}`,
    `OPENROUTER_MAX_TOKENS override: ${env.openrouterMaxTokens || `not set (default ${DEFAULT_OPENROUTER_MAX_TOKENS})`}`,
    '',
    'typesafe_decide and typesafe_list_models need a resolved provider: set TYPESAFE_API_KEY or ' +
      'OPENROUTER_API_KEY. Both are fully supported standalone paths - OPENROUTER_API_KEY works on ' +
      'its own if console.typesafe.ai is unreachable.',
  ];
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
