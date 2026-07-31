// Shared env preloader for atlas MCP servers, loaded via `node --import`.
// stdout is reserved for JSON-RPC; all diagnostics go to stderr only.
import { existsSync, readFileSync } from "node:fs";

const envFile = process.env.ATLAS_ENV_FILE;

// 1. Load ATLAS_ENV_FILE (KEY=VALUE per line), overriding existing env.
if (envFile && existsSync(envFile)) {
  try {
    const lines = readFileSync(envFile, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) process.env[key] = value;
    }
  } catch (err) {
    console.error(`[atlas env] failed to load ${envFile}: ${err.message}`);
  }
}

// 2. Fall back to CFG_<NAME> (from ${user_config.*}) when <NAME> is unset.
const unexpanded = /^\$\{.*\}$/;
for (const key of Object.keys(process.env)) {
  if (!key.startsWith("CFG_")) continue;
  const name = key.slice(4);
  const value = process.env[key];
  if (process.env[name] === undefined && value && !unexpanded.test(value)) {
    process.env[name] = value;
  }
}
