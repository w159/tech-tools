import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

const seen: { envDuringRequest: (string | undefined)[]; agentOpts: unknown[] } =
  {
    envDuringRequest: [],
    agentOpts: [],
  };

vi.mock("node:https", () => {
  class Agent {
    constructor(opts: unknown) {
      seen.agentOpts.push(opts);
    }
  }
  const request = vi.fn(
    (
      _url: unknown,
      _opts: unknown,
      cb: (res: EventEmitter & { statusCode: number }) => void,
    ) => {
      seen.envDuringRequest.push(process.env.NODE_TLS_REJECT_UNAUTHORIZED);
      const req = Object.assign(new EventEmitter(), {
        write: vi.fn(),
        destroy: vi.fn(),
        end: () => {
          const res = Object.assign(new EventEmitter(), { statusCode: 200 });
          cb(res);
          res.emit("data", Buffer.from('{"ok":true}'));
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
});
