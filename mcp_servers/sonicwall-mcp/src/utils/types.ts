import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type DomainName =
  | 'session'
  | 'system'
  | 'config'
  | 'objects'
  | 'policies'
  | 'interfaces'
  | 'vpn'
  | 'logs'
  | 'generic';

export type CallToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export interface DomainHandler {
  getTools(): Tool[];
  handleCall(
    toolName: string,
    args: Record<string, unknown>,
    extra?: unknown
  ): Promise<CallToolResult>;
}
