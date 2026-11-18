import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cameThroughProxy, decideAccess, isLoopbackAddress, isLoopbackHost, LOCAL_TOKEN_FILE, resolveToken, type AccessInput } from "./access.ts";

const device = { id: "d1", label: "Phone", role: "drive" as const };
const base: AccessInput = { loopback: true, forwarded: false, funnel: false, tailscaleLogin: null, tokenMatched: false, device: null, owner: null, tagged: false, tokenConfigured: false, gated: false };
const via = (input: Partial<AccessInput>) => { const a = decideAccess({ ...base, ...input }); return a.level === "full" ? a.via : `refused:${a.reason}`; };

describe("ensureLocalToken", () => {
  it("creates one owner-only token and keeps it across restarts (X3)", async () => {
    const { mkdtempSync, statSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { ensureLocalToken, LOCAL_TOKEN_FILE } = await import("./access.ts");
    const dir = join(mkdtempSync(join(tmpdir(), "herdr-token-")), "state");
    const first = ensureLocalToken(dir);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(ensureLocalToken(dir)).toBe(first);
    expect(readFileSync(join(dir, LOCAL_TOKEN_FILE), "utf8").trim()).toBe(first);
    expect(statSync(join(dir, LOCAL_TOKEN_FILE)).mode & 0o777).toBe(0o600);
  });
});

describe("resolveToken", () => {
  const stateDir = () => join(mkdtempSync(join(tmpdir(), "herdr-resolve-")), "state");

  it("makes a local token by default, and it is not a configured one", () => {
    const dir = stateDir();
    const resolved = resolveToken({ configured: "", trustLocal: false, stateDir: dir });
    expect(resolved.token).toBe(readFileSync(join(dir, LOCAL_TOKEN_FILE), "utf8").trim());
    expect(resolved.configured).toBe(false);
  });

  it("an operator's token wins and writes no file", () => {
    const dir = stateDir();
    expect(resolveToken({ configured: "mine", trustLocal: false, stateDir: dir })).toEqual({ token: "mine", configured: true });
    expect(() => readFileSync(join(dir, LOCAL_TOKEN_FILE))).toThrow();
  });

  it("the trusted-host opt-out makes no token", () => {
    expect(resolveToken({ configured: "", trustLocal: true, stateDir: stateDir() })).toEqual({ token: "", configured: false });
  });
});

describe("decideAccess", () => {
  it("refuses a bare loopback request with no token by default (X3)", () => {
    expect(via({})).toBe("refused:token_required");
    expect(via({ tagged: true })).toBe("refused:token_required");
    expect(via({ tokenMatched: true })).toBe("token");
  });

  it("with the generated local token in place, the owner's Tailscale login still gets in and an anonymous loopback request is still refused", () => {
    // what index.ts feeds decideAccess by default: a token exists (tokenMatched can hold), but no operator set one
    const { token, configured } = resolveToken({ configured: "", trustLocal: false, stateDir: join(mkdtempSync(join(tmpdir(), "herdr-order-")), "state") });
    expect(token).not.toBe("");
    const wired = { tokenConfigured: configured };
    expect(via({ ...wired, forwarded: true, tailscaleLogin: "me@example.com", owner: "me@example.com" })).toBe("tailscale");
    expect(via({ ...wired, forwarded: true, tailscaleLogin: "them@example.com", owner: "me@example.com" })).toBe("refused:other_user");
    expect(via({ ...wired, owner: "me@example.com" })).toBe("refused:token_required");
    expect(via({ ...wired })).toBe("refused:token_required");
    expect(via({ ...wired, tokenMatched: true })).toBe("token");
  });

  it("checks token, device, an operator's token, owner login, local, then proxy, in that order", () => {
    const owner = { forwarded: true, tailscaleLogin: "me@example.com", owner: "me@example.com" };
    // token beats everything
    expect(via({ ...owner, tokenConfigured: true, tokenMatched: true, device })).toBe("token");
    // a paired device beats an operator token and the login
    expect(via({ ...owner, tokenConfigured: true, device })).toBe("device");
    // an operator token beats the login header (a forged header through another proxy must not bypass it)
    expect(via({ ...owner, tokenConfigured: true })).toBe("refused:token_required");
    // the login beats the bare-local rule, and trustLocal does not turn a wrong login into local access
    expect(via({ ...owner })).toBe("tailscale");
    expect(via({ forwarded: true, tailscaleLogin: "them@example.com", owner: "me@example.com", trustLocal: true })).toBe("refused:other_user");
    // only then the bare local rule
    expect(via({ trustLocal: true })).toBe("local");
    expect(via({})).toBe("refused:token_required");
  });

  it("lets this PC in without a token only on the explicit trusted-host opt-out, and not through a proxy", () => {
    expect(via({ trustLocal: true })).toBe("local");
    expect(via({ trustLocal: true, tagged: true })).toBe("local");
    expect(via({ trustLocal: true, forwarded: true, gated: true })).toBe("refused:pairing_required");
  });

  it("keeps everything open, as before, while no token and no device exist", () => {
    expect(via({ loopback: false })).toBe("open");
    expect(via({ loopback: true, forwarded: true })).toBe("open");
    expect(via({ loopback: false, gated: true })).toBe("refused:pairing_required");
  });

  it("never treats a Funnel request as open", () => {
    expect(via({ loopback: true, forwarded: true, funnel: true })).toBe("refused:pairing_required");
    expect(via({ loopback: true, forwarded: true, funnel: true, device })).toBe("device");
  });

  it("trusts the PC's own Tailscale login only from the local tailscaled", () => {
    expect(via({ forwarded: true, tailscaleLogin: "me@example.com", owner: "me@example.com" })).toBe("tailscale");
    expect(via({ forwarded: true, tailscaleLogin: "Me@Example.com", owner: "me@example.com" })).toBe("tailscale");
    expect(via({ forwarded: true, tailscaleLogin: "them@example.com", owner: "me@example.com", gated: true })).toBe("refused:other_user");
    expect(via({ forwarded: true, tailscaleLogin: "them@example.com", owner: "me@example.com" })).toBe("refused:other_user");
    // a LAN client can type any header: from off this machine it means nothing
    expect(via({ loopback: false, tailscaleLogin: "me@example.com", owner: "me@example.com", gated: true })).toBe("refused:pairing_required");
    // no login from tailscale serve is a tagged node, not a person: it pairs like any other device
    expect(via({ forwarded: true, owner: "me@example.com" })).toBe("refused:pairing_required");
    expect(via({ forwarded: true, owner: "me@example.com", device })).toBe("device");
    // no owner known yet: the header decides nothing either way
    expect(via({ forwarded: true, tailscaleLogin: "me@example.com", owner: null })).toBe("open");
  });

  it("asks a tagged PC's visitors to pair, its owner included, and never calls them another user", () => {
    // the node names no person: there is no login to match, and none to be a stranger to
    expect(via({ forwarded: true, tagged: true, tailscaleLogin: "me@example.com" })).toBe("refused:pairing_required");
    expect(via({ forwarded: true, tagged: true })).toBe("refused:pairing_required");
    expect(via({ forwarded: true, tagged: true, tailscaleLogin: "me@example.com", tokenConfigured: true })).toBe("refused:token_required");
    expect(via({ forwarded: true, tagged: true, tailscaleLogin: "me@example.com", device })).toBe("device");
    // a login header alone marks a proxy: with no owner to refuse it against, it must not pass for this PC
    expect(cameThroughProxy(new Headers({ host: "localhost:7317", "tailscale-user-login": "them@example.com" }))).toBe(true);
    // a login named for the PC lets that person in as on any other node
    expect(via({ forwarded: true, tailscaleLogin: "me@example.com", owner: "me@example.com" })).toBe("tailscale");
  });

  it("a configured token gates everything but a paired device, this PC and its Tailscale login included", () => {
    expect(via({ tokenConfigured: true })).toBe("refused:token_required");
    expect(via({ tokenConfigured: true, tokenMatched: true })).toBe("token");
    expect(via({ tokenConfigured: true, device })).toBe("device");
    // any proxy on this PC can pass a visitor's copy of the login header on: a token holds against it
    expect(via({ tokenConfigured: true, forwarded: true, tailscaleLogin: "me@example.com", owner: "me@example.com" })).toBe("refused:token_required");
    expect(via({ tokenConfigured: true, forwarded: true, tailscaleLogin: "them@example.com", owner: "me@example.com" })).toBe("refused:token_required");
    expect(via({ tokenConfigured: true, tokenMatched: true, forwarded: true, tailscaleLogin: "me@example.com", owner: "me@example.com" })).toBe("token");
    expect(via({ tokenConfigured: true, device, forwarded: true, tailscaleLogin: "me@example.com", owner: "me@example.com" })).toBe("device");
  });

  it("a paired device gets in from anywhere, with its role", () => {
    const access = decideAccess({ ...base, loopback: false, gated: true, device: { ...device, role: "watch" } });
    expect(access).toEqual({ level: "full", via: "device", role: "watch", device: { ...device, role: "watch" } });
  });

  it("knows a name for this machine from a proxied Host", () => {
    for (const host of ["localhost", "localhost:7317", "LOCALHOST:5173", "herdr.localhost:7317", "127.0.0.1:7317", "127.9.9.9", "[::1]:7317", "localhost.:7317", "[::ffff:127.0.0.1]:7317"]) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ["app.example.test", "app.example.test:8443", "192.168.0.10:7317", "localhost.example.test", "127.0.0.1.example.test", "[fd7a::1]:7317", "", "0.0.0.0:7317", "[::ffff:192.168.0.10]"]) expect(isLoopbackHost(host)).toBe(false);
    // not an authority: a URL parser would have read these as localhost
    for (const host of ["public.example@localhost:7317", "localhost/x@public.example", "localhost:7317/x", "localhost?x", "local host", "localhost:port", "localhost..", "127.0.0.1@public.example"]) expect(isLoopbackHost(host)).toBe(false);
  });

  it("sees a proxy in a forwarding header or in a Host that is not this machine", () => {
    const proxy = (headers: Record<string, string>) => cameThroughProxy(new Headers(headers));
    expect(proxy({ host: "localhost:7317" })).toBe(false);
    expect(proxy({ host: "127.0.0.1:7317", origin: "http://127.0.0.1:7317" })).toBe(false);
    // no Host at all: HTTP/1.0 through a proxy, never a local browser or CLI
    expect(proxy({})).toBe(true);
    expect(proxy({ host: "public.example@localhost:7317" })).toBe(true);
    expect(proxy({ host: "app.example.test" })).toBe(true);
    for (const name of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded", "via"]) expect(proxy({ host: "127.0.0.1:7317", [name]: "x" })).toBe(true);
  });

  it("knows loopback addresses in every spelling", () => {
    for (const address of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"]) expect(isLoopbackAddress(address)).toBe(true);
    for (const address of ["192.168.0.10", "100.64.0.2", "::ffff:192.168.0.10", "fd7a::1"]) expect(isLoopbackAddress(address)).toBe(false);
  });
});

describe("a server booted with defaults", () => {
  it("refuses an anonymous loopback request, serves the local token and the owner's Tailscale login, and keeps /api/health open", async () => {
    // test-herdr.ts sets HERDR_WEB_TRUST_LOCAL=1 for its own servers: the defaults are read from a clean env here
    const keys = ["HERDR_WEB_TRUST_LOCAL", "HERDR_WEB_TOKEN", "HERDR_WEB_TAILSCALE_OWNER"] as const;
    const saved = keys.map((key) => [key, process.env[key]] as const);
    for (const key of keys) delete process.env[key];
    const stateDir = mkdtempSync(join(tmpdir(), "herdr-access-boot-"));
    const { createServer } = await import("./index.ts");
    const server = createServer({ port: 0, stateDir, tailscaleOwner: "me@example.com" });
    const base = `http://127.0.0.1:${server.port}`;
    const login = { "tailscale-user-login": "me@example.com", "x-forwarded-for": "100.64.0.1" };
    try {
      const token = readFileSync(join(stateDir, LOCAL_TOKEN_FILE), "utf8").trim();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      // /api/session is gated and needs no herdr to be refused
      const anonymous = await fetch(`${base}/api/session`);
      expect(anonymous.status).toBe(401);
      const withToken = await fetch(`${base}/api/session`, { headers: { authorization: `Bearer ${token}` } });
      expect([401, 403]).not.toContain(withToken.status);
      const wrongToken = await fetch(`${base}/api/session`, { headers: { authorization: "Bearer nope" } });
      expect(wrongToken.status).toBe(401);
      // the documented owner login: in without the local token; another login is refused outright
      const owner = await fetch(`${base}/api/session`, { headers: login });
      expect([401, 403]).not.toContain(owner.status);
      const other = await fetch(`${base}/api/session`, { headers: { ...login, "tailscale-user-login": "them@example.com" } });
      expect(other.status).toBe(403);
      // an anonymous proxied request (a tagged tailnet peer) pairs
      const peer = await fetch(`${base}/api/session`, { headers: { "x-forwarded-for": "100.64.0.1" } });
      expect(peer.status).toBe(401);
      // /api/health is open on purpose (server/auth.ts requiresAuth): it tells a client the gate and why
      const health = await (await fetch(`${base}/api/health?scope=bridge`)).json() as { auth: { required: boolean; authenticated: boolean; reason?: string } };
      expect(health.auth).toEqual({ required: true, authenticated: false, reason: "token_required" });
      const ownerHealth = await (await fetch(`${base}/api/health?scope=bridge`, { headers: login })).json() as { auth: { required: boolean; via?: string } };
      expect(ownerHealth.auth.required).toBe(false);
      expect(ownerHealth.auth.via).toBe("tailscale");
    } finally {
      server.stop();
      for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
