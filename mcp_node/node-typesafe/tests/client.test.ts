import { describe, it, expect, vi, afterEach } from 'vitest';
import { TypeSafeClient, DEFAULT_TYPESAFE_MODEL, DEFAULT_OPENROUTER_MODEL } from '../src/client.js';
import { TypeSafeApiError } from '../src/errors.js';

function mockFetchOnce(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const QUESTIONS = { q1: { type: 'noul' as const, instructions: 'Is this urgent?' } };

describe('TypeSafeClient.resolveProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves "typesafe" when only TYPESAFE_API_KEY is set', () => {
    const client = new TypeSafeClient({ typesafeApiKey: 'ts-key' });
    expect(client.resolveProvider()).toEqual({ provider: 'typesafe', reason: 'typesafe-key-present' });
  });

  it('resolves "openrouter" when only OPENROUTER_API_KEY is set', () => {
    const client = new TypeSafeClient({ openrouterApiKey: 'or-key' });
    expect(client.resolveProvider()).toEqual({ provider: 'openrouter', reason: 'openrouter-key-present' });
  });

  it('prefers "typesafe" when both keys are set and no explicit provider is configured', () => {
    const client = new TypeSafeClient({ typesafeApiKey: 'ts-key', openrouterApiKey: 'or-key' });
    expect(client.resolveProvider()).toEqual({ provider: 'typesafe', reason: 'typesafe-key-present' });
  });

  it('honors an explicit provider setting when its key is present', () => {
    const client = new TypeSafeClient({
      typesafeApiKey: 'ts-key',
      openrouterApiKey: 'or-key',
      provider: 'openrouter',
    });
    expect(client.resolveProvider()).toEqual({ provider: 'openrouter', reason: 'explicit' });
  });

  it('throws MISSING_CREDENTIALS naming the exact env var when an explicit provider has no key', () => {
    const client = new TypeSafeClient({ provider: 'openrouter' });
    try {
      client.resolveProvider();
      expect.unreachable('expected resolveProvider to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TypeSafeApiError);
      const apiErr = err as TypeSafeApiError;
      expect(apiErr.code).toBe('MISSING_CREDENTIALS');
      expect(apiErr.message).toContain('OPENROUTER_API_KEY');
    }
  });

  it('throws MISSING_CREDENTIALS naming BOTH options when nothing is configured', () => {
    const client = new TypeSafeClient();
    try {
      client.resolveProvider();
      expect.unreachable('expected resolveProvider to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TypeSafeApiError);
      const apiErr = err as TypeSafeApiError;
      expect(apiErr.code).toBe('MISSING_CREDENTIALS');
      expect(apiErr.message).toContain('TYPESAFE_API_KEY');
      expect(apiErr.message).toContain('OPENROUTER_API_KEY');
    }
  });

  it('a per-call override takes precedence over the constructor setting', () => {
    const client = new TypeSafeClient({ typesafeApiKey: 'ts-key', openrouterApiKey: 'or-key', provider: 'typesafe' });
    expect(client.resolveProvider('openrouter')).toEqual({ provider: 'openrouter', reason: 'explicit' });
  });
});

describe('TypeSafeClient.resolveModel', () => {
  it('defaults to jev-latest for typesafe with no override', () => {
    const client = new TypeSafeClient();
    expect(client.resolveModel('typesafe')).toBe(DEFAULT_TYPESAFE_MODEL);
  });

  it('defaults to ~typesafe/jev-latest for openrouter with no override', () => {
    const client = new TypeSafeClient();
    expect(client.resolveModel('openrouter')).toBe(DEFAULT_OPENROUTER_MODEL);
  });

  it('uses a typesafe override verbatim', () => {
    const client = new TypeSafeClient({ model: 'jev-preview' });
    expect(client.resolveModel('typesafe')).toBe('jev-preview');
  });

  it('auto-prefixes a bare openrouter override with no "/" as "~typesafe/"', () => {
    const client = new TypeSafeClient({ model: 'jev-1.13' });
    expect(client.resolveModel('openrouter')).toBe('~typesafe/jev-1.13');
  });

  it('leaves an already-slashed openrouter override untouched', () => {
    const client = new TypeSafeClient({ model: 'typesafe/jev-1.13' });
    expect(client.resolveModel('openrouter')).toBe('typesafe/jev-1.13');
  });

  it('a per-call model override wins over the constructor override', () => {
    const client = new TypeSafeClient({ model: 'jev-preview' });
    expect(client.resolveModel('typesafe', 'jev-1.13')).toBe('jev-1.13');
  });
});

describe('TypeSafeClient.systemOne request shape', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to <base>/systemone with a Bearer header and {state,model,questions} for the typesafe provider', async () => {
    const fetchMock = mockFetchOnce(200, { model: 'jev-1.13.0', answers: { q1: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 2 } });
    const client = new TypeSafeClient({ typesafeApiKey: 'ts-key' });
    await client.systemOne({ state: 'a ticket', questions: QUESTIONS });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ts-key');
    expect(JSON.parse(init.body as string)).toEqual({ state: 'a ticket', model: DEFAULT_TYPESAFE_MODEL, questions: QUESTIONS });
  });

  it('POSTs to <base>/alpha/decisions with a Bearer header and {model,state,questions} for the openrouter provider', async () => {
    const fetchMock = mockFetchOnce(200, { answers: { q1: { type: 'noul', noul: 0.5 } } });
    const client = new TypeSafeClient({ openrouterApiKey: 'or-key', openrouterHttpReferer: 'https://example.test', openrouterXTitle: 'atlas' });
    await client.systemOne({ state: { ticket: 1 }, questions: QUESTIONS });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer or-key');
    expect(headers['http-referer']).toBe('https://example.test');
    expect(headers['x-title']).toBe('atlas');
    expect(JSON.parse(init.body as string)).toEqual({ model: DEFAULT_OPENROUTER_MODEL, state: { ticket: 1 }, questions: QUESTIONS });
  });

  it('honors a typesafeBaseUrl override for a staging/sovereign shard', async () => {
    const fetchMock = mockFetchOnce(200, { answers: {} });
    const client = new TypeSafeClient({ typesafeApiKey: 'ts-key', typesafeBaseUrl: 'https://staging.typesafe.example/v1/' });
    await client.systemOne({ state: 'x', questions: QUESTIONS });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://staging.typesafe.example/v1/systemone');
  });
});

