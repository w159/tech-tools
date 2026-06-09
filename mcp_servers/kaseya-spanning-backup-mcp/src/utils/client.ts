import { SpanningClient, type SpanningPlatform } from 'node-spanning';
import { logger } from './logger.js';

// Strip unresolved MCP host template placeholders (e.g. "${user_config.x}")
// and whitespace-only values so optional env vars fall through to their defaults.
const isUnresolvedPlaceholder = (v: string | undefined): boolean =>
  !!v && /^\$\{[^}]+\}$/.test(v.trim());
const cleanEnv = (v: string | undefined): string =>
  !v || isUnresolvedPlaceholder(v) ? '' : v.trim();

// Per-platform default base URLs (from docs/vendors/spanning/README.md).
// SPANNING_API_URL is optional — leave blank to use the platform default.
const PLATFORM_DEFAULTS: Record<string, string> = {
  m365:       'https://o365-api.spanningbackup.com/external',
  gws:        'https://api.spanningbackup.com/external',
  salesforce: 'https://salesforce-api.spanningbackup.com',
};

export interface Credentials {
  adminEmail: string;
  apiToken:   string;
  platform:   SpanningPlatform;
  /** Resolved effective base URL (platform default unless SPANNING_API_URL overrides). */
  apiUrl:     string;
  /** True when SPANNING_API_URL was explicitly set by the operator. */
  apiUrlIsOverride: boolean;
}

let _client:  SpanningClient | null = null;
let _credKey: string | null = null;

function normalizePlatform(raw: string | undefined): SpanningPlatform {
  const v = (raw || 'm365').toLowerCase();
  if (v === 'm365' || v === 'gws' || v === 'salesforce') return v;
  return 'm365';
}

export function getCredentials(): Credentials | null {
  const adminEmail    = cleanEnv(process.env.SPANNING_ADMIN_EMAIL);
  const apiToken      = cleanEnv(process.env.SPANNING_API_TOKEN);
  if (!adminEmail || !apiToken) {
    logger.warn('Missing SPANNING_ADMIN_EMAIL or SPANNING_API_TOKEN');
    return null;
  }
  const platform         = normalizePlatform(cleanEnv(process.env.SPANNING_PLATFORM) || undefined);
  const apiUrlOverride   = cleanEnv(process.env.SPANNING_API_URL) || undefined;
  const apiUrl           = apiUrlOverride ?? PLATFORM_DEFAULTS[platform] ?? PLATFORM_DEFAULTS['m365'];
  return {
    adminEmail,
    apiToken,
    platform,
    apiUrl,
    apiUrlIsOverride: !!apiUrlOverride,
  };
}

export function resetClient(): void {
  _client  = null;
  _credKey = null;
}

export function getClient(): SpanningClient {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      'No Spanning API credentials configured. Set SPANNING_ADMIN_EMAIL and SPANNING_API_TOKEN. ' +
      'Optionally set SPANNING_PLATFORM (m365|gws|salesforce, default m365) and SPANNING_API_URL ' +
      'to override the base URL (defaults to the platform-specific Spanning endpoint).'
    );
  }
  const key = `${creds.adminEmail}:${creds.platform}:${creds.apiUrl}`;
  if (_client && _credKey === key) return _client;
  _client = new SpanningClient({
    adminEmail: creds.adminEmail,
    apiToken:   creds.apiToken,
    platform:   creds.platform,
    apiUrl:     creds.apiUrl,
  });
  _credKey = key;
  logger.info('Created Spanning API client', {
    platform: creds.platform,
    apiUrl:   creds.apiUrlIsOverride ? `${creds.apiUrl} (from SPANNING_API_URL)` : `${creds.apiUrl} (platform default)`,
  });
  return _client;
}
