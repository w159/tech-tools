import { describe, it, expect } from 'vitest';
import { SonicwallClient, SonicwallApiError } from '../src/index.js';

const PASSWORD = 'S3cretPassw0rd!';
const BASIC = 'Basic ' + Buffer.from(`apiadmin:${PASSWORD}`).toString('base64');
const OK = { status: { success: true, info: [{ level: 'info', code: 'E_OK', message: 'Success.' }] } };

interface Call { method: string; url: string; headers: Record<string, string>; body?: string }
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

// Scripted fake fetch: handler sees each call and returns a reply.
function harness(handler: (c: Call, n: number) => Reply) {
  const calls: Call[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    const c: Call = {
      method: init.method ?? 'GET',
      url: String(url),
      headers: { ...(init.headers as Record<string, string>) },
      body: init.body as string | undefined,
    };
    calls.push(c);
    const r = handler(c, calls.length);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? OK);
    return new Response(text, { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  const client = new SonicwallClient({ host: 'fw.example.test', username: 'apiadmin', password: PASSWORD, fetch: fakeFetch });
  return { calls, client };
}

const path = (c: Call) => new URL(c.url).pathname;

describe('login', () => {
  it('POSTs /api/sonicos/auth with Basic and no credential in the URL', async () => {
    const { calls, client } = harness(() => ({}));
    await client.login();
    expect(calls[0].method).toBe('POST');
    expect(path(calls[0])).toBe('/api/sonicos/auth');
    expect(calls[0].headers.Authorization).toBe(BASIC);
    expect(calls[0].headers.Accept).toBe('application/json');
    expect(calls[0].url).not.toContain(PASSWORD);
    expect(calls[0].url).not.toContain('apiadmin');
    expect(new URL(calls[0].url).host).toBe('fw.example.test');
  });

  it('sends override in the body only when sessionOverride is set', async () => {
    const calls: Call[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url: String(url), headers: init.headers as Record<string, string>, body: init.body as string });
      return new Response(JSON.stringify(OK), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new SonicwallClient({ host: 'h', username: 'u', password: 'p', sessionOverride: true, fetch: f, port: 8443 });
    await c.login();
    expect(JSON.parse(calls[0].body!)).toEqual({ override: true });
    expect(calls[0].url.startsWith('https://h:8443/api/sonicos/auth')).toBe(true);
  });

  it('sends a bearer token from the /auth body on later calls', async () => {
    const { calls, client } = harness((c) => (path(c) === '/api/sonicos/auth' ? { body: { status: { success: true, info: [] }, token: 'tok-123' } } : { body: { x: 1 } }));
    await client.request('GET', '/version');
    const last = calls[calls.length - 1];
    expect(path(last)).toBe('/api/sonicos/version');
    expect(last.headers.Authorization).toBe('Bearer tok-123');
    expect(client.session().bearer).toBe(true);
  });

  it('keeps sending Basic when /auth carries no token', async () => {
    const { calls, client } = harness((c) => (path(c) === '/api/sonicos/auth' ? {} : { body: { x: 1 } }));
    await client.request('GET', '/version');
    expect(calls[calls.length - 1].headers.Authorization).toBe(BASIC);
    expect(client.session().bearer).toBe(false);
  });

  it('tolerates a /start-management failure and records the session', async () => {
    const { client } = harness((c) =>
      path(c) === '/api/sonicos/start-management'
        ? { status: 400, body: { status: { success: false, info: [{ level: 'error', code: 'E_INVALID_API_CALL', message: 'nope' }] } } }
        : {},
    );
    await client.login();
    expect(client.session().loggedIn).toBe(true);
  });
});

describe('401 handling', () => {
  it('re-logs in exactly once and retries, with the pending-config warning', async () => {
    let versionHits = 0;
    const { calls, client } = harness((c) => {
      if (path(c) === '/api/sonicos/version') return ++versionHits === 1 ? { status: 401, body: { status: { success: false, info: [{ level: 'error', code: 'E_UNAUTHORIZED', message: 'x' }] } } } : { body: { firmware: '7.3' } };
      return {};
    });
    const res = await client.request<Record<string, unknown>>('GET', '/version');
    expect(res.firmware).toBe('7.3');
    expect(calls.filter((c) => path(c) === '/api/sonicos/auth')).toHaveLength(2);
    expect(client.session().relogins).toBe(1);
    expect(client.warnings().join(' ')).toContain('session re-established; any uncommitted pending config was discarded by the firewall');
  });

  it('throws SonicwallApiError(401) after a second 401', async () => {
    const { calls, client } = harness((c) => (path(c) === '/api/sonicos/version' ? { status: 401, body: { status: { success: false, info: [{ level: 'error', code: 'E_UNAUTHORIZED', message: 'x' }] } } } : {}));
    await expect(client.request('GET', '/version')).rejects.toMatchObject({ name: 'SonicwallApiError', httpStatus: 401 });
    expect(calls.filter((c) => path(c) === '/api/sonicos/version')).toHaveLength(2);
    expect(calls.filter((c) => path(c) === '/api/sonicos/auth')).toHaveLength(2);
  });
});

describe('envelope invariant', () => {
  it('throws on HTTP 200 with success:false', async () => {
    const { client } = harness((c) => (path(c) === '/api/sonicos/address-objects/ipv4' ? { body: { status: { success: false, info: [{ level: 'error', code: 'E_EXISTS', message: 'dup' }] } } } : {}));
    const err = await client.request('POST', '/address-objects/ipv4', { body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(SonicwallApiError);
    expect(err.code).toBe('E_EXISTS');
    expect(err.httpStatus).toBe(200);
  });

  it('returns on HTTP 200 with an E_WARNING info and attaches info', async () => {
    const body = { status: { success: true, info: [{ level: 'warning', code: 'E_WARNING', message: 'careful' }] } };
    const { client } = harness((c) => (path(c) === '/api/sonicos/thing' ? { body } : {}));
    const res = await client.request<typeof body>('POST', '/thing', { body: {} });
    expect(res.status.info[0].code).toBe('E_WARNING');
  });

  it('throws when an info entry has level error even without success', async () => {
    const { client } = harness((c) => (path(c) === '/api/sonicos/thing' ? { body: { status: { info: [{ level: 'error', code: 'E_TEST_FAILED', message: 'bad' }] } } } : {}));
    await expect(client.request('POST', '/thing', { body: {} })).rejects.toMatchObject({ code: 'E_TEST_FAILED' });
  });

  it('GET returns raw resource JSON; POST returns the status envelope', async () => {
    const { client } = harness((c) => (c.method === 'GET' ? { body: { address_objects: [{ ipv4: { name: 'a' } }] } } : {}));
    expect(await client.request('GET', '/address-objects/ipv4')).toEqual({ address_objects: [{ ipv4: { name: 'a' } }] });
    const post = (await client.request('POST', '/address-objects/ipv4', { body: {} })) as typeof OK;
    expect(post.status.success).toBe(true);
  });

  it('keeps identifiers as strings', async () => {
    const { client } = harness((c) => (c.method === 'GET' ? { body: '{"policy":{"uuid":"0123","name":"007"}}' } : {}));
    const res = (await client.request('GET', '/x')) as { policy: { uuid: string; name: string } };
    expect(res.policy.uuid).toBe('0123');
    expect(res.policy.name).toBe('007');
  });
});

describe('config lifecycle', () => {
  it('create() enters config mode once before the first write only', async () => {
    const { calls, client } = harness(() => ({}));
    await client.create('address-objects/ipv4', { a: 1 });
    await client.create('address-objects/ipv4', { a: 2 });
    const seq = calls.map((c) => `${c.method} ${path(c).replace('/api/sonicos', '')}`);
    expect(seq.filter((s) => s === 'POST /config-mode')).toHaveLength(1);
    expect(seq.indexOf('POST /config-mode')).toBeLessThan(seq.indexOf('POST /address-objects/ipv4'));
  });

  it('re-enters config mode once and retries on 405 E_NON_CONFIG', async () => {
    let writes = 0;
    const { calls, client } = harness((c) => {
      if (path(c) === '/api/sonicos/address-objects/ipv4') return ++writes === 1 ? { status: 405, body: { status: { success: false, info: [{ level: 'error', code: 'E_NON_CONFIG', message: 'non-config' }] } } } : {};
      return {};
    });
    await client.create('address-objects/ipv4', { a: 1 });
    expect(calls.filter((c) => path(c).endsWith('/config-mode'))).toHaveLength(2);
    expect(writes).toBe(2);
  });

  it('commit({bestEffort:true}) hits /config/pending/best-effort; default hits /config/pending', async () => {
    const { calls, client } = harness(() => ({}));
    await client.commit({ bestEffort: true });
    await client.commit();
    const commits = calls.filter((c) => path(c).includes('/config/pending')).map((c) => `${c.method} ${path(c)}`);
    expect(commits).toEqual(['POST /api/sonicos/config/pending/best-effort', 'POST /api/sonicos/config/pending']);
  });

  it('discard() DELETEs /config/pending; update uses PUT or PATCH by key', async () => {
    const { calls, client } = harness(() => ({}));
    await client.discard();
    await client.update('access-rules/ipv4', 'uuid', 'ab 1', { x: 1 });
    await client.update('zones', 'name', 'LAN', { x: 1 }, { patch: true });
    const last = calls.slice(-2);
    expect(`${calls.find((c) => c.method === 'DELETE')!.method} ${path(calls.find((c) => c.method === 'DELETE')!)}`).toBe('DELETE /api/sonicos/config/pending');
    expect(last[0].method).toBe('PUT');
    expect(last[0].url).toContain('/access-rules/ipv4/uuid/ab%201');
    expect(last[1].method).toBe('PATCH');
    expect(path(last[1])).toBe('/api/sonicos/zones/name/LAN');
  });
});

describe('redaction', () => {
  it('error message and responseText contain neither password nor Basic header', async () => {
    const leak = { status: { success: false, info: [{ level: 'error', code: 'E_SYNTAX', message: `bad ${BASIC} and ${PASSWORD}` }] }, password: PASSWORD, psk: 'topsecret' };
    const { client } = harness((c) => (path(c) === '/api/sonicos/thing' ? { status: 400, body: leak } : {}));
    const err = (await client.request('POST', '/thing', { body: {} }).catch((e) => e)) as SonicwallApiError;
    expect(err).toBeInstanceOf(SonicwallApiError);
    for (const s of [err.message, err.responseText, JSON.stringify(err.info)]) {
      expect(s).not.toContain(PASSWORD);
      expect(s).not.toContain(BASIC);
      expect(s).not.toContain(Buffer.from(`apiadmin:${PASSWORD}`).toString('base64'));
      expect(s).not.toContain('topsecret');
    }
  });

  it('does not leak the password when /auth itself fails', async () => {
    const { client } = harness((c) => (path(c) === '/api/sonicos/auth' ? { status: 401, body: { status: { success: false, info: [{ level: 'error', code: 'E_UNAUTHORIZED', message: 'bad' }] } } } : {}));
    const err = (await client.login().catch((e) => e)) as SonicwallApiError;
    expect(err.httpStatus).toBe(401);
    expect(err.message).not.toContain(PASSWORD);
    expect(err.responseText).not.toContain(PASSWORD);
  });
});

describe('logout', () => {
  it('never throws', async () => {
    const f = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    const c = new SonicwallClient({ host: 'h', username: 'u', password: 'p', fetch: f });
    await expect(c.logout()).resolves.toBeUndefined();
  });
});
