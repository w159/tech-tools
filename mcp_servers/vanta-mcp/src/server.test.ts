/**
 * Tests for the vanta-mcp server layer.
 *
 * These specs exercise the server-layer logic that lives on top of the
 * node-vanta library.  No real Vanta API calls are made; the node-vanta
 * module is mocked at the module level so every test runs without network
 * access or credentials.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock node-vanta before any server-layer imports so the lazy dynamic
// imports inside getDomainHandler pick up the stub.
// ---------------------------------------------------------------------------
vi.mock('node-vanta', () => ({
  VantaClient: vi.fn().mockImplementation(() => ({})),
}));

import { getNavigationTools, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials, resetClient } from './utils/client.js';
import { createMcpServer } from './server.js';

// ---------------------------------------------------------------------------
// Expected complete tool registry (navigation + all domain tools)
// ---------------------------------------------------------------------------
const EXPECTED_TOOL_NAMES: string[] = [
  // navigation
  'vanta_navigate',
  'vanta_status',
  // controls
  'vanta_controls_list',
  'vanta_controls_get',
  // documents
  'vanta_documents_list',
  'vanta_documents_get',
  // frameworks
  'vanta_frameworks_list',
  'vanta_frameworks_get',
  'vanta_frameworks_list_controls',
  // integrations
  'vanta_integrations_list',
  'vanta_integrations_get',
  'vanta_integrations_list_resource_kinds',
  'vanta_integrations_list_resources',
  'vanta_integrations_get_resource',
  // monitored_computers
  'vanta_monitored_computers_list',
  'vanta_monitored_computers_get',
  // people
  'vanta_people_list',
  'vanta_people_get',
  // policies
  'vanta_policies_list',
  'vanta_policies_get',
  // risk_scenarios
  'vanta_risk_scenarios_list',
  'vanta_risk_scenarios_get',
  // tests
  'vanta_tests_list',
  'vanta_tests_get',
  // vendors
  'vanta_vendors_list',
  'vanta_vendors_get',
  // vulnerabilities
  'vanta_vulnerabilities_list',
  'vanta_vulnerabilities_get',
];

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------
const originalEnv = { ...process.env };

function clearVantaEnv() {
  delete process.env.VANTA_CLIENT_ID;
  delete process.env.VANTA_CLIENT_SECRET;
  delete process.env.VANTA_BASE_URL;
}

function setVantaEnv(clientId = 'test-id', clientSecret = 'test-secret') {
  process.env.VANTA_CLIENT_ID = clientId;
  process.env.VANTA_CLIENT_SECRET = clientSecret;
}

beforeEach(() => {
  clearVantaEnv();
  resetClient();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Credential handling
// ---------------------------------------------------------------------------
describe('getCredentials', () => {
  it('returns null when both env vars are absent', () => {
    expect(getCredentials()).toBeNull();
  });

  it('returns null when only VANTA_CLIENT_ID is set', () => {
    process.env.VANTA_CLIENT_ID = 'id-only';
    expect(getCredentials()).toBeNull();
  });

  it('returns null when only VANTA_CLIENT_SECRET is set', () => {
    process.env.VANTA_CLIENT_SECRET = 'secret-only';
    expect(getCredentials()).toBeNull();
  });

  it('returns credentials object when both vars are set', () => {
    setVantaEnv();
    const creds = getCredentials();
    expect(creds).not.toBeNull();
    expect(creds?.clientId).toBe('test-id');
    expect(creds?.clientSecret).toBe('test-secret');
    expect(creds?.baseUrl).toBeUndefined();
  });

  it('includes baseUrl when VANTA_BASE_URL is set', () => {
    setVantaEnv();
    process.env.VANTA_BASE_URL = 'https://custom.vanta.example.com/v1';
    const creds = getCredentials();
    expect(creds?.baseUrl).toBe('https://custom.vanta.example.com/v1');
  });

  it('strips unresolved MCP template placeholders from env vars', () => {
    process.env.VANTA_CLIENT_ID = '${user_config.client_id}';
    process.env.VANTA_CLIENT_SECRET = '${user_config.client_secret}';
    expect(getCredentials()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. vanta_status — graceful no-credentials path
// ---------------------------------------------------------------------------
describe('vanta_status (no credentials)', () => {
  it('returns a non-error result when credentials are absent', async () => {
    // Ensure credentials are absent
    clearVantaEnv();

    const server = createMcpServer();

    // Call the tool handler directly by simulating the MCP request
    // @ts-expect-error -- accessing internal handler map for testing
    const handlers = server._requestHandlers;
    const callHandler = handlers?.get('tools/call');
    expect(callHandler).toBeDefined();

    const result = await callHandler(
      { method: 'tools/call', params: { name: 'vanta_status', arguments: {} } },
      {},
    );

    expect(result).toBeDefined();
    // Must not be an error result
    expect(result.isError).toBeFalsy();
    // Must report missing credentials in the content text
    const text: string = result.content[0].text;
    expect(text).toContain('NOT CONFIGURED');
    expect(text).toContain('VANTA_CLIENT_ID');
    expect(text).toContain('VANTA_CLIENT_SECRET');
  });
});

// ---------------------------------------------------------------------------
// 3. vanta_navigate — invalid domain returns an error envelope
// ---------------------------------------------------------------------------
describe('vanta_navigate', () => {
  it('returns isError when given an unrecognised domain', async () => {
    const server = createMcpServer();
    // @ts-expect-error -- internal handler map
    const callHandler = server._requestHandlers?.get('tools/call');
    expect(callHandler).toBeDefined();

    const result = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'vanta_navigate', arguments: { domain: 'nonexistent_domain' } },
      },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid domain');
  });

  it('returns tool list for a valid domain', async () => {
    const server = createMcpServer();
    // @ts-expect-error -- internal handler map
    const callHandler = server._requestHandlers?.get('tools/call');

    const result = await callHandler(
      {
        method: 'tools/call',
        params: { name: 'vanta_navigate', arguments: { domain: 'controls' } },
      },
      {},
    );

    expect(result.isError).toBeFalsy();
    const text: string = result.content[0].text;
    expect(text).toContain('vanta_controls_list');
    expect(text).toContain('vanta_controls_get');
  });
});

// ---------------------------------------------------------------------------
// 4. Navigation tools — shape and content
// ---------------------------------------------------------------------------
describe('getNavigationTools', () => {
  it('returns exactly 2 tools: vanta_navigate and vanta_status', () => {
    const tools = getNavigationTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('vanta_navigate');
    expect(tools[1].name).toBe('vanta_status');
  });

  it('vanta_navigate inputSchema lists all 11 domain names in the domain enum description', () => {
    const nav = getNavigationTools()[0];
    // Domain names live in inputSchema.properties.domain.description, not the top-level description.
    const domainDesc: unknown = (nav.inputSchema as Record<string, unknown>)
      ?.properties as Record<string, unknown>;
    const domainPropDesc = ((domainDesc as Record<string, unknown>)?.domain as Record<string, unknown>)
      ?.description as string;
    expect(typeof domainPropDesc).toBe('string');
    for (const domain of DOMAINS) {
      expect(domainPropDesc).toContain(domain);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. DOMAINS constant
// ---------------------------------------------------------------------------
describe('DOMAINS', () => {
  it('contains all 11 expected domains', () => {
    expect(DOMAINS).toHaveLength(11);
    const expected = [
      'frameworks', 'controls', 'tests', 'documents', 'integrations',
      'people', 'vendors', 'risk_scenarios', 'vulnerabilities', 'policies',
      'monitored_computers',
    ];
    for (const d of expected) {
      expect(DOMAINS).toContain(d);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Tool registry — full count and expected names
// ---------------------------------------------------------------------------
describe('tool registry', () => {
  it('every domain exposes getTools() and handleCall()', async () => {
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      expect(typeof handler.getTools).toBe('function');
      expect(typeof handler.handleCall).toBe('function');
    }
  });

  it('all domain tool names match the expected registry (28 total)', async () => {
    const navTools = getNavigationTools().map(t => t.name);
    const domainTools: string[] = [];
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      domainTools.push(...handler.getTools().map(t => t.name));
    }
    const allNames = [...navTools, ...domainTools].sort();
    const expectedSorted = [...EXPECTED_TOOL_NAMES].sort();
    expect(allNames).toEqual(expectedSorted);
  });

  it('no domain tool name is duplicated', async () => {
    const names: string[] = [];
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      names.push(...handler.getTools().map(t => t.name));
    }
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('every registered tool has a non-empty description', async () => {
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      for (const tool of handler.getTools()) {
        expect(typeof tool.description).toBe('string');
        expect((tool.description ?? '').length).toBeGreaterThan(0);
      }
    }
  });

  it('every registered tool has an inputSchema of type object', async () => {
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      for (const tool of handler.getTools()) {
        expect(tool.inputSchema?.type).toBe('object');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Error envelope — domain handler surfaces isError when client throws
// ---------------------------------------------------------------------------
describe('error envelope', () => {
  it('controls.list returns isError when VantaClient throws a status error', async () => {
    // Arrange: make VantaClient throw an HTTP-like error when controls.list is called
    const { VantaClient } = await import('node-vanta');
    vi.mocked(VantaClient).mockImplementation(() => ({
      controls: {
        list: vi.fn().mockRejectedValue({ statusCode: 401, message: 'Unauthorized', body: 'invalid_client' }),
        get: vi.fn(),
      },
    }) as never);

    resetClient();
    setVantaEnv('fake-id', 'fake-secret');

    const handler = await getDomainHandler('controls');
    const result = await handler.handleCall('vanta_controls_list', {});

    expect(result.isError).toBe(true);
    const text: string = result.content[0].text;
    // The shared error envelope serialises a JSON object
    expect(text).toContain('FORBIDDEN');
  });

  it('controls.get returns isError when the client throws a 404', async () => {
    const { VantaClient } = await import('node-vanta');
    vi.mocked(VantaClient).mockImplementation(() => ({
      controls: {
        list: vi.fn(),
        get: vi.fn().mockRejectedValue({ statusCode: 404, message: 'Not Found', body: 'not_found' }),
      },
    }) as never);

    resetClient();
    setVantaEnv('fake-id', 'fake-secret');

    const handler = await getDomainHandler('controls');
    const result = await handler.handleCall('vanta_controls_get', { id: 'ctrl-does-not-exist' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('NOT_FOUND');
  });

  it('domain handler returns isError for an unknown tool name', async () => {
    // getClient() is called before the switch in every domain handler, so credentials
    // must be present for the switch's default branch to be reachable.  node-vanta is
    // mocked at the top of this file, so no real API call is made.
    const { VantaClient } = await import('node-vanta');
    vi.mocked(VantaClient).mockImplementation(() => ({
      controls: { list: vi.fn(), get: vi.fn() },
    }) as never);
    resetClient();
    setVantaEnv('fake-id', 'fake-secret');

    const handler = await getDomainHandler('controls');
    const result = await handler.handleCall('vanta_controls_nonexistent', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });
});
