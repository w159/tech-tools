import { PaylocityClient } from 'node-paylocity';
import { logger } from './logger.js';

let _client: PaylocityClient | null = null;
let _credKey: string | null = null;

// Strip unresolved MCP host template placeholders (e.g. "${user_config.x}")
// and whitespace-only values so optional env vars fall through to their defaults.
const isUnresolvedPlaceholder = (v: string | undefined): boolean =>
  !!v && /^\$\{[^}]+\}$/.test(v.trim());
const cleanEnv = (v: string | undefined): string =>
  !v || isUnresolvedPlaceholder(v) ? '' : v.trim();

interface Credentials {
  clientId: string;
  clientSecret: string;
  defaultCompanyId?: string;
  baseUrl?: string;
  sandbox?: boolean;
}

export function getCredentials(): Credentials | null {
  const clientId = cleanEnv(process.env.PAYLOCITY_CLIENT_ID);
  const clientSecret = cleanEnv(process.env.PAYLOCITY_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    logger.warn('Missing PAYLOCITY_CLIENT_ID or PAYLOCITY_CLIENT_SECRET');
    return null;
  }
  const defaultCompanyId = cleanEnv(process.env.PAYLOCITY_COMPANY_ID) || undefined;
  const baseUrl = cleanEnv(process.env.PAYLOCITY_BASE_URL) || undefined;
  const sandboxRaw = cleanEnv(process.env.PAYLOCITY_SANDBOX).toLowerCase();
  const sandbox = sandboxRaw === 'true' || sandboxRaw === '1' || sandboxRaw === 'yes';
  return { clientId, clientSecret, defaultCompanyId, baseUrl, sandbox };
}

export function resetClient(): void {
  _client = null;
  _credKey = null;
  logger.debug('Reset Paylocity client');
}

export async function getClient(): Promise<PaylocityClient> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      'No Paylocity API credentials configured. Set PAYLOCITY_CLIENT_ID and ' +
        'PAYLOCITY_CLIENT_SECRET. Optionally set PAYLOCITY_COMPANY_ID for a ' +
        'default company scope, PAYLOCITY_BASE_URL to override the host, or ' +
        'PAYLOCITY_SANDBOX=true to use the sandbox host.'
    );
  }

  const key = `${creds.clientId}:${creds.baseUrl || ''}:${creds.sandbox ? 'sb' : 'prod'}:${creds.defaultCompanyId || ''}`;
  if (_client && _credKey === key) return _client;

  _client = new PaylocityClient(creds);
  _credKey = key;
  logger.info('Created Paylocity API client', {
    baseUrl: _client.baseUrl,
    defaultCompanyId: creds.defaultCompanyId || '(none)',
  });
  return _client;
}
