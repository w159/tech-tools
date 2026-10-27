import * as https from 'node:https';
import type { IncomingMessage } from 'node:http';
import { SonicwallApiError } from './errors.js';
import type { Method, SonicwallConfig, SonicwallInfo, SonicwallStatus } from './types.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const BASE_PATH = '/api/sonicos';
const REDACTED = '[redacted]';
const SECRET_KEYS = new Set(['password', 'tfa', 'psk', 'shared_secret']);
const TOKEN_KEYS = ['token', 'bearer_token', 'access_token'];
const REESTABLISHED_WARNING =
  'session re-established; any uncommitted pending config was discarded by the firewall';

interface TransportResponse {
  status: number;
  text(): Promise<string>;
  headers: { get(name: string): string | null; getSetCookie?(): string[] };
}

interface TransportInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * Same two-transport mechanism as node-panos: global fetch cannot take a
 * per-request https.Agent, so verifyTls: false uses node:https with a
 * per-request Agent instead of the banned process-wide
 * NODE_TLS_REJECT_UNAUTHORIZED. Verified requests use global fetch.
 * ponytail: two transports; collapse if node:undici becomes a builtin.
 */
// fallow-ignore-next-line code-duplication
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
            headers: {
              get: (name) => {
                const v = res.headers[name.toLowerCase()];
                return Array.isArray(v) ? v.join(', ') : (v ?? null);
              },
              getSetCookie: () => res.headers['set-cookie'] ?? [],
            },
          });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('SonicOS request timed out')));
    if (typeof init.body === 'string') req.write(init.body);
    req.end();
  });
}

type Query = Record<string, string | number | boolean | undefined>;
interface RequestOpts {
  query?: Query;
  body?: unknown;
  accept?: 'application/json' | 'text/plain';
}
interface RawResult {
  status: number;
  text: string;
  headers: TransportResponse['headers'];
}

export class SonicwallClient {
  private readonly host: string;
  private readonly port: number;
  private readonly username: string;
  private readonly password: string;
  private readonly verifyTls: boolean;
  private readonly sessionOverride: boolean;
  private readonly timeoutMs: number;
  private readonly injectedFetch: typeof fetch | undefined;

  private loggedIn = false;
  private bearer: string | undefined;
  private cookies: string[] = [];
  private lastActivity: number | undefined;
  private relogins = 0;
  private startManagementError: string | undefined;
  private configModeEntered = false;
  private readonly warningList: string[] = [];

  constructor(cfg: SonicwallConfig) {
    this.host = cfg.host;
    this.port = cfg.port ?? 443;
    this.username = cfg.username;
    this.password = cfg.password;
    this.verifyTls = cfg.verifyTls ?? true;
    this.sessionOverride = cfg.sessionOverride ?? false;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.injectedFetch = cfg.fetch;
  }

  // --- transport and redaction ---

  private basicHeader(): string {
    return 'Basic ' + Buffer.from(`${this.username}:${this.password}`).toString('base64');
  }

