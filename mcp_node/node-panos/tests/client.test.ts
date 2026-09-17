import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PanosClient } from '../src/client.js';
import { PanosApiError } from '../src/errors.js';

function mockFetchOnce(status: number, text: string) {
  const fetchMock = vi.fn(async (url: string) => ({
    status,
    text: async () => text,
    headers: { get: () => null },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('PanosClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed response on a success envelope', async () => {
    mockFetchOnce(200, '<response status="success"><result><system><hostname>fw1</hostname></system></result></response>');
    const client = new PanosClient({ host: 'panorama.example.com', apiKey: 'k' });
    const result = (await client.op('<show><system><info/></system></show>')) as Record<string, any>;
    expect(result.result.system.hostname).toBe('fw1');
  });

  it('throws PanosApiError on an error envelope served with HTTP 200', async () => {
    mockFetchOnce(200, '<response status="error" code="403"><msg>Forbidden</msg></response>');
    const client = new PanosClient({ host: 'panorama.example.com', apiKey: 'k' });
    await expect(client.op('<show><system><info/></system></show>')).rejects.toMatchObject({
      code: '403',
      httpStatus: 200,
    });
    await expect(client.op('<show><system><info/></system></show>')).rejects.toBeInstanceOf(PanosApiError);
  });

  it('does not throw on an empty result and returns it', async () => {
    mockFetchOnce(200, '<response status="success"><result/></response>');
    const client = new PanosClient({ host: 'panorama.example.com', apiKey: 'k' });
    const result = (await client.op('<show><jobs><all/></jobs></show>')) as Record<string, any>;
    expect(result.result).toBe('');
  });

  it('extracts the job id from a commit response', async () => {
    mockFetchOnce(200, '<response status="success"><result><msg>Commit job enqueued</msg><job>42</job></result></response>');
    const client = new PanosClient({ host: 'panorama.example.com', apiKey: 'k' });
    const { jobId } = await client.commit();
    expect(String(jobId)).toBe('42');
    // commit() declares jobId as string and jobs.status()/wait() take a string id,
    // so the job id must arrive as one rather than being coerced to a number.
    expect(jobId).toBe('42');
  });

  it('sends the API key in the X-PAN-KEY header and never in the request URL', async () => {
    const fetchMock = mockFetchOnce(200, '<response status="success"><result/></response>');
    const client = new PanosClient({ host: 'panorama.example.com', apiKey: 'super-secret-key' });
    await client.op('<show><system><info/></show>');

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).not.toContain('super-secret-key');
    expect((calledInit.headers as Record<string, string>)['X-PAN-KEY']).toBe('super-secret-key');
  });

  it('includes target when supplied, and omits it otherwise', async () => {
    const fetchMock = mockFetchOnce(200, '<response status="success"><result/></response>');
    const withDefaultTarget = new PanosClient({ host: 'panorama.example.com', apiKey: 'k', target: '001122334455' });
    await withDefaultTarget.op('<show><system><info/></show>');
    let calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(new URL(calledUrl).searchParams.get('target')).toBe('001122334455');

    fetchMock.mockClear();
    const withoutTarget = new PanosClient({ host: 'panorama.example.com', apiKey: 'k' });
    await withoutTarget.op('<show><system><info/></show>');
    calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(new URL(calledUrl).searchParams.has('target')).toBe(false);

    fetchMock.mockClear();
    await withDefaultTarget.op('<show><system><info/></show>', { target: 'override-serial' });
    calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(new URL(calledUrl).searchParams.get('target')).toBe('override-serial');
  });

  // PAN-OS serials, versions, and codes are identifiers, not quantities. Numeric
  // coercion drops leading zeros, so a serial read back here and fed to
  // target=<serial> would address nothing at all.
  it('preserves a leading-zero serial as a string', async () => {
    mockFetchOnce(
      200,
      '<response status="success"><result><system><serial>023009014025</serial></system></result></response>',
    );
    const client = new PanosClient({ host: 'fw.example.com', apiKey: 'k' });
    const result = (await client.op('<show><system><info/></system></show>')) as Record<string, any>;
    expect(result.result.system.serial).toBe('023009014025');
  });

  it('keeps digit-only version and family values as strings', async () => {
    mockFetchOnce(
      200,
      '<response status="success"><result><system><av-version>0</av-version><family>400</family><sw-version>11.1.13-h6</sw-version></system></result></response>',
    );
    const client = new PanosClient({ host: 'fw.example.com', apiKey: 'k' });
    const result = (await client.op('<show><system><info/></system></show>')) as Record<string, any>;
    expect(result.result.system['av-version']).toBe('0');
    expect(result.result.system.family).toBe('400');
    expect(result.result.system['sw-version']).toBe('11.1.13-h6');
  });

  it('reads the error code attribute as a string', async () => {
    mockFetchOnce(200, '<response status="error" code="403"><msg>Forbidden</msg></response>');
    const client = new PanosClient({ host: 'fw.example.com', apiKey: 'k' });
    await expect(client.op('<show><system><info/></system></show>')).rejects.toMatchObject({ code: '403' });
  });
});
