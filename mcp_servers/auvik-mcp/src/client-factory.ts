import type { AuvikCredentials } from './credentials.js';

// JSON:API response shapes
export interface JsonApiResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  links?: Record<string, string>;
}

export interface JsonApiResponse<T = JsonApiResource | JsonApiResource[]> {
  data: T;
  included?: JsonApiResource[];
  links?: { self?: string; first?: string; next?: string; prev?: string };
  meta?: Record<string, unknown>;
}

export interface AuvikApiError extends Error {
  status: number;
  body: unknown;
  retryAfter?: number;
}

function makeError(status: number, body: unknown, retryAfter?: number): AuvikApiError {
  const hasErrors =
    body && typeof body === 'object' && 'errors' in body && Array.isArray((body as any).errors);
  let detail: string;
  if (hasErrors) {
    detail = (body as any).errors.map((e: any) => e.title || e.detail || JSON.stringify(e)).join('; ');
  } else if (typeof body === 'string' && body.trim()) {
    detail = body.trim();
  } else if (body == null || body === '') {
    // Auvik returns an empty-body 404 when a by-id resource has no record
    // (e.g. a device with no warranty/lifecycle/billing row). Make that legible.
    detail = status === 404 ? 'no matching record (empty response body)' : '(empty response body)';
  } else {
    detail = JSON.stringify(body);
  }
  const err = new Error(`Auvik API ${status}: ${detail}`) as AuvikApiError;
  err.status = status;
  err.body = body;
  if (retryAfter !== undefined) err.retryAfter = retryAfter;
  return err;
}

// Build query string preserving JSON:API bracket syntax (filter[x]=y, page[first]=N).
// URLSearchParams percent-encodes [ and ] which Auvik accepts as %5B/%5D.
function buildQuery(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    const encKey = key.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
    if (Array.isArray(value)) {
      pairs.push(`${encKey}=${encodeURIComponent(value.join(','))}`);
    } else {
      pairs.push(`${encKey}=${encodeURIComponent(String(value))}`);
    }
  }
  return pairs.length ? `?${pairs.join('&')}` : '';
}

// Translate flat tool args to JSON:API query keys.
//   filter_deviceType  -> filter[deviceType]
//   fields_deviceDetail-> fields[deviceDetail]
//   pageSize           -> page[first]
//   pageAfter          -> page[after]
//   pageLast/pageBefore-> page[last]/page[before]
// Anything else (tenants, tenantDomainPrefix, include) passes through unchanged.
function toJsonApiParams(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || v === '') continue;
    if (k.startsWith('filter_')) {
      out[`filter[${k.slice('filter_'.length)}]`] = v;
    } else if (k.startsWith('fields_')) {
      out[`fields[${k.slice('fields_'.length)}]`] = v;
    } else if (k === 'pageSize') {
      out['page[first]'] = v;
    } else if (k === 'pageAfter') {
      out['page[after]'] = v;
    } else if (k === 'pageLast') {
      out['page[last]'] = v;
    } else if (k === 'pageBefore') {
      out['page[before]'] = v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

class AuvikHttpClient {
  private region: string;
  private readonly auth: string;
  private readonly maxRetries = 4;

  constructor(credentials: AuvikCredentials) {
    this.region = credentials.region || 'us1';
    this.auth = Buffer.from(`${credentials.username}:${credentials.apiKey}`).toString('base64');
  }

  private baseUrl(): string {
    return `https://auvikapi.${this.region}.my.auvik.com/v1`;
  }

  async request<T = JsonApiResponse>(path: string, params?: Record<string, unknown>): Promise<T> {
    const apiParams = toJsonApiParams(params);
    let attempt = 0;
    let url = `${this.baseUrl()}${path}${buildQuery(apiParams)}`;
    let redirects = 0;

    while (true) {
      const resp = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Authorization: `Basic ${this.auth}`,
          Accept: 'application/vnd.api+json, application/json',
        },
      });

      // Region redirect — re-target and re-send (fetch strips auth across hosts on auto-follow).
      if (resp.status === 308 || resp.status === 301 || resp.status === 307) {
        if (redirects++ > 5) throw makeError(resp.status, 'too many region redirects');
        const location = resp.headers.get('location');
        if (!location) throw makeError(resp.status, await resp.text());
        const match = location.match(/auvikapi\.([a-z0-9]+)\.my\.auvik\.com/);
        if (match) this.region = match[1];
        url = location;
        continue;
      }

      if (resp.status === 429) {
        const retryAfter = parseInt(resp.headers.get('retry-after') || '0', 10);
        if (attempt < this.maxRetries) {
          const backoff =
            retryAfter > 0
              ? Math.min(60_000, retryAfter * 1000)
              : Math.min(60_000, 1000 * 2 ** attempt + Math.random() * 250);
          await new Promise((r) => setTimeout(r, backoff));
          attempt++;
          continue;
        }
        throw makeError(429, await resp.json().catch(() => null), retryAfter || undefined);
      }

      const contentType = resp.headers.get('content-type') || '';
      const looksJson = contentType.includes('json');
      let body: unknown;
      if (looksJson) {
        body = await resp.json().catch(() => null);
      } else {
        const text = await resp.text();
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
      }

      if (!resp.ok) {
        throw makeError(resp.status, body);
      }

      // Empty-body 200 (e.g. /authentication/verify) → synthesize a shape.
      if (body === null || body === '') {
        return { data: null } as unknown as T;
      }
      return body as T;
    }
  }

  // Followable JSON:API navigation — used by auvik_navigate.
  async followUrl<T = JsonApiResponse>(absoluteUrl: string): Promise<T> {
    if (!/^https:\/\/auvikapi\.[a-z0-9]+\.my\.auvik\.com\/v1\//.test(absoluteUrl)) {
      throw new Error(`Refusing to follow non-Auvik URL: ${absoluteUrl}`);
    }
    const u = new URL(absoluteUrl);
    return this.request<T>(u.pathname.replace(/^\/v1/, '') + u.search, undefined);
  }
}

