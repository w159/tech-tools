#!/usr/bin/env node
// Generates catalog/catalog.json from plugins/armada/.mcp.json plus
// catalog/overrides.json, so a connector added to armada reaches the gateway
// without a gateway code change.
//
//   node scripts/gen-catalog.mjs           write catalog/catalog.json
//   node scripts/gen-catalog.mjs --check   exit 1 if catalog.json is stale
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const gatewayDir = join(here, "..");
const repoRoot = join(gatewayDir, "..", "..");
const manifestPath = join(repoRoot, "plugins", "armada", ".mcp.json");
const overridesPath = join(gatewayDir, "catalog", "overrides.json");
const outPath = join(gatewayDir, "catalog", "catalog.json");

const PLUGIN_MCP = "${CLAUDE_PLUGIN_ROOT}/mcp";
const ENV_LOADER = /\/_env\/load\.(mjs|py)$/;

// Longest "_"-terminated prefix shared by every variable name, e.g.
// CW_MANAGE_URL + CW_MANAGE_CLIENT_ID -> CW_MANAGE_.
function commonPrefix(names) {
  if (names.length === 0) return undefined;
  let prefix = names[0];
  for (const n of names) while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1);
  const cut = prefix.lastIndexOf("_");
  return cut > 0 ? prefix.slice(0, cut + 1) : undefined;
}

export function buildCatalog(manifest, overrides) {
  const servers = manifest.mcpServers ?? manifest;
  const connectors = [];
  for (const [id, server] of Object.entries(servers).sort(([a], [b]) => a.localeCompare(b))) {
    const o = overrides[id] ?? {};
    // CFG_* are Claude Code user_config bridges; the vendor server reads the
    // name without the CFG_ prefix. The gateway injects the real names.
    const vendorVars = Object.keys(server.env ?? {})
      .filter((k) => k.startsWith("CFG_"))
      .map((k) => k.slice(4));
    const prefix = commonPrefix(vendorVars);
    if (!prefix) throw new Error(`${id}: cannot derive an env prefix from ${JSON.stringify(vendorVars)}`);

    let command = o.command;
    let args = o.args;
    if (command === undefined) {
      if (server.command !== "node") throw new Error(`${id}: non-node command "${server.command}" needs a command override`);
      command = "node";
      // Drop "--import .../_env/load.mjs": the gateway passes env directly.
      const raw = [...server.args];
      args = [];
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === "--import" && ENV_LOADER.test(raw[i + 1] ?? "")) { i++; continue; }
        args.push(raw[i].replace(PLUGIN_MCP, "${BACKENDS_ROOT}"));
      }
    }
    connectors.push({
      id,
      compatRole: o.compatRole ?? id[0].toUpperCase() + id.slice(1),
      command,
      args,
      envPrefixes: [prefix],
      stateful: o.stateful === true,
    });
  }
  return { version: 1, source: "plugins/armada/.mcp.json", connectors };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const overrides = JSON.parse(readFileSync(overridesPath, "utf8"));
  delete overrides._comment;
  const next = JSON.stringify(buildCatalog(manifest, overrides), null, 2) + "\n";
  if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(outPath, "utf8"); } catch {}
    if (current !== next) {
      console.error("catalog/catalog.json is stale: run node scripts/gen-catalog.mjs");
      process.exit(1);
    }
    console.log("catalog/catalog.json is current");
  } else {
    writeFileSync(outPath, next);
    console.log(`wrote ${outPath} (${JSON.parse(next).connectors.length} connectors)`);
  }
}
