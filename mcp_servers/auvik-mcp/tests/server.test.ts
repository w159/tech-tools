import { describe, it, expect, beforeAll } from 'vitest';
import { createServer } from '../src/server.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Reach into the registered ListTools handler to assert the advertised surface.
async function listTools() {
  const server = createServer();
  // @ts-expect-error - _requestHandlers is private but stable enough for a test
  const handler = server.server._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
  const res = await handler({ method: 'tools/list', params: {} }, { signal: new AbortController().signal });
  return res.tools as { name: string; inputSchema: any }[];
}

describe('tool registry', () => {
  // The ListTools credential gate hides everything but status/navigate without creds.
  beforeAll(() => {
    process.env.AUVIK_USERNAME = 'test-user';
    process.env.AUVIK_API_KEY = 'test-key';
  });

  it('advertises a stable, de-duplicated set of tools', async () => {
    const tools = await listTools();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length); // no dupes
    // A few load-bearing names must exist.
    for (const n of [
      'auvik_status',
      'auvik_tenants_list',
      'auvik_devices_list',
      'auvik_statistics_device',
      'auvik_statistics_component',
      'auvik_billing_client_usage',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('every tool has a valid object input schema', async () => {
    const tools = await listTools();
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      // additionalProperties is no longer advertised: McpServer derives the wire schema from zod,
      // which strips unknown keys instead of forbidding them.
    }
  });

  it('every required field is declared in properties', async () => {
    const tools = await listTools();
    for (const t of tools) {
      const props = Object.keys(t.inputSchema.properties || {});
      for (const req of t.inputSchema.required || []) {
        expect(props, `${t.name} requires "${req}"`).toContain(req);
      }
    }
  });
});
