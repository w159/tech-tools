import { SonicwallClient } from 'node-sonicwall';
import { cleanEnv } from '@shared/clean-env.js';
import { logger } from './logger.js';

let _client: SonicwallClient | null = null;
let _credKey: string | null = null;

export interface Credentials {
  host: string;
  username: string;
  password: string;
  port: number;
  verifyTls: boolean;
  sessionOverride: boolean;
}

const DEFAULT_PORT = 443;

function resolvePort(raw: string): number {
  const n = Number(cleanEnv(raw));
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

/** host, username and password are all required; there is no vendor default for any of them. */
export function getCredentials(): Credentials | null {
  const host = cleanEnv(process.env.SONICWALL_HOST);
  const username = cleanEnv(process.env.SONICWALL_USERNAME);
  const password = cleanEnv(process.env.SONICWALL_PASSWORD);
  if (!host || !username || !password) return null;
  return {
    host,
    username,
    password,
    port: resolvePort(process.env.SONICWALL_PORT ?? ''),
    verifyTls: cleanEnv(process.env.SONICWALL_VERIFY_TLS).toLowerCase() !== 'false',
    sessionOverride: cleanEnv(process.env.SONICWALL_SESSION_OVERRIDE).toLowerCase() === 'true',
  };
}

export async function getClient(): Promise<SonicwallClient> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      'No SonicWall credentials configured. Set SONICWALL_HOST, SONICWALL_USERNAME and SONICWALL_PASSWORD. ' +
        'SONICWALL_HOST has no default - it must name the firewall itself.'
    );
  }
  const key = JSON.stringify(creds);
  if (_client && _credKey === key) return _client;
  _client = new SonicwallClient(creds);
  _credKey = key;
  logger.info('Created SonicOS API client', { host: creds.host, port: creds.port });
  return _client;
}

/** Release the single SonicOS admin slot. Never throws; no-op when no client was created. */
export async function logoutClient(): Promise<void> {
  if (_client) await _client.logout();
}