describe('TypeSafeClient response normalization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads a flat {model,answers,usage} typesafe response', async () => {
    mockFetchOnce(200, { model: 'jev-1.13.0', answers: { q1: { type: 'noul', noul: 0.7 } }, usage: { input_tokens: 5, output_tokens: 1 } });
    const client = new TypeSafeClient({ typesafeApiKey: 'ts-key' });
    const result = await client.systemOne({ state: 'x', questions: QUESTIONS });
    expect(result).toEqual({
      provider: 'typesafe',
      model: 'jev-1.13.0',
      answers: { q1: { type: 'noul', noul: 0.7 } },
      usage: { input_tokens: 5, output_tokens: 1 },
    });
  });

  it('reads a flat {answers} openrouter response', async () => {
    mockFetchOnce(200, { model: 'jev-1.13.0', answers: { q1: { type: 'noul', noul: 0.3 } }, usage: { input_tokens: 4, output_tokens: 1 } });
    const client = new TypeSafeClient({ openrouterApiKey: 'or-key' });
    const result = await client.systemOne({ state: 'x', questions: QUESTIONS });
    expect(result).toEqual({
      provider: 'openrouter',
      model: 'jev-1.13.0',
      answers: { q1: { type: 'noul', noul: 0.3 } },
      usage: { input_tokens: 4, output_tokens: 1 },
    });
  });

  it('reads an openrouter response nested one level under "decision"', async () => {
    mockFetchOnce(200, {
      decision: { model: 'jev-1.13.0', answers: { q1: { type: 'noul', noul: 0.6 } }, usage: { input_tokens: 3, output_tokens: 1 } },
    });
    const client = new TypeSafeClient({ openrouterApiKey: 'or-key' });
    const result = await client.systemOne({ state: 'x', questions: QUESTIONS });
    expect(result).toEqual({
      provider: 'openrouter',
      model: 'jev-1.13.0',
      answers: { q1: { type: 'noul', noul: 0.6 } },
      usage: { input_tokens: 3, output_tokens: 1 },
    });
  });

  it('falls back to the requested model when the response omits it', async () => {
    mockFetchOnce(200, { answers: {} });
    const client = new TypeSafeClient({ typesafeApiKey: 'ts-key', model: 'jev-preview' });
    const result = await client.systemOne({ state: 'x', questions: QUESTIONS });
    expect(result.model).toBe('jev-preview');
  });
});

