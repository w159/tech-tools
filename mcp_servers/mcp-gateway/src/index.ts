#!/usr/bin/env node
/**
 * MCP gateway
 *
 * One remote MCP endpoint (Streamable HTTP, stateless) in front of many
 * vendor MCP servers, each spawned as a stdio child. This process is an OAuth
 * 2.1 resource server: it serves RFC 9728 Protected Resource Metadata,
 * validates access tokens, maps token claims to gateway roles, and applies a
 * default-deny policy per connector and per effect class (read, write,
 * destructive) before proxying a call. Every decision is written as one JSON
 * audit line on stdout, never with tool arguments or results.
 *
 * Two modes. Direct: the customer's IdP issues the access tokens and this
 * process only validates them. Broker: this process is also an OAuth 2.1
 * authorization server (oidc-provider) that federates sign-in to one upstream
 * OIDC IdP, accepts IdP-signed identity assertions (jwt-bearer grant), and
 * issues its own short-lived JWT access tokens. See src/config.ts for the
 * environment variables.
 */
import { AuditLogger } from "./audit.js";
import { Backend, BackendPool, isInstalled, loadCatalog } from "./backends.js";
import { loadConfig } from "./config.js";
import { Gateway } from "./gateway.js";
import { createHttpServer } from "./http.js";
import { buildAuthRuntime, buildPolicy } from "./runtime.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  const catalog = loadCatalog(config.catalogFile, config.backendsRoot);
  const enabled = config.enabledBackends ? new Set(config.enabledBackends) : undefined;
  const unknown = [...(enabled ?? [])].filter((id) => !catalog.some((s) => s.id === id));
  if (unknown.length > 0) throw new Error(`ENABLED_BACKENDS names unknown connectors: ${unknown.join(", ")}`);
  // Default is every installed entry, so a partial deploy (no falcon venv
  // synced) does not crash the whole gateway.
  const specs = catalog.filter((s) => (enabled ? enabled.has(s.id) : isInstalled(s)));
  if (specs.length === 0) console.error("[mcp-gateway] no enabled backends - check ENABLED_BACKENDS / BACKENDS_ROOT");

  const pool = new BackendPool(specs, (spec) => new Backend(spec), {
    idleMs: config.statefulIdleMs,
    maxPerUserChildren: config.statefulMaxChildren,
  });
  const policy = buildPolicy(config, specs);
  const audit = new AuditLogger({ hmacKey: config.auditHmacKey });
  if (audit.ephemeralKey) {
    console.error("[mcp-gateway] AUDIT_HMAC_KEY not set: args_hmac uses a per-process key and is not comparable across restarts");
  }

  const gateway = new Gateway(pool, policy, audit);
  await gateway.init();

  const auth = buildAuthRuntime(config, policy, audit);
  const httpServer = createHttpServer({
    config,
    gateway,
    verify: auth.verify,
    audit,
    health: () => ({ status: "ok", backends: specs.map((s) => s.id) }),
    prm: auth.prm,
    wwwAuthenticateScope: auth.wwwAuthenticateScope,
    fallback: auth.fallback,
  });

  const reaper = setInterval(() => void pool.reapIdle().catch(() => undefined), 60_000);
  reaper.unref();

  await new Promise<void>((resolve) => {
    httpServer.listen(config.port, config.host, () => {
      console.error(`[mcp-gateway] listening on http://${config.host}:${config.port}/mcp`);
      console.error(`[mcp-gateway] backends: ${specs.map((s) => s.id).join(", ") || "(none)"}`);
      resolve();
    });
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.error(`[mcp-gateway] ${signal} received, shutting down`);
    httpServer.close();
    auth.close?.();
    await pool.closeAll();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[mcp-gateway] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
