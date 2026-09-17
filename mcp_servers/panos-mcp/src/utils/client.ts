import { PanosClient } from 'node-panos';
import { logger } from './logger.js';

let _client: PanosClient | null = null;
let _credKey: string | null = null;

// Strip unresolved MCP host template placeholders (e.g. "${user_config.x}")
// and whitespace-only values so optional env vars fall through to their defaults.
const isUnresolvedPlaceholder = (v: string | undefined): boolean =>
  !!v && /^\$\{[^}]+\}$/.test(v.trim());
const cleanEnv = (v: string | undefined): string =>
  !v || isUnresolvedPlaceholder(v) ? '' : v.trim();

interface Credentials {
  host: string;
  apiKey: string;
  username?: string;
  password?: string;
  target?: string;
  verifyTls: boolean;
  restVersion: string;
}

const DEFAULT_REST_VERSION = 'v11.1';

function resolveVerifyTls(raw: string): boolean {
  return cleanEnv(raw).toLowerCase() !== 'false';
}

export function getCredentials(): Credentials | null {
  const host = cleanEnv(process.env.PANOS_HOST);
  const apiKey = cleanEnv(process.env.PANOS_API_KEY);
  if (!host || !apiKey) {
    // PANOS_HOST has no vendor default (the base URL is the target appliance
    // itself), and PANOS_API_KEY has no derivation without a keygen call, so
    // both must be set directly before any tool but panos_status can run.
    logger.warn('Missing PANOS_HOST or PANOS_API_KEY');
    return null;
  }
  return {
    host,
    apiKey,
    username: cleanEnv(process.env.PANOS_USERNAME) || undefined,
    password: cleanEnv(process.env.PANOS_PASSWORD) || undefined,
    target: cleanEnv(process.env.PANOS_TARGET) || undefined,
    verifyTls: resolveVerifyTls(process.env.PANOS_VERIFY_TLS ?? 'true'),
    restVersion: cleanEnv(process.env.PANOS_REST_VERSION) || DEFAULT_REST_VERSION,
  };
}

export function resetClient(): void {
  _client = null;
  _credKey = null;
  logger.debug('Reset PAN-OS client');
}

export async function getClient(): Promise<PanosClient> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      'No PAN-OS credentials configured. Set PANOS_HOST and PANOS_API_KEY. ' +
        'PANOS_HOST has no default - it must name the Panorama or firewall appliance itself. ' +
        'Optionally set PANOS_TARGET, PANOS_VERIFY_TLS, and PANOS_REST_VERSION.'
    );
  }

  const key = `${creds.host}:${creds.apiKey}:${creds.restVersion}`;
  if (_client && _credKey === key) return _client;

  _client = new PanosClient({
    host: creds.host,
    apiKey: creds.apiKey,
    target: creds.target,
    verifyTls: creds.verifyTls,
    restVersion: creds.restVersion,
  });
  _credKey = key;
  logger.info('Created PAN-OS API client', { host: creds.host, restVersion: creds.restVersion });
  return _client;
}
