import { TypeSafeClient } from 'node-typesafe';
import type { ProviderSetting } from 'node-typesafe';
import { logger } from './logger.js';

let _client: TypeSafeClient | null = null;
let _credKey: string | null = null;

// Strip unresolved MCP host template placeholders (e.g. "${user_config.x}")
// and whitespace-only values so optional env vars fall through to their defaults.
const isUnresolvedPlaceholder = (v: string | undefined): boolean =>
  !!v && /^\$\{[^}]+\}$/.test(v.trim());
export const cleanEnv = (v: string | undefined): string =>
  !v || isUnresolvedPlaceholder(v) ? '' : v.trim();

export interface EnvCredentials {
  typesafeApiKey: string;
  typesafeBaseUrl: string;
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  openrouterHttpReferer: string;
  openrouterXTitle: string;
  openrouterMaxTokens: string;
  provider: string;
  model: string;
}

/** Read the TypeSafe/OpenRouter env vars, stripping unresolved MCP placeholders. */
export function readEnv(): EnvCredentials {
  return {
    typesafeApiKey: cleanEnv(process.env.TYPESAFE_API_KEY),
    typesafeBaseUrl: cleanEnv(process.env.TYPESAFE_BASE_URL),
    openrouterApiKey: cleanEnv(process.env.OPENROUTER_API_KEY),
    openrouterBaseUrl: cleanEnv(process.env.OPENROUTER_BASE_URL),
    openrouterHttpReferer: cleanEnv(process.env.OPENROUTER_HTTP_REFERER),
    openrouterXTitle: cleanEnv(process.env.OPENROUTER_X_TITLE),
    openrouterMaxTokens: cleanEnv(process.env.OPENROUTER_MAX_TOKENS),
    provider: cleanEnv(process.env.TYPESAFE_PROVIDER),
    model: cleanEnv(process.env.TYPESAFE_MODEL),
  };
}

function isProviderSetting(v: string): v is ProviderSetting {
  return v === 'typesafe' || v === 'openrouter' || v === 'auto';
}

export function clientConfigFromEnv(env: EnvCredentials) {
  return {
    typesafeApiKey: env.typesafeApiKey || undefined,
    typesafeBaseUrl: env.typesafeBaseUrl || undefined,
    openrouterApiKey: env.openrouterApiKey || undefined,
    openrouterBaseUrl: env.openrouterBaseUrl || undefined,
    openrouterHttpReferer: env.openrouterHttpReferer || undefined,
    openrouterXTitle: env.openrouterXTitle || undefined,
    openrouterMaxTokens: env.openrouterMaxTokens ? Number(env.openrouterMaxTokens) : undefined,
    provider: isProviderSetting(env.provider) ? env.provider : 'auto' as const,
    model: env.model || undefined,
  };
}

export function resetClient(): void {
  _client = null;
  _credKey = null;
  logger.debug('Reset TypeSafe client');
}

/**
 * Memoized client, rebuilt only when the resolved env changes. Never throws
 * on construction - MISSING_CREDENTIALS is a resolveProvider()-time failure,
 * raised the moment a tool actually needs the provider (typesafe_decide,
 * typesafe_list_models). typesafe_status never calls this: it constructs its
 * own client directly so it can report "not configured" instead of throwing.
 */
export function getClient(): TypeSafeClient {
  const env = readEnv();
  const key = JSON.stringify(env);
  if (_client && _credKey === key) return _client;

  _client = new TypeSafeClient(clientConfigFromEnv(env));
  _credKey = key;
  logger.info('Created TypeSafe client', { provider: env.provider || 'auto' });
  return _client;
}
