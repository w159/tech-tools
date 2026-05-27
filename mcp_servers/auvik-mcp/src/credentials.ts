import { AsyncLocalStorage } from 'node:async_hooks';

// Strip unresolved MCP host template placeholders (e.g. "${user_config.x}")
// and whitespace-only values so optional env vars fall through to their defaults.
const isUnresolvedPlaceholder = (v: string | undefined): boolean =>
  !!v && /^\$\{[^}]+\}$/.test(v.trim());
const cleanEnv = (v: string | undefined): string =>
  !v || isUnresolvedPlaceholder(v) ? '' : v.trim();

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
    region: cleanEnv(process.env.AUVIK_REGION) || undefined,
  };
}