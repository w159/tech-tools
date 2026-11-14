import { AsyncLocalStorage } from 'node:async_hooks';

// Strip unresolved MCP host template placeholders (e.g. "${user_config.x}")
// and whitespace-only values so optional env vars fall through to their defaults.
const isUnresolvedPlaceholder = (v: string | undefined): boolean =>
  !!v && /^\$\{[^}]+\}$/.test(v.trim());
const cleanEnv = (v: string | undefined): string =>
  !v || isUnresolvedPlaceholder(v) ? '' : v.trim();

// Auvik API shards (https://auvikapi.<region>.my.auvik.com/v1), per the shard
// list on status.auvik.com. The region is interpolated into the API host that
// receives the Basic-auth header, so anything else is refused, never used.
export const DEFAULT_REGION = 'us1';
const AUVIK_REGION = /^(us[1-6]|eu[12]|au1|ca1)$/;

export function isValidRegion(region: string): boolean {
  return AUVIK_REGION.test(region);
}

/**
 * The region to use: a valid shard as given, else the default. An invalid value
 * is reported on stderr by source name only (never echoed: stdout is JSON-RPC).
 */
export function resolveRegion(raw: string | undefined, source = 'AUVIK_REGION'): string {
  const region = cleanEnv(raw);
  if (!region) return DEFAULT_REGION;
  if (isValidRegion(region)) return region;
  console.error(
    `[auvik] ${source} is not a known Auvik region (us1-us6, eu1, eu2, au1, ca1); using ${DEFAULT_REGION}`
  );
  return DEFAULT_REGION;
}

export interface AuvikCredentials {
  username: string;
  apiKey: string;
  region?: string;
}

// AsyncLocalStorage for per-request credentials (gateway mode)
export const credentialsStorage = new AsyncLocalStorage<AuvikCredentials>();

export function getCredentials(): AuvikCredentials | null {
  // First try AsyncLocalStorage (gateway mode)
  const asyncCreds = credentialsStorage.getStore();
  if (asyncCreds) {
    return asyncCreds;
  }

  // Fall back to environment variables (single-tenant mode)
  const username = cleanEnv(process.env.AUVIK_USERNAME);
  const apiKey = cleanEnv(process.env.AUVIK_API_KEY);

  if (!username || !apiKey) {
    return null;
  }

  return {
    username,
    apiKey,
    region: resolveRegion(process.env.AUVIK_REGION),
  };
}