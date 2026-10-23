import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

interface QueuedResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

const seen: {
  envDuringRequest: (string | undefined)[];
  agentOpts: unknown[];
  requests: { url: string; method: string; body: string | undefined }[];
  responses: QueuedResponse[];
} = {
  envDuringRequest: [],
  agentOpts: [],
  requests: [],
  responses: [],
};

vi.mock("node:https", () => {
  class Agent {
    constructor(opts: unknown) {
      seen.agentOpts.push(opts);
    }
  }
  const request = vi.fn(
    (
      url: URL,
      opts: { method: string },
      cb: (
        res: EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
        },
      ) => void,
    ) => {
      seen.envDuringRequest.push(process.env.NODE_TLS_REJECT_UNAUTHORIZED);
      let written: string | undefined;
      const req = Object.assign(new EventEmitter(), {
        write: (chunk: string) => {
          written = chunk;
        },
        destroy: vi.fn(),
        end: () => {
          seen.requests.push({
            url: url.toString(),
            method: opts.method,
            body: written,
          });
          const next = seen.responses.shift() ?? {
            status: 200,
            body: '{"ok":true}',
          };
          const res = Object.assign(new EventEmitter(), {
            statusCode: next.status,
            headers: next.headers ?? {},
          });
          cb(res);
          res.emit("data", Buffer.from(next.body ?? ""));
          res.emit("end");
        },
      });
      return req;
    },
  );
  return { default: { Agent, request }, Agent, request };
});

import { CwManageClient } from "./api-client.js";

const config = {
  baseUrl: "https://cw.example.test",
  companyId: "co",
  publicKey: "pub",
  privateKey: "priv",
  clientId: "cid",
};

describe("CwManageClient TLS handling", () => {
  const saved = {
    tls: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
    rej: process.env.CW_MANAGE_REJECT_UNAUTHORIZED,
  };

  beforeEach(() => {
    seen.envDuringRequest = [];
    seen.agentOpts = [];
    seen.requests = [];
    seen.responses = [];
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved.tls === undefined)
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = saved.tls;
    if (saved.rej === undefined)
      delete process.env.CW_MANAGE_REJECT_UNAUTHORIZED;
    else process.env.CW_MANAGE_REJECT_UNAUTHORIZED = saved.rej;
  });

  it("never touches the process-wide TLS env var when rejectUnauthorized=false", async () => {
    process.env.CW_MANAGE_REJECT_UNAUTHORIZED = "false";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const client = new CwManageClient(config);
    const result = await client.get<{ ok: boolean }>("/system/info");

    expect(result).toEqual({ ok: true });
    expect(seen.envDuringRequest).toEqual([undefined]);
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    expect(seen.agentOpts).toEqual([{ rejectUnauthorized: false }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses global fetch with verification intact by default", async () => {
    delete process.env.CW_MANAGE_REJECT_UNAUTHORIZED;
    const fetchSpy = vi.fn(
      async () => new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const client = new CwManageClient(config);
    await client.get("/system/info");

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(seen.agentOpts).toEqual([]);
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });
  describe("insecure transport redirects", () => {
    const insecureClient = () => {
      process.env.CW_MANAGE_REJECT_UNAUTHORIZED = "false";
      return new CwManageClient(config);
    };
    const redirect = (status: number, location: string): QueuedResponse => ({
      status,
      headers: { location },
    });

    it("follows a same-host redirect and returns the final body", async () => {
      seen.responses = [
        redirect(301, "/v4_6_release/apis/3.0/system/info/"),
        { status: 200, body: '{"ok":true}' },
      ];
      const result = await insecureClient().get<{ ok: boolean }>(
        "/system/info",
      );
      expect(result).toEqual({ ok: true });
      expect(seen.requests.map((r) => r.url)).toEqual([
        "https://cw.example.test/v4_6_release/apis/3.0/system/info",
        "https://cw.example.test/v4_6_release/apis/3.0/system/info/",
      ]);
    });

    it("keeps method and body on 307 but turns a 302 POST into a bodiless GET", async () => {
      seen.responses = [redirect(307, "/a"), { status: 200, body: "{}" }];
      await insecureClient().post("/tickets", { x: 1 });
      expect(seen.requests.map((r) => [r.method, r.body])).toEqual([
        ["POST", '{"x":1}'],
        ["POST", '{"x":1}'],
      ]);

      seen.requests = [];
      seen.responses = [redirect(302, "/b"), { status: 200, body: "{}" }];
      await insecureClient().post("/tickets", { x: 1 });
      expect(seen.requests.map((r) => [r.method, r.body])).toEqual([
        ["POST", '{"x":1}'],
        ["GET", undefined],
      ]);
    });

    it("never follows a redirect to another host: the 3xx surfaces as an error", async () => {
      seen.responses = [redirect(302, "https://evil.example.test/steal")];
      await expect(insecureClient().get("/system/info")).rejects.toMatchObject({
        status: 302,
      });
      expect(seen.requests).toHaveLength(1);
    });

    it("never follows an https -> http downgrade", async () => {
      seen.responses = [redirect(301, "http://cw.example.test/x")];
      await expect(insecureClient().get("/system/info")).rejects.toMatchObject({
        status: 301,
      });
      expect(seen.requests).toHaveLength(1);
    });

    it("stops after 5 redirects", async () => {
      seen.responses = Array.from({ length: 10 }, () => redirect(302, "/loop"));
      await expect(insecureClient().get("/system/info")).rejects.toMatchObject({
        status: 302,
      });
      expect(seen.requests).toHaveLength(6); // the original request + 5 followed hops
    });
  });
});
