#!/usr/bin/env node
/**
 * Henssler Financial MCP gateway
 *
 * One public remote MCP endpoint (Streamable HTTP, stateless) for use as a
 * Claude Enterprise custom connector. Microsoft Entra ID is the authorization
 * server directly (cross-host AS); this process is only a resource server -
 * it serves RFC 9728 Protected Resource Metadata and validates Entra access
 * tokens, then fans requests out to vendor MCP servers spawned as stdio
 * children, one per enabled backend, aggregated and role-gated per vendor.
 *
 * See src/config.ts for the required/optional environment variables.
 */
import { BACKEND_CATALOG, Backend } from "./backends.js";
import { loadConfig } from "./config.js";
import { createJwks } from "./auth.js";
import { Gateway } from "./gateway.js";
import { createHttpServer } from "./http.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const enabled = new Set(config.enabledBackends);
  const specs = BACKEND_CATALOG.filter((spec) => enabled.has(spec.id));

  if (specs.length === 0) {
    console.error("[mcp-gateway] no enabled backends - check ENABLED_BACKENDS / BACKENDS_ROOT");
  }

  const backends = specs.map((spec) => new Backend(spec, config.backendsRoot));
  const gateway = new Gateway(backends);
  const keyResolver = createJwks(config.entraTenantId);

  const httpServer = createHttpServer(config, gateway, keyResolver, specs.map((s) => s.id));

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
    await Promise.all(backends.map((b) => b.close()));
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[mcp-gateway] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
