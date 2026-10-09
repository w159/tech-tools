import { existsSync } from "node:fs";
import { BACKEND_CATALOG } from "./backends.js";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GatewayConfig {
  readonly entraTenantId: string;
  readonly entraClientId: string;
  readonly mcpResourceUrl: string;
  readonly port: number;
  readonly host: string;
  readonly backendsRoot: string;
  readonly enabledBackends: readonly string[];
}

function canonicalizeResourceUrl(raw: string): string {
  const url = new URL(raw);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  const canonical = url.toString();
  return canonical.endsWith("/") ? canonical.slice(0, -1) : canonical;
}

// Defaults ENABLED_BACKENDS to every catalog entry whose entrypoint exists on
// disk under BACKENDS_ROOT, so a partial deploy (e.g. no falcon venv synced)
// does not crash the whole gateway at startup.
function defaultEnabledBackends(backendsRoot: string): string[] {
  return BACKEND_CATALOG.filter((spec) => existsSync(spec.command(backendsRoot).command)).map((spec) => spec.id);
}

export function loadConfig(env: NodeJS.ProcessEnv): GatewayConfig {
  const missing: string[] = [];

  const entraTenantId = env.ENTRA_TENANT_ID;
  if (!entraTenantId) missing.push("ENTRA_TENANT_ID");
  else if (!GUID_RE.test(entraTenantId)) missing.push("ENTRA_TENANT_ID (not a GUID)");

  const entraClientId = env.ENTRA_CLIENT_ID;
  if (!entraClientId) missing.push("ENTRA_CLIENT_ID");
  else if (!GUID_RE.test(entraClientId)) missing.push("ENTRA_CLIENT_ID (not a GUID)");

  const mcpResourceUrlRaw = env.MCP_RESOURCE_URL;
  if (!mcpResourceUrlRaw) missing.push("MCP_RESOURCE_URL");

  if (missing.length > 0) {
    throw new Error(`mcp-gateway: missing/invalid required env vars: ${missing.join(", ")}`);
  }

  const backendsRoot = env.BACKENDS_ROOT ?? "/app/mcp";
  const enabledBackends = env.ENABLED_BACKENDS
    ? env.ENABLED_BACKENDS.split(",").map((s) => s.trim()).filter(Boolean)
    : defaultEnabledBackends(backendsRoot);

  return Object.freeze({
    entraTenantId: entraTenantId!,
    entraClientId: entraClientId!,
    mcpResourceUrl: canonicalizeResourceUrl(mcpResourceUrlRaw!),
    port: env.PORT ? parseInt(env.PORT, 10) : 8080,
    host: env.HOST ?? "0.0.0.0",
    backendsRoot,
    enabledBackends: Object.freeze(enabledBackends),
  });
}