describe('TypeSafeClient.listModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does a live GET /models for the typesafe provider', async () => {
    const fetchMock = mockFetchOnce(200, { models: [{ name: 'jev-1.13.0', release_date: '2026-08-01' }] });
    const client = new TypeSafeClient({ typesafeApiKey: 'ts-key' });
    const result = await client.listModels();
    expect(result.source).toBe('live');
    expect(result.provider).toBe('typesafe');
    expect(result.models).toEqual([{ name: 'jev-1.13.0', release_date: '2026-08-01' }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/models');
    expect(init.method).toBe('GET');
  });

  it('returns the static two-entry list for the openrouter provider without calling fetch', async () => {
    const fetchMock = mockFetchOnce(200, {});
    const client = new TypeSafeClient({ openrouterApiKey: 'or-key' });
    const result = await client.listModels();
    expect(result.source).toBe('static');
    expect(result.provider).toBe('openrouter');
    expect(result.models.map((m) => m.name)).toEqual(['~typesafe/jev-latest', 'typesafe/jev-1.13']);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('TypeSafeClient error mapping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const cases: Array<[number, string]> = [
    [401, 'FORBIDDEN'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'VENDOR_ERROR'],
    [502, 'VENDOR_ERROR'],
  ];

  for (const [status, code] of cases) {
    it(`maps HTTP ${status} to ${code}`, async () => {
      mockFetchOnce(status, { error: 'boom' });
      const client = new TypeSafeClient({ typesafeApiKey: 'ts-key' });
      try {
        await client.systemOne({ state: 'x', questions: QUESTIONS });
        expect.unreachable('expected systemOne to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(TypeSafeApiError);
        expect((err as TypeSafeApiError).code).toBe(code);
        expect((err as TypeSafeApiError).status).toBe(status);
      }
    });
  }

  it('captures the retry-after header on a 429', async () => {
    mockFetchOnce(429, { error: 'rate limited' }, { 'retry-after': '30' });
    const client = new TypeSafeClient({ typesafeApiKey: 'ts-key' });
    try {
      await client.systemOne({ state: 'x', questions: QUESTIONS });
      expect.unreachable('expected systemOne to throw');
    } catch (err) {
      expect((err as TypeSafeApiError).retryAfter).toBe('30');
    }
  });

  it('maps a network-level fetch rejection to NETWORK_ERROR', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new TypeSafeClient({ typesafeApiKey: 'ts-key' });
    try {
      await client.systemOne({ state: 'x', questions: QUESTIONS });
      expect.unreachable('expected systemOne to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TypeSafeApiError);
      expect((err as TypeSafeApiError).code).toBe('NETWORK_ERROR');
    }
  });

  it('throws MISSING_CREDENTIALS from systemOne before any fetch when no provider resolves', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new TypeSafeClient();
    try {
      await client.systemOne({ state: 'x', questions: QUESTIONS });
      expect.unreachable('expected systemOne to throw');
    } catch (err) {
      expect((err as TypeSafeApiError).code).toBe('MISSING_CREDENTIALS');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
