import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { createMemoryAdapter } from "./adapter.js";
import { accountIdFor } from "./accounts.js";
import { lookupGoogleGroups, metadataTokenProvider, type FetchLike } from "./google-groups.js";
import { identityFromClaims } from "./identity.js";

const brokerEnv = {
  GATEWAY_MODE: "broker",
  PUBLIC_BASE_URL: "https://gw.example.com",
  BROKER_UPSTREAM_ISSUER: "https://accounts.example.com",
  BROKER_UPSTREAM_CLIENT_ID: "cid",
  BROKER_UPSTREAM_CLIENT_SECRET: "super-secret-value",
  BROKER_UPSTREAM_KIND: "google",
  BROKER_SIGNING_JWKS: JSON.stringify({ keys: [{ kty: "RSA", kid: "k1", n: "x", e: "AQAB", d: "private" }] }),
  BROKER_COOKIE_KEYS: "0123456789abcdef0123456789abcdef",
};

describe("broker config", () => {
  it("parses a complete broker environment with defaults", () => {
    const c = loadConfig(brokerEnv);
    expect(c.mode).toBe("broker");
    expect(c.resource).toBe("https://gw.example.com/mcp");
    expect(c.broker).toMatchObject({ accessTokenTtl: 900, refreshTokenTtl: 28800, googleGroupsLookup: false, trustedAssertionIssuers: [] });
  });

  it("rejects public-only JWKS, short cookie keys and a bad allowlist without echoing values", () => {
    let message = "";
    try {
      loadConfig({
        ...brokerEnv,
        BROKER_SIGNING_JWKS: JSON.stringify({ keys: [{ kty: "RSA", kid: "k1", n: "x", e: "AQAB" }] }),
        BROKER_COOKIE_KEYS: "short",
        BROKER_TRUSTED_ASSERTION_ISSUERS: '[{"issuer": 1}]',
        GOOGLE_GROUPS_LOOKUP: "1",
        BROKER_UPSTREAM_KIND: "oidc",
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/BROKER_SIGNING_JWKS/);
    expect(message).toMatch(/BROKER_COOKIE_KEYS/);
    expect(message).toMatch(/BROKER_TRUSTED_ASSERTION_ISSUERS/);
    expect(message).toMatch(/GOOGLE_GROUPS_LOOKUP/);
    expect(message).not.toContain("super-secret-value");
  });
});

describe("memory adapter", () => {
  it("expires entries, finds by uid, consumes and revokes by grant", async () => {
    const mem = createMemoryAdapter();
    const a = new mem.Adapter("Model");
    await a.upsert("1", { uid: "u1", grantId: "g1" }, 1);
    await a.upsert("2", { grantId: "g1" });
    expect((await a.findByUid("u1"))?.grantId).toBe("g1");
    await a.consume("2");
    expect(typeof (await a.find("2"))?.consumed).toBe("number");
    expect(mem.sweep(Date.now() + 5000)).toBe(1);
    expect(await a.find("1")).toBeUndefined();
    await a.revokeByGrantId("g1");
    expect(await a.find("2")).toBeUndefined();
  });
});

describe("identity mapping", () => {
  it("uses oid for Entra, tid as tenant, and merges extra groups", () => {
    const id = identityFromClaims("entra", { sub: "pairwise", oid: "oid-1", tid: "t1", preferred_username: "a@example.com", groups: ["g1"] }, ["g2"]);
    expect(id).toMatchObject({ sub: "oid-1", tenant: "t1", email: "a@example.com" });
    expect(id?.policyClaims.groups).toEqual(["g1", "g2"]);
  });

  it("drops an unverified email so a policy rule cannot match it", () => {
    const id = identityFromClaims("google", { sub: "s", email: "a@example.com", email_verified: false, hd: "example.com" });
    expect(id?.email).toBeUndefined();
    expect(id?.policyClaims.email).toBeUndefined();
    expect(id?.tenant).toBe("example.com");
  });

  it("derives a stable opaque account id", () => {
    expect(accountIdFor("https://i", "s")).toBe(accountIdFor("https://i", "s"));
    expect(accountIdFor("https://i", "s")).not.toBe(accountIdFor("https://i", "t"));
  });
});

describe("google groups lookup", () => {
  it("sends the documented query, follows pages and reads groupKey.id", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      urls.push(input);
      expect(init?.headers?.Authorization).toBe("Bearer tok");
      const second = input.includes("pageToken=p2");
      return new Response(
        JSON.stringify(
          second
            ? { memberships: [{ groupKey: { id: "b@example.com" } }] }
            : { memberships: [{ groupKey: { id: "a@example.com" } }], nextPageToken: "p2" },
        ),
        { status: 200 },
      );
    };
    const groups = await lookupGoogleGroups("alice@example.com", { fetchImpl, getAccessToken: async () => "tok" });
    expect(groups).toEqual(["a@example.com", "b@example.com"]);
    const first = new URL(urls[0]!);
    expect(first.origin + first.pathname).toBe("https://cloudidentity.googleapis.com/v1/groups/-/memberships:searchTransitiveGroups");
    expect(first.searchParams.get("query")).toBe(
      "member_key_id == 'alice@example.com' && 'cloudidentity.googleapis.com/groups.discussion_forum' in labels",
    );
  });

  it("refuses emails that could break out of the query and surfaces API failures", async () => {
    const never: FetchLike = async () => {
      throw new Error("should not be called");
    };
    await expect(lookupGoogleGroups("a'b@example.com", { fetchImpl: never, getAccessToken: async () => "t" })).rejects.toThrow();
    const failing: FetchLike = async () => new Response("{}", { status: 403 });
    await expect(lookupGoogleGroups("a@example.com", { fetchImpl: failing, getAccessToken: async () => "t" })).rejects.toThrow(/403/);
  });

  it("reads the metadata server with the Metadata-Flavor header and caches the token", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async (input, init) => {
      calls += 1;
      expect(input).toBe("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token");
      expect(init?.headers).toEqual({ "Metadata-Flavor": "Google" });
      return new Response(JSON.stringify({ access_token: "meta-token", expires_in: 3000, token_type: "Bearer" }), { status: 200 });
    };
    const get = metadataTokenProvider(fetchImpl);
    expect(await get()).toBe("meta-token");
    expect(await get()).toBe("meta-token");
    expect(calls).toBe(1);
  });
});
