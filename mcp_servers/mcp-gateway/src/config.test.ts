import { describe, expect, it } from "vitest";
import { directProtectedResourceMetadata, loadConfig } from "./config.js";

const TID = "11111111-1111-1111-1111-111111111111";
const CID = "22222222-2222-2222-2222-222222222222";
const entra = { ENTRA_TENANT_ID: TID, ENTRA_CLIENT_ID: CID, MCP_RESOURCE_URL: "https://mcp.example.com/mcp" };

describe("loadConfig", () => {
  it("keeps the legacy Entra env working with no GATEWAY_MODE", () => {
    const c = loadConfig(entra);
    expect(c.mode).toBe("direct");
    expect(c.publicBaseUrl).toBe("https://mcp.example.com");
    expect(c.resource).toBe("https://mcp.example.com/mcp");
    expect(c.direct).toMatchObject({
      issuer: `https://login.microsoftonline.com/${TID}/v2.0`,
      jwksUri: `https://login.microsoftonline.com/${TID}/discovery/v2.0/keys`,
      audiences: [CID, `api://${CID}`, "https://mcp.example.com/mcp"],
      tenant: { claim: "tid", equals: TID },
      scope: "https://mcp.example.com/mcp/access_as_user",
    });
    expect(c.port).toBe(8080);
    expect(c.backendsRoot).toBe("/app/mcp");
    expect(c.catalogFile).toMatch(/catalog\/catalog\.json$/);
    expect(Object.isFrozen(c)).toBe(true);
  });

  it("derives the resource from PUBLIC_BASE_URL", () => {
    const { MCP_RESOURCE_URL: _r, ...rest } = entra;
    const c = loadConfig({ ...rest, PUBLIC_BASE_URL: "https://gw.example.com" });
    expect(c.resource).toBe("https://gw.example.com/mcp");
  });

  it("reports every missing variable in one message", () => {
    expect(() => loadConfig({ ENTRA_TENANT_ID: "nope" })).toThrow(
      /PUBLIC_BASE_URL.*ENTRA_TENANT_ID \(not a GUID\).*ENTRA_CLIENT_ID/,
    );
  });

  it("requires GATEWAY_MODE when no Entra tenant is set", () => {
    expect(() => loadConfig({ PUBLIC_BASE_URL: "https://gw.example.com" })).toThrow(/GATEWAY_MODE/);
  });

  it("broker mode lists every missing broker variable in one message", () => {
    expect(() => loadConfig({ GATEWAY_MODE: "broker", PUBLIC_BASE_URL: "https://gw.example.com" })).toThrow(
      /BROKER_UPSTREAM_ISSUER.*BROKER_UPSTREAM_CLIENT_ID.*BROKER_UPSTREAM_CLIENT_SECRET.*BROKER_SIGNING_JWKS.*BROKER_COOKIE_KEYS/,
    );
  });

  it("supports generic direct mode", () => {
    const c = loadConfig({
      GATEWAY_MODE: "direct",
      PUBLIC_BASE_URL: "https://gw.example.com",
      DIRECT_ISSUER: "https://idp.example.com",
      DIRECT_JWKS_URI: "https://idp.example.com/jwks",
      DIRECT_AUDIENCES: "a, b",
      DIRECT_TENANT_CLAIM: "org",
      DIRECT_TENANT: "acme",
    });
    expect(c.direct).toMatchObject({ audiences: ["a", "b"], tenant: { claim: "org", equals: "acme" }, scope: "mcp" });
    expect(directProtectedResourceMetadata(c)).toEqual({
      resource: "https://gw.example.com/mcp",
      authorization_servers: ["https://idp.example.com"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
    });
  });

  it("rejects a half-set tenant pin, mixed ENTRA/DIRECT and a non-https base", () => {
    const base = { GATEWAY_MODE: "direct", PUBLIC_BASE_URL: "https://gw.example.com" };
    const generic = { DIRECT_ISSUER: "https://i.example.com", DIRECT_JWKS_URI: "https://i.example.com/k", DIRECT_AUDIENCES: "a" };
    expect(() => loadConfig({ ...base, ...generic, DIRECT_TENANT_CLAIM: "org" })).toThrow(/set both or neither/);
    expect(() => loadConfig({ ...base, ...generic, ...entra })).toThrow(/mutually exclusive/);
    expect(() => loadConfig({ ...entra, MCP_RESOURCE_URL: "http://mcp.example.com/mcp" })).toThrow(/MCP_RESOURCE_URL/);
  });

  it("parses lists and limits", () => {
    const c = loadConfig({ ...entra, ENABLED_BACKENDS: "vanta, auvik", STATEFUL_IDLE_MS: "5", STATEFUL_MAX_CHILDREN: "2", PORT: "0" });
    expect(c.enabledBackends).toEqual(["vanta", "auvik"]);
    expect([c.statefulIdleMs, c.statefulMaxChildren, c.port]).toEqual([5, 2, 0]);
    expect(() => loadConfig({ ...entra, PORT: "abc" })).toThrow(/PORT/);
  });
});
