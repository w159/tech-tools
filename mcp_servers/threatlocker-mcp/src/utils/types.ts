import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type DomainName = 'computers' | 'computer_groups' | 'approval_requests' | 'audit_log' | 'organizations' | 'policies' | 'applications' | 'config_manager' | 'dac' | 'system_audit' | 'tags';

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

