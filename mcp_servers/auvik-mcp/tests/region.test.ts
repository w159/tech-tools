import { describe, it, expect, afterEach, vi } from 'vitest';
import { getCredentials, resolveRegion } from '../src/credentials.js';
import { createAuvikClient } from '../src/client-factory.js';

// The region is interpolated into the host that receives the Basic-auth header.
describe('Auvik region validation', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['us1', 'us2', 'us3', 'us4', 'us5', 'us6', 'eu1', 'eu2', 'au1', 'ca1'])('keeps shard %s', (r) => {
    expect(resolveRegion(r)).toBe(r);
  });

  it.each(['x.localhost:48443/', 'evil.example/', 'us1.evil', 'US1', 'us9', 'eu1/'])('falls back to us1 for %s', (r) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveRegion(r)).toBe('us1');
    expect(err).toHaveBeenCalledOnce();
    expect(String(err.mock.calls[0][0])).not.toContain(r);
  });

  it('defaults to us1 when unset', () => {
    expect(resolveRegion(undefined)).toBe('us1');
  });

  it('getCredentials never returns an invalid env region', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.AUVIK_USERNAME = 'u';
    process.env.AUVIK_API_KEY = 'k';
    process.env.AUVIK_REGION = 'evil.example/';
    expect(getCredentials()?.region).toBe('us1');
  });

  it('client built with an invalid region targets the us1 host', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await createAuvikClient({ username: 'u', apiKey: 'k', region: 'x.localhost:48443/' }).verify();
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/auvikapi\.us1\.my\.auvik\.com\/v1\//);
  });

  it('follows a redirect to another Auvik shard', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', { status: 308, headers: { location: 'https://auvikapi.eu2.my.auvik.com/v1/authentication/verify' } })
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await createAuvikClient({ username: 'u', apiKey: 'k' }).verify();
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://auvikapi.eu2.my.auvik.com/v1/authentication/verify');
  });

  it.each([
    'https://evil.example/v1/authentication/verify',
    'https://auvikapi.eu2.my.auvik.com.evil.example/v1/x',
    'http://auvikapi.eu2.my.auvik.com/v1/x',
    'https://auvikapi.eu2.my.auvik.com:8443/v1/x',
    'https://auvikapi.zz9.my.auvik.com/v1/x',
  ])('refuses to re-send credentials on redirect to %s', async (location) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 308, headers: { location } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createAuvikClient({ username: 'u', apiKey: 'k' }).verify()).rejects.toThrow(/refusing redirect/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
