import { VantaClient } from 'node-vanta';
import { logger } from './logger.js';

let _client: VantaClient | null = null;
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
  baseUrl?: string;
}

export function getCredentials(): Credentials | null {
  const clientId = process.env.VANTA_CLIENT_ID;
  const clientSecret = process.env.VANTA_CLIENT_SECRET;
  if (!cleanEnv(clientId) || !cleanEnv(clientSecret)) {
    logger.warn('Missing VANTA_CLIENT_ID or VANTA_CLIENT_SECRET');
    return null;
  }
  const baseUrl = cleanEnv(process.env.VANTA_BASE_URL) || undefined;
  return { clientId: cleanEnv(clientId), clientSecret: cleanEnv(clientSecret), baseUrl };
}

export function resetClient(): void {
  _client = null;
  _credKey = null;
  logger.debug('Reset Vanta client');
}

export async function getClient(): Promise<VantaClient> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      'No Vanta API credentials configured. Set VANTA_CLIENT_ID and VANTA_CLIENT_SECRET. ' +
        'Optionally set VANTA_BASE_URL to override the default https://api.vanta.com/v1.'
    );
  }

  const key = `${creds.clientId}:${creds.baseUrl || ''}`;
  if (_client && _credKey === key) return _client;

  _client = new VantaClient(creds);
  _credKey = key;
  logger.info('Created Vanta API client', { baseUrl: creds.baseUrl || '(default)' });
  return _client;
}