  private url(path: string, query?: Query): string {
    const p = path.startsWith('/') ? path : `/${path}`;
    const port = this.port === 443 ? '' : `:${this.port}`;
    const u = new URL(`https://${this.host}${port}${BASE_PATH}${p}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private async transport(url: string, init: TransportInit): Promise<TransportResponse> {
    if (this.injectedFetch) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        return (await this.injectedFetch(url, { ...init, signal: controller.signal })) as unknown as TransportResponse;
      } finally {
        clearTimeout(t);
      }
    }
    if (!this.verifyTls) return insecureFetch(url, { ...init, timeoutMs: this.timeoutMs });
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return (await fetch(url, { ...init, signal: controller.signal })) as unknown as TransportResponse;
    } finally {
      clearTimeout(t);
    }
  }

  // Strips the Basic header value, its base64, the password and the bearer from any string.
  private scrub(s: string): string {
    const secrets = [this.basicHeader(), Buffer.from(`${this.username}:${this.password}`).toString('base64'), this.password, this.bearer];
    let out = s;
    for (const secret of secrets) if (secret) out = out.split(secret).join(REDACTED);
    return out;
  }

  private scrubValue(v: unknown): unknown {
    if (typeof v === 'string') return this.scrub(v);
    if (Array.isArray(v)) return v.map((x) => this.scrubValue(x));
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.has(k) ? REDACTED : this.scrubValue(x)]),
      );
    }
    return v;
  }

  private scrubText(text: string): string {
    try {
      return JSON.stringify(this.scrubValue(JSON.parse(text)));
    } catch {
      return this.scrub(text);
    }
  }

  private async raw(method: Method, path: string, opts: RequestOpts = {}, basic = false): Promise<RawResult> {
    const headers: Record<string, string> = {
      Accept: opts.accept ?? 'application/json',
      'Content-Type': 'application/json',
      Authorization: !basic && this.bearer ? `Bearer ${this.bearer}` : this.basicHeader(),
    };
    if (this.cookies.length) headers.Cookie = this.cookies.join('; ');
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const res = await this.transport(this.url(path, opts.query), { method, headers, body, timeoutMs: this.timeoutMs });
    const text = await res.text();
    this.lastActivity = Date.now();
    return { status: res.status, text, headers: res.headers };
  }

  private static envelope(res: RawResult): { parsed: unknown; st?: { success?: boolean; info?: SonicwallInfo[] } } {
    let parsed: unknown;
    try {
      parsed = res.text.trim() ? JSON.parse(res.text) : undefined;
    } catch {
      parsed = undefined;
    }
    return { parsed, st: (parsed as { status?: { success?: boolean; info?: SonicwallInfo[] } } | undefined)?.status };
  }

  private cleanInfo(info: SonicwallInfo[] | undefined): SonicwallInfo[] {
    return (info ?? []).map((i) => ({ ...i, message: this.scrub(String(i.message ?? '')) }));
  }

  private fail(method: Method, path: string, res: RawResult, info: SonicwallInfo[]): SonicwallApiError {
    const errInfo = info.find((i) => i.level === 'error');
    const code = errInfo?.code ?? info[0]?.code;
    const detail = (errInfo ?? info[0])?.message;
    const msg = `SonicOS ${method} ${path} failed: HTTP ${res.status}${code ? ` ${code}` : ''}${detail ? `: ${detail}` : ''}`;
    return new SonicwallApiError(msg.trim(), {
      httpStatus: res.status,
      code,
      info,
      responseText: this.scrubText(res.text),
    });
  }

  // Applies the failure invariant: HTTP error, success:false, or any error-level info all throw.
  private parse<T>(method: Method, path: string, res: RawResult, accept?: string): T {
    const { parsed, st } = SonicwallClient.envelope(res);
    const info = this.cleanInfo(st?.info);
    if (res.status >= 400 || st?.success === false || info.some((i) => i.level === 'error')) {
      throw this.fail(method, path, res, info);
    }
    return (accept === 'text/plain' || parsed === undefined ? res.text : parsed) as T;
  }

  // --- session ---

  async login(): Promise<SonicwallStatus> {
    const res = await this.raw('POST', '/auth', this.sessionOverride ? { body: { override: true } } : {}, true);
    const status = this.parse<Record<string, unknown>>('POST', '/auth', res);
    this.bearer = this.findToken(status);
    this.cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter(Boolean);
    this.loggedIn = true;
    this.configModeEntered = false;
    try {
      const sm = await this.raw('POST', '/start-management');
      this.parse('POST', '/start-management', sm);
      this.startManagementError = undefined;
    } catch (e) {
      // Built-in admins do not need start-management; record, do not throw.
      this.startManagementError = e instanceof Error ? e.message : String(e);
    }
    return (status.status ?? status) as unknown as SonicwallStatus;
  }

  private findToken(body: Record<string, unknown>): string | undefined {
    const inner = body?.status && typeof body.status === 'object' ? (body.status as Record<string, unknown>) : {};
    for (const scope of [body, inner]) {
      for (const k of TOKEN_KEYS) if (typeof scope?.[k] === 'string' && scope[k]) return scope[k] as string;
    }
    return undefined;
  }

  async logout(): Promise<void> {
    try {
      if (this.loggedIn) await this.raw('DELETE', '/auth');
    } catch {
      // Logout is best effort: the session may already be gone.
    }
    this.loggedIn = false;
    this.bearer = undefined;
    this.cookies = [];
    this.configModeEntered = false;
  }

  session(): { loggedIn: boolean; bearer: boolean; lastActivity?: number; relogins: number; startManagementError?: string } {
    return {
      loggedIn: this.loggedIn,
      bearer: this.bearer !== undefined,
      lastActivity: this.lastActivity,
      relogins: this.relogins,
      startManagementError: this.startManagementError,
    };
  }

  // Warnings the caller must surface, e.g. that staged config was lost on re-login.
  warnings(): string[] {
    return [...this.warningList];
  }

  async request<T = unknown>(method: Method, path: string, opts: RequestOpts = {}): Promise<T> {
    if (!this.loggedIn) await this.login();
    let res = await this.raw(method, path, opts);
    if (res.status === 401 && path !== '/auth') {
      this.relogins += 1;
      this.warningList.push(REESTABLISHED_WARNING);
      this.loggedIn = false;
      await this.login();
      res = await this.raw(method, path, opts);
    }
    return this.parse<T>(method, path, res, opts.accept);
  }

  // --- config lifecycle ---

  async configMode(): Promise<SonicwallStatus> {
    const r = await this.request<SonicwallStatus>('POST', '/config-mode', this.sessionOverride ? { body: { override: true } } : {});
    this.configModeEntered = true;
    return r;
  }

  // fallow-ignore-next-line unused-class-member
  async nonConfigMode(): Promise<SonicwallStatus> {
    const r = await this.request<SonicwallStatus>('POST', '/non-config-mode');
    this.configModeEntered = false;
    return r;
  }

  // fallow-ignore-next-line unused-class-member
  pending(): Promise<unknown> {
    return this.request('GET', '/config/pending');
  }

  // Writes: config mode once per session first, one retry after E_NON_CONFIG.
  private async write<T>(method: Method, path: string, body?: unknown): Promise<T> {
    if (!this.configModeEntered) await this.configMode();
    try {
      return await this.request<T>(method, path, { body });
    } catch (e) {
      if (e instanceof SonicwallApiError && e.httpStatus === 405 && e.code === 'E_NON_CONFIG') {
        await this.configMode();
        return this.request<T>(method, path, { body });
      }
      throw e;
    }
  }

  commit(opts?: { bestEffort?: boolean }): Promise<SonicwallStatus> {
    return this.write('POST', opts?.bestEffort ? '/config/pending/best-effort' : '/config/pending');
  }

  discard(): Promise<SonicwallStatus> {
    return this.write('DELETE', '/config/pending');
  }

  // --- resources ---

  private resourcePath(resource: string, key: 'name' | 'uuid', id: string): string {
    return `/${resource}/${key}/${encodeURIComponent(id)}`;
  }

  // fallow-ignore-next-line unused-class-member
  list(resource: string): Promise<unknown> {
    return this.request('GET', `/${resource}`);
  }

  // fallow-ignore-next-line unused-class-member
  get(resource: string, key: 'name' | 'uuid', id: string): Promise<unknown> {
    return this.request('GET', this.resourcePath(resource, key, id));
  }

  create(resource: string, body: unknown): Promise<SonicwallStatus> {
    return this.write('POST', `/${resource}`, body);
  }

  update(resource: string, key: 'name' | 'uuid', id: string, body: unknown, opts?: { patch?: boolean }): Promise<SonicwallStatus> {
    return this.write(opts?.patch ? 'PATCH' : 'PUT', this.resourcePath(resource, key, id), body);
  }

  // fallow-ignore-next-line unused-class-member
  remove(resource: string, key: 'name' | 'uuid', id: string): Promise<SonicwallStatus> {
    return this.write('DELETE', this.resourcePath(resource, key, id));
  }
}
