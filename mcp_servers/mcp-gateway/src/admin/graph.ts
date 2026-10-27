import { execFile } from "node:child_process";

// Minimal Microsoft Graph client for the admin tool: bearer auth, @odata.nextLink
// paging, 429 handling that honors Retry-After, and a read-only mode that makes
// a non-GET request impossible rather than merely unlikely.
//
// Refs (Microsoft Learn):
//   throttling   https://learn.microsoft.com/en-us/graph/throttling
//   paging       https://learn.microsoft.com/en-us/graph/paging
//   az token     https://learn.microsoft.com/en-us/cli/azure/account?view=azure-cli-latest#az-account-get-access-token

export const DEFAULT_GRAPH_BASE_URL = "https://graph.microsoft.com";
const API_VERSION = "v1.0";
const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_SECONDS = 120;

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface GraphClientOptions {
  baseUrl?: string;
  token: string;
  // Reads only: any other method throws before a request is made.
  readOnly?: boolean;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface Page<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

export class GraphClient {
  private readonly base: URL;
  private readonly token: string;
  private readonly readOnly: boolean;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: GraphClientOptions) {
    this.base = new URL(opts.baseUrl || DEFAULT_GRAPH_BASE_URL);
    this.token = opts.token;
    this.readOnly = opts.readOnly === true;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // path is relative to /v1.0 (e.g. "/users?$select=id"); an absolute URL is
  // accepted only when it is on the same origin (nextLink).
  private resolve(path: string): URL {
    if (/^https?:\/\//i.test(path)) {
      const u = new URL(path);
      if (u.origin !== this.base.origin) {
        throw new GraphError(`refusing to follow a link to another origin (${u.origin}); the bearer token is only sent to ${this.base.origin}`);
      }
      return u;
    }
    return new URL(`${this.base.origin}/${API_VERSION}${path.startsWith("/") ? path : `/${path}`}`);
  }

  async request(method: Method, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
    if (this.readOnly && method !== "GET") throw new GraphError(`read-only client: refusing ${method} ${path}`);
    const url = this.resolve(path);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...opts.headers,
    };
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(url, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
      } catch (err) {
        throw new GraphError(`${method} ${url.pathname}: network error: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (res.status === 429) {
        if (attempt >= MAX_RETRIES) throw new GraphError(`${method} ${url.pathname}: still throttled (429) after ${MAX_RETRIES} retries`, 429);
        await res.arrayBuffer().catch(() => undefined);
        await this.sleep(retryAfterMs(res.headers.get("retry-after")));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new GraphError(`${method} ${url.pathname}: HTTP ${res.status}${describe(text)}`, res.status);
      }
      return res;
    }
  }

  async get<T>(path: string, headers?: Record<string, string>): Promise<T> {
    return (await (await this.request("GET", path, { headers })).json()) as T;
  }

  async getText(path: string, headers?: Record<string, string>): Promise<string> {
    return (await this.request("GET", path, { headers })).text();
  }

  // Follows @odata.nextLink to the end.
  async getAll<T>(path: string, headers?: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: Page<T> = await this.get<Page<T>>(next, headers);
      out.push(...page.value);
      next = page["@odata.nextLink"];
    }
    return out;
  }

  async send<T = unknown>(method: Exclude<Method, "GET">, path: string, body?: unknown): Promise<T | undefined> {
    const res = await this.request(method, path, { body });
    if (res.status === 204) return undefined;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : undefined;
  }
}

function describe(text: string): string {
  try {
    const e = (JSON.parse(text) as { error?: { code?: string; message?: string } }).error;
    if (e) return ` ${e.code ?? ""} ${e.message ?? ""}`.trimEnd();
  } catch {
    /* not JSON */
  }
  return "";
}

// Retry-After is delta-seconds or an HTTP date. Capped so a bad header cannot hang the tool.
export function retryAfterMs(header: string | null, now = Date.now()): number {
  if (!header) return 1000;
  const secs = Number(header);
  let ms: number;
  if (Number.isFinite(secs)) ms = secs * 1000;
  else {
    const at = Date.parse(header);
    ms = Number.isNaN(at) ? 1000 : at - now;
  }
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_SECONDS * 1000);
}

type Runner = (file: string, args: string[]) => Promise<string>;

const runFile: Runner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 30_000, maxBuffer: 1 << 20 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

// GRAPH_TOKEN wins; otherwise ask the Azure CLI. execFile, no shell. The token
// is returned to the caller and never logged here.
export async function resolveToken(env: NodeJS.ProcessEnv, run: Runner = runFile): Promise<string> {
  const fromEnv = env.GRAPH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  let out: string;
  try {
    out = await run("az", ["account", "get-access-token", "--resource-type", "ms-graph", "--query", "accessToken", "-o", "tsv"]);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new GraphError(
      code === "ENOENT"
        ? "no Graph token: set GRAPH_TOKEN or install the Azure CLI and run `az login`"
        : "no Graph token: `az account get-access-token --resource-type ms-graph` failed; run `az login` or set GRAPH_TOKEN",
    );
  }
  const token = out.trim();
  if (!token) throw new GraphError("no Graph token: az returned an empty token");
  return token;
}

export function odataString(value: string): string {
  return value.replaceAll("'", "''");
}
