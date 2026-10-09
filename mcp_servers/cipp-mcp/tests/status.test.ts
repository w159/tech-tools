import { CippToolHandler } from '../src/handlers/tool.handler.js';
import type { CippService } from '../src/services/cipp.service.js';
import type { Logger } from '../src/utils/logger.js';

// AGENTS.md section 4: every server exposes a <vendor>_status tool that RUNS
// WITHOUT CREDENTIALS and REPORTS CONFIGURATION STATE. cipp_status used to
// return the MISSING_CREDENTIALS error envelope (isError: true) instead, naming
// only CIPP_BASE_URL and hiding the auth-variable requirement.

const CIPP_ENV = [
  'CIPP_BASE_URL',
  'CIPP_URL',
  'CIPP_API_URL',
  'CIPP_API_KEY',
  'CIPP_TENANT_ID',
  'CIPP_CLIENT_ID',
  'CIPP_CLIENT_SECRET',
  'CIPP_TOKEN_SCOPE',
] as const;

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger;

const ping = jest.fn();
const handler = () => new CippToolHandler({ ping } as unknown as CippService, logger);

const textOf = (r: { content: Array<{ type: string; text: string }> }): string =>
  r.content.map((c) => c.text).join('\n');

describe('cipp_status without credentials', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    ping.mockReset();
    for (const name of CIPP_ENV) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of CIPP_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('returns a report, not an error', async () => {
    const result = await handler().handleToolCall('cipp_status', {});
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).not.toContain('MISSING_CREDENTIALS');
  });

  it('is prose, not a JSON error envelope', async () => {
    const text = textOf(await handler().handleToolCall('cipp_status', {}));
    expect(text).toMatch(/^CIPP MCP Server Status/);
    expect(() => JSON.parse(text)).toThrow();
  });

  it('names every missing variable, including the auth options the base-URL check used to hide', async () => {
    const text = textOf(await handler().handleToolCall('cipp_status', {}));
    expect(text).toContain('CIPP_BASE_URL');
    expect(text).toContain('CIPP_API_KEY');
    expect(text).toContain('CIPP_TENANT_ID');
    expect(text).toContain('CIPP_CLIENT_ID');
    expect(text).toContain('CIPP_CLIENT_SECRET');
    expect(text).toMatch(/CIPP_BASE_URL[^\n]*MISSING/i);
  });

  it('says the base URL has no default because CIPP is customer-hosted, and invents none', async () => {
    const text = textOf(await handler().handleToolCall('cipp_status', {}));
    expect(text).toMatch(/no default/i);
    expect(text).toMatch(/customer-hosted|self-hosted/i);
    expect(text).not.toMatch(/https?:\/\//i);
  });

  it('skips the live auth check and never touches the network', async () => {
    const text = textOf(await handler().handleToolCall('cipp_status', {}));
    expect(text).toContain('Auth check: SKIPPED (no credentials)');
    expect(ping).not.toHaveBeenCalled();
  });

  it('lists the available domains', async () => {
    const text = textOf(await handler().handleToolCall('cipp_status', {}));
    expect(text).toMatch(/Available domains: .*tenants/);
    expect(text).toMatch(/Available domains: .*core/);
  });

  it('reports a set variable as set without echoing its value', async () => {
    process.env['CIPP_API_KEY'] = 'super-secret-token-value';
    process.env['CIPP_TENANT_ID'] = 'tenant-guid-value';
    const text = textOf(await handler().handleToolCall('cipp_status', {}));
    expect(text).toMatch(/CIPP_API_KEY[^\n]*\bset\b/);
    expect(text).toMatch(/CIPP_BASE_URL[^\n]*MISSING/i);
    expect(text).not.toContain('super-secret-token-value');
    expect(text).not.toContain('tenant-guid-value');
    expect(text).toContain('Auth check: SKIPPED (no credentials)');
  });

  it('skips the auth check when auth is present but the base URL is not', async () => {
    process.env['CIPP_API_KEY'] = 'k';
    const result = await handler().handleToolCall('cipp_status', {});
    expect(result.isError).toBeFalsy();
    expect(ping).not.toHaveBeenCalled();
  });

  it('keeps the MISSING_CREDENTIALS error for every other tool', async () => {
    // Other tools are not reachable without a configured service in production
    // (server.ts hides them), but the handler contract is unchanged: a thrown
    // service error still maps to an error envelope, never to a status report.
    ping.mockRejectedValue(new Error('boom'));
    const result = await handler().handleToolCall('cipp_ping', {});
    expect(result.isError).toBe(true);
  });
});