const enc = (s: string) => encodeURIComponent(s);

export interface AuvikClient {
  verify(): Promise<JsonApiResponse | { data: null }>;
  followUrl(absoluteUrl: string): Promise<JsonApiResponse>;

  tenants: {
    list(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    detail(tenantDomainPrefix: string, params?: Record<string, unknown>): Promise<JsonApiResponse>;
    detailById(id: string, tenantDomainPrefix: string): Promise<JsonApiResponse>;
  };

  devices: {
    list(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    get(id: string, params?: Record<string, unknown>): Promise<JsonApiResponse>;
    listDetail(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    getDetail(id: string): Promise<JsonApiResponse>;
    listExtended(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    getExtended(id: string): Promise<JsonApiResponse>;
    listWarranty(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    getWarranty(id: string): Promise<JsonApiResponse>;
    listLifecycle(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    getLifecycle(id: string): Promise<JsonApiResponse>;
  };

  interfaces: {
    list(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    get(id: string): Promise<JsonApiResponse>;
  };

  networks: {
    list(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    get(id: string, params?: Record<string, unknown>): Promise<JsonApiResponse>;
    listDetail(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    getDetail(id: string): Promise<JsonApiResponse>;
  };

  entities: {
    listNotes(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    getNote(id: string): Promise<JsonApiResponse>;
    listAudits(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    getAudit(id: string): Promise<JsonApiResponse>;
  };

  configurations: {
    list(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    get(id: string): Promise<JsonApiResponse>;
  };

  components: {
    list(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    get(id: string): Promise<JsonApiResponse>;
  };

  alerts: {
    list(params?: Record<string, unknown>): Promise<JsonApiResponse>;
    get(id: string): Promise<JsonApiResponse>;
  };

  statistics: {
    device(statId: string, params: Record<string, unknown>): Promise<JsonApiResponse>;
    deviceAvailability(statId: string, params: Record<string, unknown>): Promise<JsonApiResponse>;
    service(statId: string, params: Record<string, unknown>): Promise<JsonApiResponse>;
    interface(statId: string, params: Record<string, unknown>): Promise<JsonApiResponse>;
    component(componentType: string, statId: string, params: Record<string, unknown>): Promise<JsonApiResponse>;
    oid(statId: string, params: Record<string, unknown>): Promise<JsonApiResponse>;
  };

  billing: {
    clientUsage(params: Record<string, unknown>): Promise<JsonApiResponse>;
    deviceUsage(id: string, params: Record<string, unknown>): Promise<JsonApiResponse>;
  };
}

class RealAuvikClient implements AuvikClient {
  private http: AuvikHttpClient;
  constructor(credentials: AuvikCredentials) {
    this.http = new AuvikHttpClient(credentials);
  }

  verify() {
    return this.http.request('/authentication/verify');
  }

  followUrl(absoluteUrl: string) {
    return this.http.followUrl(absoluteUrl);
  }

  tenants = {
    list: (params?: Record<string, unknown>) => this.http.request('/tenants', params),
    detail: (tenantDomainPrefix: string, params?: Record<string, unknown>) =>
      this.http.request('/tenants/detail', { tenantDomainPrefix, ...params }),
    detailById: (id: string, tenantDomainPrefix: string) =>
      this.http.request(`/tenants/detail/${enc(id)}`, { tenantDomainPrefix }),
  };

  devices = {
    list: (params?: Record<string, unknown>) => this.http.request('/inventory/device/info', params),
    get: (id: string, params?: Record<string, unknown>) =>
      this.http.request(`/inventory/device/info/${enc(id)}`, params),
    listDetail: (params?: Record<string, unknown>) => this.http.request('/inventory/device/detail', params),
    getDetail: (id: string) => this.http.request(`/inventory/device/detail/${enc(id)}`),
    listExtended: (params?: Record<string, unknown>) =>
      this.http.request('/inventory/device/detail/extended', params),
    getExtended: (id: string) => this.http.request(`/inventory/device/detail/extended/${enc(id)}`),
    listWarranty: (params?: Record<string, unknown>) => this.http.request('/inventory/device/warranty', params),
    getWarranty: (id: string) => this.http.request(`/inventory/device/warranty/${enc(id)}`),
    listLifecycle: (params?: Record<string, unknown>) => this.http.request('/inventory/device/lifecycle', params),
    getLifecycle: (id: string) => this.http.request(`/inventory/device/lifecycle/${enc(id)}`),
  };

  interfaces = {
    list: (params?: Record<string, unknown>) => this.http.request('/inventory/interface/info', params),
    get: (id: string) => this.http.request(`/inventory/interface/info/${enc(id)}`),
  };

  networks = {
    list: (params?: Record<string, unknown>) => this.http.request('/inventory/network/info', params),
    get: (id: string, params?: Record<string, unknown>) =>
      this.http.request(`/inventory/network/info/${enc(id)}`, params),
    listDetail: (params?: Record<string, unknown>) => this.http.request('/inventory/network/detail', params),
    getDetail: (id: string) => this.http.request(`/inventory/network/detail/${enc(id)}`),
  };

  entities = {
    listNotes: (params?: Record<string, unknown>) => this.http.request('/inventory/entity/note', params),
    getNote: (id: string) => this.http.request(`/inventory/entity/note/${enc(id)}`),
    listAudits: (params?: Record<string, unknown>) => this.http.request('/inventory/entity/audit', params),
    getAudit: (id: string) => this.http.request(`/inventory/entity/audit/${enc(id)}`),
  };

  configurations = {
    list: (params?: Record<string, unknown>) => this.http.request('/inventory/configuration', params),
    get: (id: string) => this.http.request(`/inventory/configuration/${enc(id)}`),
  };

  components = {
    list: (params?: Record<string, unknown>) => this.http.request('/inventory/component/info', params),
    get: (id: string) => this.http.request(`/inventory/component/info/${enc(id)}`),
  };

  alerts = {
    list: (params?: Record<string, unknown>) => this.http.request('/alert/history/info', params),
    get: (id: string) => this.http.request(`/alert/history/info/${enc(id)}`),
  };

  statistics = {
    device: (statId: string, params: Record<string, unknown>) =>
      this.http.request(`/stat/device/${enc(statId)}`, params),
    deviceAvailability: (statId: string, params: Record<string, unknown>) =>
      this.http.request(`/stat/deviceAvailability/${enc(statId)}`, params),
    service: (statId: string, params: Record<string, unknown>) =>
      this.http.request(`/stat/service/${enc(statId)}`, params),
    interface: (statId: string, params: Record<string, unknown>) =>
      this.http.request(`/stat/interface/${enc(statId)}`, params),
    component: (componentType: string, statId: string, params: Record<string, unknown>) =>
      this.http.request(`/stat/component/${enc(componentType)}/${enc(statId)}`, params),
    oid: (statId: string, params: Record<string, unknown>) => this.http.request(`/stat/oid/${enc(statId)}`, params),
  };

  billing = {
    clientUsage: (params: Record<string, unknown>) => this.http.request('/billing/usage/client', params),
    deviceUsage: (id: string, params: Record<string, unknown>) =>
      this.http.request(`/billing/usage/device/${enc(id)}`, params),
  };
}

export function createAuvikClient(credentials: AuvikCredentials): AuvikClient {
  return new RealAuvikClient(credentials);
}
