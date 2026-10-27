import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK, type JWTVerifyGetKey } from "jose";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { BackendLike, BackendSpec } from "../backends.js";

export const ISSUER = "https://idp.example.com";
export const AUDIENCE = "https://mcp.example.com/mcp";

export interface Signer {
  keyResolver: JWTVerifyGetKey;
  sign(claims: Record<string, unknown>, opts?: { exp?: string }): Promise<string>;
}

export async function makeSigner(kid = "test-key"): Promise<Signer> {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const privateKey: CryptoKey = pair.privateKey;
  const publicJwk = (await exportJWK(pair.publicKey)) as JWK;
  publicJwk.kid = kid;
  publicJwk.alg = "RS256";
  return {
    keyResolver: createLocalJWKSet({ keys: [publicJwk] }),
    sign: (claims, opts = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid })
        .setIssuedAt()
        .setExpirationTime(opts.exp ?? "1h")
        .sign(privateKey),
  };
}

export function tool(name: string, kind: "read" | "write" | "destructive" | "none" = "read"): Tool {
  const annotations =
    kind === "read"
      ? { readOnlyHint: true }
      : kind === "write"
        ? { readOnlyHint: false, destructiveHint: false }
        : kind === "destructive"
          ? { readOnlyHint: false, destructiveHint: true }
          : undefined;
  return { name, inputSchema: { type: "object" }, annotations };
}

export function spec(id: string, stateful = false): BackendSpec {
  return { id, compatRole: id.charAt(0).toUpperCase() + id.slice(1), command: "unused", args: [], envPrefixes: [], stateful };
}

export interface StubBackend extends BackendLike {
  calls: Array<{ name: string; args: Record<string, unknown> | undefined }>;
  closed: boolean;
}

export function stubBackend(s: BackendSpec, tools: Tool[], resultText = "stub-result"): StubBackend {
  const stub: StubBackend = {
    spec: s,
    calls: [],
    closed: false,
    async listTools() {
      return tools;
    },
    async callTool(name, args) {
      stub.calls.push({ name, args });
      return { content: [{ type: "text", text: resultText }] };
    },
    async close() {
      stub.closed = true;
    },
  };
  return stub;
}
