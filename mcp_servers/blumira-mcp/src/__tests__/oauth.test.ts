import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the SDK before importing client
vi.mock('node-blumira', () => ({
  BlumiraClient: vi.fn().mockImplementation(() => ({})),
}));

import { exchangeOAuthToken, getCredentials } from '../utils/client.js';

// Store original env
const originalEnv = { ...process.env };

beforeEach(() => {
  // Clear relevant env vars
  delete process.env.BLUMIRA_JWT_TOKEN;
  delete process.env.BLUMIRA_CLIENT_ID;
  delete process.env.BLUMIRA_CLIENT_SECRET;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('getCredentials', () => {
  it('should return null when no credentials are set', () => {
    expect(getCredentials()).toBeNull();
  });

  it('should return jwtToken when BLUMIRA_JWT_TOKEN is set', () => {
    process.env.BLUMIRA_JWT_TOKEN = 'test-jwt';
    const creds = getCredentials();
    expect(creds).toEqual({ jwtToken: 'test-jwt' });
  });

  it('should return sentinel when client_id + client_secret are set', () => {
    process.env.BLUMIRA_CLIENT_ID = 'id';
    process.env.BLUMIRA_CLIENT_SECRET = 'secret';
    const creds = getCredentials();
    expect(creds).not.toBeNull();
    expect(creds!.jwtToken).toBe('__oauth_pending__');
  });

  it('should prefer JWT token over client credentials', () => {
    process.env.BLUMIRA_JWT_TOKEN = 'my-jwt';
    process.env.BLUMIRA_CLIENT_ID = 'id';
    process.env.BLUMIRA_CLIENT_SECRET = 'secret';
    const creds = getCredentials();
    expect(creds).toEqual({ jwtToken: 'my-jwt' });
  });
});

describe('exchangeOAuthToken', () => {
  it('should call the OAuth endpoint and return access_token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-jwt-token', expires_in: 3600 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const token = await exchangeOAuthToken('test-id', 'test-secret');
    expect(token).toBe('new-jwt-token');
    expect(mockFetch).toHaveBeenCalledWith('https://auth.blumira.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: 'test-id',
        client_secret: 'test-secret',
        audience: 'public-api',
      }),
    });
  });

  it('should cache the token on subsequent calls', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'cached-token', expires_in: 3600 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const token1 = await exchangeOAuthToken('cache-id', 'cache-secret');
    const token2 = await exchangeOAuthToken('cache-id', 'cache-secret');
    expect(token1).toBe('cached-token');
    expect(token2).toBe('cached-token');
    // Should only have called fetch once due to caching
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should throw on failed exchange', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(exchangeOAuthToken('bad-id', 'bad-secret'))
      .rejects.toThrow('OAuth token exchange failed (401): Unauthorized');
  });
});
