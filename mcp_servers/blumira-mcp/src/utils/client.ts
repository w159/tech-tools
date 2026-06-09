import { BlumiraClient } from 'node-blumira';
import { logger } from './logger.js';
import { resolveBaseUrl } from '../domains/_helpers.js';

// Strip unresolved MCP host template placeholders (e.g. "${user_config.x}")
// and whitespace-only values so optional env vars fall through to their defaults.
const isUnresolvedPlaceholder = (v: string | undefined): boolean =>
  !!v && /^\$\{[^}]+\}$/.test(v.trim());
const cleanEnv = (v: string | undefined): string =>
  !v || isUnresolvedPlaceholder(v) ? '' : v.trim();

let _client: BlumiraClient | null = null;
let _credKey: string | null = null;

// --- OAuth2 token cache ---
interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<string, CachedToken>();

/**
 * Exchange client_id + client_secret for a JWT via Blumira's OAuth endpoint.
 * Caches the token until 60 seconds before expiry.
 */
export async function exchangeOAuthToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cacheKey = `${clientId}:${clientSecret}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt) {
    return cached.accessToken;
  }

  logger.info('Exchanging OAuth2 client credentials for JWT');

  const res = await fetch('https://auth.blumira.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience: 'https://api.blumira.com/public-api/v1',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiresIn = data.expires_in || 3600;

  // Cache with 60-second buffer before actual expiry
  tokenCache.set(cacheKey, {
    accessToken: data.access_token,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
  });

  logger.info('OAuth token exchange successful', { expiresIn });
  return data.access_token;
}

// ---- Credentials resolution ----

interface Credentials {
  jwtToken: string;
}

/**
 * Resolve credentials in priority order:
 * 1. Direct JWT token (BLUMIRA_JWT_TOKEN)
 * 2. OAuth client credentials (BLUMIRA_CLIENT_ID + BLUMIRA_CLIENT_SECRET) — performs exchange
 */
export function getCredentials(): Credentials | null {
  const jwtToken = cleanEnv(process.env.BLUMIRA_JWT_TOKEN);
  if (jwtToken) {
    return { jwtToken };
  }

  // If client_id + client_secret are set, we can obtain a token —
  // but the exchange is async, so we signal "credentials available" and
  // the actual exchange happens in getClient().
  const clientId = cleanEnv(process.env.BLUMIRA_CLIENT_ID);
  const clientSecret = cleanEnv(process.env.BLUMIRA_CLIENT_SECRET);
  if (clientId && clientSecret) {
    // Return a sentinel so health checks know we have credentials configured.
    // The real token will be fetched in getClient().
    return { jwtToken: '__oauth_pending__' };
  }

  logger.warn('Missing credentials', { hasJwtToken: false, hasClientId: !!clientId });
  return null;
}

export async function getClient(): Promise<BlumiraClient> {
  // Resolve base URL — optional env var, falls back to the node-blumira library default.
  const baseUrl = resolveBaseUrl('blumira', cleanEnv(process.env.BLUMIRA_BASE_URL));

  // Direct JWT path
  const jwtToken = cleanEnv(process.env.BLUMIRA_JWT_TOKEN);
  if (jwtToken) {
    const credKey = `jwt:${jwtToken}:${baseUrl}`;
    if (_client && _credKey === credKey) return _client;
    _client = new BlumiraClient({ jwtToken, ...(baseUrl ? { baseUrl } : {}) });
    _credKey = credKey;
    logger.info('Created Blumira API client (JWT)');
    return _client;
  }

  // OAuth client credentials path
  const clientId = cleanEnv(process.env.BLUMIRA_CLIENT_ID);
  const clientSecret = cleanEnv(process.env.BLUMIRA_CLIENT_SECRET);
  if (clientId && clientSecret) {
    const token = await exchangeOAuthToken(clientId, clientSecret);
    const credKey = `oauth:${clientId}:${token}:${baseUrl}`;
    if (_client && _credKey === credKey) return _client;
    _client = new BlumiraClient({ jwtToken: token, ...(baseUrl ? { baseUrl } : {}) });
    _credKey = credKey;
    logger.info('Created Blumira API client (OAuth)');
    return _client;
  }

  throw new Error(
    'No Blumira credentials configured. Set BLUMIRA_JWT_TOKEN or BLUMIRA_CLIENT_ID + BLUMIRA_CLIENT_SECRET.',
  );
}
