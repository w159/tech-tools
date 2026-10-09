// Shared env preloader for atlas MCP servers, loaded via `node --import`.
// stdout is reserved for JSON-RPC; all diagnostics go to stderr only.
import { existsSync, readFileSync, statSync } from "node:fs";
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

// Precedence (highest first): variables exported by the launching shell, then
// ATLAS_ENV_FILE, then the per-user default file, then CFG_<NAME> (userConfig)
// filling any remaining gap. Blank `KEY=` lines (the `.env.example` convention)
// and literal unexpanded `${...}` placeholders never count as a value.
const isUsable = (value) => Boolean(value) && !UNEXPANDED.test(value);

// Names only, never values: stderr is the one place a diagnostic may go.
const note = (msg) => console.error(`[atlas env] ${msg}`);

const shellKeys = new Set(Object.keys(process.env).filter((k) => isUsable(process.env[k])));

function loadEnvFile(path, label) {
  if (!path) return;
  if (!existsSync(path)) {
    note(`${label} not found: ${path} (skipped)`);
    return;
  }
  let text;
  try {
    if (statSync(path).mode & 0o077) note(`${path} is group/world-readable; run chmod 600`);
    text = readFileSync(path, "utf8");
  } catch (err) {
    note(`failed to load ${path}: ${err.message}`);
    return;
  }
  for (const entry of text.split("\n").map(parseEnvLine)) {
    if (entry === null || !entry[0] || !isUsable(entry[1])) continue;
    const [key, value] = entry;
    if (shellKeys.has(key)) {
      if (process.env[key] !== value) note(`${key}: shell export wins over ${path}`);
      continue;
    }
    process.env[key] = value;
  }
}

// 1. Per-user default file: harness-agnostic baseline.
loadEnvFile(DEFAULT_ATLAS_ENV_FILE, "default env file");
// 2. ATLAS_ENV_FILE when explicitly set overrides the baseline file (never the shell).
if (process.env.ATLAS_ENV_FILE) loadEnvFile(process.env.ATLAS_ENV_FILE, "ATLAS_ENV_FILE");

// Helper for step 3: omp doesn't expand ${user_config.*}; read the same saved options Claude Code
// would have used. In memory only (never written/logged); fails soft.
const PLACEHOLDER = /^\$\{user_config\.([^}]+)\}$/;
// Exact `atlas@<marketplace>` key only: name from this repo's marketplace.json, else the literal default.
function marketplaceName() {
  try {
    const name = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "..", ".claude-plugin", "marketplace.json"), "utf8")).name;
    if (typeof name === "string" && name) return name;
  } catch {
    // cache install has no repo marketplace.json
  }
  return "tech-tools";
}
let savedOptions;
function savedOption(opt) {
  if (savedOptions === undefined) {
    savedOptions = {};
    try {
      const cfg = JSON.parse(readFileSync(join(homedir(), ".claude", "settings.json"), "utf8")).pluginConfigs;
      savedOptions = cfg?.[`atlas@${marketplaceName()}`]?.options || {};
    } catch {
      // missing/unreadable/invalid settings: behaviour unchanged
    }
  }
  const v = savedOptions[opt];
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "";
}

// 3. Fall back to CFG_<NAME> (from ${user_config.*}, else saved pluginConfigs) when <NAME> is unset.
for (const key of Object.keys(process.env)) {
  if (!key.startsWith("CFG_")) continue;
  const name = key.slice(4);
  let value = process.env[key];
  const ph = PLACEHOLDER.exec(value);
  if (ph && process.env[name] === undefined) value = savedOption(ph[1]);
  if (!isUsable(value)) {
    if (ph && process.env[name] === undefined) note(`${name}: unresolved; set ${name} in ~/.config/atlas/atlas.env (chmod 600)`);
    continue;
  }
  if (process.env[name] === undefined) process.env[name] = value;
  else if (process.env[name] !== value && !shellKeys.has(name)) {
    note(`${name}: env file value wins over saved userConfig (${key}); update or remove the file entry`);
  }
}
