import * as https from 'node:https';
import type { IncomingMessage } from 'node:http';
import { assertSuccess } from './xml.js';
import { createRestClient } from './rest.js';
import { createJobsClient } from './jobs.js';
import type { ConfigAction, ConfigParams, ExportParams, ImportParams, LogParams, PanosConfig, ReportParams } from './types.js';

const DEFAULT_REST_VERSION = 'v11.1';
const DEFAULT_TIMEOUT_MS = 60_000;

interface TransportResponse {
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  headers: { get(name: string): string | null };
}

interface TransportInit {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  timeoutMs?: number;
}

/**
 * Global fetch cannot be pointed at a per-request https.Agent (verified: an
 * https.Agent passed as `dispatcher` is silently ignored by Node's undici-based
 * fetch, and `node:undici` is not a builtin on this Node build). To honor
 * verifyTls: false without the banned process-wide NODE_TLS_REJECT_UNAUTHORIZED
 * mutation, and without adding a runtime dependency beyond fast-xml-parser,
 * insecure requests fall back to Node's built-in https module with a
 * per-request Agent. Secure requests (the default) use global fetch so tests
 * can mock at the fetch level per the design doc's "The check".
 * ponytail: two transports instead of one; revisit if `node:undici` ships as
 * a builtin on the supported Node floor.
 */
function insecureFetch(url: string, init: TransportInit): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const req = https.request(
      url,
      { method: init.method ?? 'GET', headers: init.headers, agent, timeout: init.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            text: async () => buf.toString('utf8'),
            arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
            headers: { get: (name) => (res.headers[name.toLowerCase()] as string) ?? null },
          });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('PAN-OS request timed out')));
    if (typeof init.body === 'string') req.write(init.body);
    req.end();
  });
}

export class PanosClient {
  private readonly host: string;
  private readonly apiKey: string;
  private readonly target: string | undefined;
  private readonly verifyTls: boolean;
  private readonly restVersion: string;
  private readonly timeoutMs: number;

  readonly rest: ReturnType<typeof createRestClient>;
  readonly jobs: ReturnType<typeof createJobsClient>;

  constructor(cfg: PanosConfig) {
    this.host = cfg.host;
    this.apiKey = cfg.apiKey;
    this.target = cfg.target;
    this.verifyTls = cfg.verifyTls ?? true;
    this.restVersion = cfg.restVersion ?? DEFAULT_REST_VERSION;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    this.rest = createRestClient({
      host: this.host,
      apiKey: this.apiKey,
      restVersion: this.restVersion,
      target: this.target,
      transport: (url, init) => this.transport(url, init),
    });

    this.jobs = createJobsClient((cmd) => this.op(cmd));
  }

  private async transport(url: string, init: TransportInit): Promise<TransportResponse> {
    if (!this.verifyTls) return insecureFetch(url, init);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? this.timeoutMs);
    try {
      const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: controller.signal });
      return res as unknown as TransportResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  // --- XML API ---

  async request(
    params: Record<string, string | undefined>,
    opts?: { method?: 'GET' | 'POST'; body?: FormData },
  ): Promise<unknown> {
    const method = opts?.method ?? 'GET';
    const url = new URL(`https://${this.host}/api/`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    // API key travels in the header, never the URL (design doc: Authentication).
    const headers: Record<string, string> = { 'X-PAN-KEY': this.apiKey };
    const res = await this.transport(url.toString(), { method, headers, body: opts?.body, timeoutMs: this.timeoutMs });
    const text = await res.text();
    return assertSuccess(text, res.status);
  }

  async op(cmd: string, opts?: { target?: string }): Promise<unknown> {
    return this.request({ type: 'op', cmd, target: opts?.target ?? this.target });
  }

  async config(action: ConfigAction, params: ConfigParams): Promise<unknown> {
    const { target, ...rest } = params;
    return this.request({ type: 'config', action, target: target ?? this.target, ...rest });
  }

  async commit(opts?: { cmd?: string; action?: 'partial' | 'all'; target?: string }): Promise<{ jobId?: string }> {
    const cmd = opts?.cmd ?? (opts?.action === 'all' ? '<commit-all></commit-all>' : '<commit></commit>');
    const response = (await this.request(
      { type: 'commit', cmd, target: opts?.target ?? this.target },
      { method: 'POST' },
    )) as Record<string, any>;
    const jobId = response?.result?.job as string | undefined;
    return { jobId };
  }

  async logs(params: LogParams): Promise<unknown> {
    const { target, ...rest } = params;
    return this.request({ type: 'log', target: target ?? this.target, ...rest });
  }

  async report(params: ReportParams): Promise<unknown> {
    const { target, ...rest } = params;
    return this.request({ type: 'report', target: target ?? this.target, ...rest });
  }

  async exportFile(params: ExportParams): Promise<{ contentType: string; bytes: number; text?: string }> {
    const { target, ...rest } = params;
    const url = new URL(`https://${this.host}/api/`);
    url.searchParams.set('type', 'export');
    for (const [key, value] of Object.entries({ target: target ?? this.target, ...rest })) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = { 'X-PAN-KEY': this.apiKey };
    const res = await this.transport(url.toString(), { headers, timeoutMs: this.timeoutMs });
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    if (contentType.includes('xml')) {
      const text = await res.text();
      assertSuccess(text, res.status);
      return { contentType, bytes: Buffer.byteLength(text, 'utf8'), text };
    }
    const buf = await res.arrayBuffer();
    return { contentType, bytes: buf.byteLength };
  }

  async importFile(params: ImportParams, file: { name: string; content: Buffer | string }): Promise<unknown> {
    const { target, ...rest } = params;
    const url = new URL(`https://${this.host}/api/`);
    url.searchParams.set('type', 'import');
    for (const [key, value] of Object.entries({ target: target ?? this.target, ...rest })) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const form = new FormData();
    const bytes = typeof file.content === 'string' ? file.content : new Uint8Array(file.content);
    form.set('file', new Blob([bytes]), file.name);
    const headers: Record<string, string> = { 'X-PAN-KEY': this.apiKey };
    const res = await this.transport(url.toString(), { method: 'POST', headers, body: form, timeoutMs: this.timeoutMs });
    const text = await res.text();
    return assertSuccess(text, res.status);
  }

  async version(): Promise<unknown> {
    return this.request({ type: 'version' });
  }
}
