import { describe, it, expect, vi, afterEach } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleToken } from "./routes.js";
import type { EntraConfig } from "./types.js";

const config = {
  tenantId: "test-tenant-id",
  clientId: "test-client-id",
  audience: "api://test-client-id",
  requiredRole: "CWM.Access",
  serverUrl: "https://mcp.example.com",
} as EntraConfig;

describe("handleToken failure logging", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("logs status and OAuth error code only, never the body", async () => {
    const secretDescription =
      "AADSTS70000: SECRET-DESC refresh_token=abc123 trace-id-xyz";
    const azureBody = JSON.stringify({
      error: "invalid_grant",
      error_description: secretDescription,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(azureBody, { status: 400 })),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const req = Readable.from([
      Buffer.from("grant_type=authorization_code&code=SECRETCODE"),
    ]) as unknown as IncomingMessage;
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as unknown as ServerResponse;

    await handleToken(req, res, config);

    const logged = errSpy.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("status: 400");
    expect(logged).toContain("invalid_grant");
    expect(logged).not.toContain("SECRET-DESC");
    expect(logged).not.toContain("AADSTS70000");
    expect(logged).not.toContain("abc123");
    expect(logged).not.toContain("SECRETCODE");
    expect(logged).not.toContain("error_description");
    expect(logged).not.toContain(azureBody);
  });
});
