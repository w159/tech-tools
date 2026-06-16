import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainName, NavigationState } from '../utils/types.js';

const sessionStates = new Map<string, NavigationState>();

export function getState(sessionId: string = 'default'): NavigationState {
  if (!sessionStates.has(sessionId)) {
    sessionStates.set(sessionId, { currentDomain: null });
  }
  return sessionStates.get(sessionId)!;
}

export const DOMAINS: DomainName[] = ['findings', 'agents', 'users', 'msp', 'resolutions'];

export function getNavigationTools(): Tool[] {
  return [
    {
      name: 'blumira_navigate',
      description: `Navigate to a Blumira domain to expose its tools. Call this first before any domain-specific operation. Domains: ${DOMAINS.join(', ')}.
- findings: list/search findings, get, get details, get evidence, resolve, assign owners, list/add comments
- agents: list/get devices and enrollment keys
- users: list organization users (UUIDs needed for assignments)
- msp: MSP multi-account — list accounts, per-account findings/agents/users
- resolutions: list valid resolution codes`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          domain: {
            type: 'string',
            enum: DOMAINS,
            description: 'The domain to navigate to',
          },
        },
        required: ['domain'],
      },
    },
    {
      name: 'blumira_status',
      description: 'Check Blumira API connection status and list available domains. Use to verify credentials are working before navigating to a domain.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
  ];
}

export function getBackTool(): Tool {
  return {
    name: 'blumira_back',
    description: 'Return to the Blumira domain navigation menu. Use after finishing work in a domain to switch to another.',
    inputSchema: { type: 'object' as const, properties: {} },
  };
}
