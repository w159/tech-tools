import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeGraph } from "../test-fixtures/fake-graph.js";
import { GraphClient, GraphError, resolveToken, retryAfterMs } from "./graph.js";

const TOKEN = "graph-test-token-0001";
let fake: FakeGraph;

beforeAll(async () => {
  fake = new FakeGraph({ token: TOKEN, pageSize: 3 });
  await fake.start();
});
afterAll(async () => fake.stop());
beforeEach(() => {
  fake.clearRequests();
  fake.clearThrottles();
});

const client = (extra: Partial<ConstructorParameters<typeof GraphClient>[0]> = {}): GraphClient =>
  new GraphClient({ baseUrl: fake.baseUrl, token: TOKEN, sleep: async () => undefined, ...extra });

describe("GraphClient", () => {
  it("follows @odata.nextLink until the last page", async () => {
    const rows = await client().getAll<{ id: string }>("/users?$select=department");
    expect(rows).toHaveLength(8);
    expect(fake.requests.filter((r) => r.path.startsWith("/v1.0/users"))).toHaveLength(3);
    expect(fake.requests.at(-1)!.path).toContain("$skiptoken=6");
  });

  it("honors Retry-After on 429 and retries the same request", async () => {
    fake.throttle("/v1.0/organization", 2, "7");
    const sleeps: number[] = [];
    const org = await client({ sleep: async (ms) => void sleeps.push(ms) }).get<{ value: unknown[] }>("/organization");
    expect(org.value).toHaveLength(1);
    expect(sleeps).toEqual([7000, 7000]);
    expect(fake.requests.filter((r) => r.path === "/v1.0/organization")).toHaveLength(3);
  });

  it("gives up after 3 retries of a 429", async () => {
    fake.throttle("/v1.0/organization", 10, "0");
    await expect(client().get("/organization")).rejects.toThrow(/still throttled \(429\) after 3 retries/);
    expect(fake.requests.filter((r) => r.path === "/v1.0/organization")).toHaveLength(4);
  });

  it("parses Retry-After seconds and HTTP dates, with a cap", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs("Wed, 21 Oct 2026 07:28:05 GMT", Date.parse("Wed, 21 Oct 2026 07:28:00 GMT"))).toBe(5000);
    expect(retryAfterMs("99999")).toBe(120_000);
    expect(retryAfterMs(null)).toBe(1000);
  });

  it("read-only mode refuses writes before any request is made", async () => {
    await expect(client({ readOnly: true }).send("POST", "/applications", { displayName: "x" })).rejects.toThrow(/read-only client/);
    expect(fake.requests).toHaveLength(0);
  });

  it("never sends the token to another origin via nextLink", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      const body = calls === 1 ? { value: [{ id: "1" }], "@odata.nextLink": "https://evil.example/v1.0/users?x=1" } : { value: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    await expect(client({ fetchFn: fetchFn as unknown as typeof fetch }).getAll("/users")).rejects.toThrow(/another origin/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("error messages do not contain the token", async () => {
    const bad = new GraphClient({ baseUrl: fake.baseUrl, token: "wrong-token-value", sleep: async () => undefined });
    const err = await bad.get("/organization").catch((e: unknown) => e as GraphError);
    expect(err).toBeInstanceOf(GraphError);
    expect(err.status).toBe(401);
    expect(err.message).not.toContain("wrong-token-value");
  });
});

describe("resolveToken", () => {
  it("prefers GRAPH_TOKEN and does not run az", async () => {
    const run = vi.fn();
    expect(await resolveToken({ GRAPH_TOKEN: " abc " }, run)).toBe("abc");
    expect(run).not.toHaveBeenCalled();
  });

  it("falls back to az with the documented arguments", async () => {
    const run = vi.fn(async () => "az-token\n");
    expect(await resolveToken({}, run)).toBe("az-token");
    expect(run).toHaveBeenCalledWith("az", ["account", "get-access-token", "--resource-type", "ms-graph", "--query", "accessToken", "-o", "tsv"]);
  });

  it("reports a missing Azure CLI without a stack trace", async () => {
    const run = async (): Promise<string> => {
      throw Object.assign(new Error("spawn az ENOENT"), { code: "ENOENT" });
    };
    await expect(resolveToken({}, run)).rejects.toThrow(/set GRAPH_TOKEN or install the Azure CLI/);
  });

  describe("real execFile against a stub az on PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "stub-az-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    it("runs az without a shell", async () => {
      writeFileSync(join(dir, "az"), `#!/bin/sh\necho "$@" > "${dir}/args"\necho stub-az-token\n`);
      chmodSync(join(dir, "az"), 0o755);
      const old = process.env.PATH;
      process.env.PATH = `${dir}:${old}`;
      try {
        expect(await resolveToken({})).toBe("stub-az-token");
      } finally {
        process.env.PATH = old;
      }
      expect(readFileSync(join(dir, "args"), "utf8").trim()).toBe("account get-access-token --resource-type ms-graph --query accessToken -o tsv");
    });
  });
});
