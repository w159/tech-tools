import { describe, it, expect, afterEach, vi } from 'vitest';
import { handleStatus, statusTool } from '../src/tools/status.js';

describe('auvik_status', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    vi.restoreAllMocks();
  });

  it('declares the expected tool name', () => {
    expect(statusTool.name).toBe('auvik_status');
  });

  it('reports ok and absent credentials when env is empty', async () => {
    delete process.env.AUVIK_USERNAME;
    delete process.env.AUVIK_API_KEY;
    const result = await handleStatus();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.hasCredentials).toBe(false);
    expect(payload.region).toBeNull();
  });

  it('verifies credentials and reports the configured region', async () => {
    process.env.AUVIK_USERNAME = 'user@example.com';
    process.env.AUVIK_API_KEY = 'k';
    process.env.AUVIK_REGION = 'eu1';

    // Stub the verify call so the unit test makes no real network request.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200, headers: { 'content-type': 'application/json' } }))
    );

    const result = await handleStatus();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.hasCredentials).toBe(true);
    expect(payload.region).toBe('eu1');
    expect(payload.verified).toBe(true);
  });

  it('surfaces an auth failure without throwing', async () => {
    process.env.AUVIK_USERNAME = 'user@example.com';
    process.env.AUVIK_API_KEY = 'bad';
    delete process.env.AUVIK_REGION;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"errors":[{"title":"unauthorized"}]}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }))
    );

    const result = await handleStatus();
    const payload = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(payload.hasCredentials).toBe(true);
    expect(payload.verified).toBe(false);
    expect(payload.status).toBe(401);
  });
});
