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
  it("TOKEN_CLOCK_TOLERANCE_SECONDS defaults to 5 and is validated", () => {
    expect(loadConfig(entra).tokenClockToleranceSeconds).toBe(5);
    expect(loadConfig({ ...entra, TOKEN_CLOCK_TOLERANCE_SECONDS: "0" }).tokenClockToleranceSeconds).toBe(0);
    expect(loadConfig({ ...entra, TOKEN_CLOCK_TOLERANCE_SECONDS: "60" }).tokenClockToleranceSeconds).toBe(60);
    expect(() => loadConfig({ ...entra, TOKEN_CLOCK_TOLERANCE_SECONDS: "-1" })).toThrow(/TOKEN_CLOCK_TOLERANCE_SECONDS \(not an integer >= 0\)/);
    expect(() => loadConfig({ ...entra, TOKEN_CLOCK_TOLERANCE_SECONDS: "1.5" })).toThrow(/TOKEN_CLOCK_TOLERANCE_SECONDS/);
    expect(() => loadConfig({ ...entra, TOKEN_CLOCK_TOLERANCE_SECONDS: "301" })).toThrow(/TOKEN_CLOCK_TOLERANCE_SECONDS \(not an integer <= 300\)/);
  });

  describe("Entra membership check", () => {
    const JWKS = JSON.stringify({ keys: [{ kid: "k1", kty: "RSA", d: "x" }] });
    const broker = {
      GATEWAY_MODE: "broker",
      PUBLIC_BASE_URL: "https://gw.example.com",
      BROKER_UPSTREAM_ISSUER: `https://login.microsoftonline.com/${TID}/v2.0`,
      BROKER_UPSTREAM_CLIENT_ID: CID,
      BROKER_UPSTREAM_CLIENT_SECRET: "s3cret",
      BROKER_UPSTREAM_KIND: "entra",
      BROKER_SIGNING_JWKS: JWKS,
      BROKER_COOKIE_KEYS: "cookie-signing-key-for-tests-0123456789",
    };

    it("is off by default and carries no membership config", () => {
      expect(loadConfig(broker).broker?.entraMembership).toBeUndefined();
    });

    it("derives the tenant from the issuer and applies defaults", () => {
      const c = loadConfig({ ...broker, ENTRA_MEMBERSHIP_CHECK: "1" });
      expect(c.broker?.entraMembership).toEqual({
        tenantId: TID,
        cacheSeconds: 300,
        failOpen: false,
        graphBaseUrl: "https://graph.microsoft.com/v1.0",
        authorityHost: "https://login.microsoftonline.com",
      });
    });

    it("reads every option", () => {
      const sp = "33333333-3333-3333-3333-333333333333";
      const c = loadConfig({
        ...broker,
        ENTRA_MEMBERSHIP_CHECK: "1",
        ENTRA_SP_OBJECT_ID: sp,
        ENTRA_MEMBERSHIP_CACHE_SECONDS: "60",
        ENTRA_MEMBERSHIP_FAIL_OPEN: "1",
        IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
        IDENTITY_HEADER: "hdr",
      });
      expect(c.broker?.entraMembership).toMatchObject({
        spObjectId: sp,
        cacheSeconds: 60,
        failOpen: true,
        managedIdentity: { endpoint: "http://127.0.0.1:42356/msi/token", header: "hdr" },
      });
    });

    it("needs BROKER_UPSTREAM_KIND=entra", () => {
      expect(() => loadConfig({ ...broker, BROKER_UPSTREAM_KIND: "google", ENTRA_MEMBERSHIP_CHECK: "1" })).toThrow(
        /ENTRA_MEMBERSHIP_CHECK \(only valid when BROKER_UPSTREAM_KIND=entra\)/,
      );
    });

    it("needs a tenant from ENTRA_TENANT_ID or the issuer", () => {
      const noTenant = { ...broker, BROKER_UPSTREAM_ISSUER: "https://idp.example.com", ENTRA_MEMBERSHIP_CHECK: "1" };
      expect(() => loadConfig(noTenant)).toThrow(/ENTRA_TENANT_ID \(required when BROKER_UPSTREAM_ISSUER carries no tenant\)/);
      expect(loadConfig({ ...noTenant, ENTRA_TENANT_ID: TID }).broker?.entraMembership?.tenantId).toBe(TID);
    });

    it("rejects malformed values without echoing them", () => {
      const on = { ...broker, ENTRA_MEMBERSHIP_CHECK: "1" };
      expect(() => loadConfig({ ...on, ENTRA_TENANT_ID: "nope" })).toThrow(/ENTRA_TENANT_ID \(not a GUID\)/);
      expect(() => loadConfig({ ...on, ENTRA_SP_OBJECT_ID: "nope" })).toThrow(/ENTRA_SP_OBJECT_ID \(not a GUID\)/);
      expect(() => loadConfig({ ...on, ENTRA_MEMBERSHIP_CACHE_SECONDS: "-5" })).toThrow(/ENTRA_MEMBERSHIP_CACHE_SECONDS/);
      expect(() => loadConfig({ ...on, ENTRA_GRAPH_BASE_URL: "http://graph.example.com" })).toThrow(/ENTRA_GRAPH_BASE_URL \(not an https URL\)/);
      expect(() => loadConfig({ ...on, IDENTITY_ENDPOINT: "http://127.0.0.1:1/t" })).toThrow(/IDENTITY_ENDPOINT and IDENTITY_HEADER \(set both or neither\)/);
      expect(() => loadConfig({ ...on, IDENTITY_ENDPOINT: "http://evil.example.com/t", IDENTITY_HEADER: "h" })).toThrow(/IDENTITY_ENDPOINT \(not an https URL\)/);
      try {
        loadConfig({ ...on, ENTRA_SP_OBJECT_ID: "leak-me-not" });
      } catch (e) {
        expect(String(e)).not.toContain("leak-me-not");
      }
    });

    it("ignores the ENTRA_* options while the check is off", () => {
      expect(() => loadConfig({ ...broker, BROKER_UPSTREAM_KIND: "google", ENTRA_SP_OBJECT_ID: "nope" })).not.toThrow();
    });
  });
});
