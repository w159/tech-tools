// Shared env preloader for atlas MCP servers, loaded via `node --import`.
// stdout is reserved for JSON-RPC; all diagnostics go to stderr only.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Default path is a convention, not a secret: a per-user KEY=VALUE file the
// operator creates (recommended `chmod 600`) so every vendor MCP server picks
// up credentials even when the launching harness doesn't resolve plugin
// `userConfig` / `${user_config.*}` substitution, or when `ATLAS_ENV_FILE`
// points at a plugin-root `.env` that doesn't exist for a cache-installed
// plugin (`${CLAUDE_PLUGIN_ROOT}/.env` is empty/absent there).
const DEFAULT_ATLAS_ENV_FILE = join(homedir(), ".config", "atlas", "atlas.env");

// Shared by both the direct file loader and the CFG_ promotion loop below.
const UNEXPANDED = /^\$\{.*\}$/;

const QUOTED = /^(["'])(.*)\1$/;

// One KEY=VALUE line -> [key, value], or null for blanks, comments and
// lines without "=". Matching surrounding quotes are stripped.
function parseEnvLine(line) {
  const trimmed = line.trim();
  const eq = trimmed.indexOf("=");
  if (!trimmed || trimmed.startsWith("#") || eq === -1) return null;
  const raw = trimmed.slice(eq + 1).trim();
  return [trimmed.slice(0, eq).trim(), raw.replace(QUOTED, "$2")];
}

// Never let a blank `KEY=` line (the `.env.example` convention - a
// commented-out template uncommented but never filled in) or a literal
// unexpanded `${...}` placeholder stomp an already-set value (e.g. one
// exported by the launching shell) - both only fill a gap.
const isUsable = (value) => Boolean(value) && !UNEXPANDED.test(value);

function readEnvLines(path) {
  if (!path || !existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8").split("\n");
  } catch (err) {
    console.error(`[atlas env] failed to load ${path}: ${err.message}`);
    return [];
  }
}

const isUsableEntry = (entry) => entry !== null && Boolean(entry[0]) && isUsable(entry[1]);

function loadEnvFile(path) {
  for (const [key, value] of readEnvLines(path).map(parseEnvLine).filter(isUsableEntry)) {
    process.env[key] = value;
  }
}

// 1. Load the per-user default file first as a harness-agnostic baseline.
loadEnvFile(DEFAULT_ATLAS_ENV_FILE);
// 2. Load ATLAS_ENV_FILE when explicitly set, overriding the baseline above -
// this stays the documented, higher-precedence path (e.g. a repo checkout's
// `plugins/atlas/.env`).
if (process.env.ATLAS_ENV_FILE) loadEnvFile(process.env.ATLAS_ENV_FILE);

// 3. Fall back to CFG_<NAME> (from ${user_config.*}) when <NAME> is unset.
for (const key of Object.keys(process.env)) {
  if (!key.startsWith("CFG_")) continue;
  const name = key.slice(4);
  const value = process.env[key];
  if (process.env[name] === undefined && isUsable(value)) {
    process.env[name] = value;
  }
}
