import { ThreatLockerClient } from 'node-threatlocker';
import { resolveBaseUrl } from '../domains/_helpers.js';
import { logger } from './logger.js';

let _client: any | null = null;
let _credKey: string | null = null;

// Strip unresolved MCP host template placeholders (e.g. "${user_config.x}")
// and whitespace-only values so optional env vars fall through to their defaults.
const isUnresolvedPlaceholder = (v: string | undefined): boolean =>
  !!v && /^\$\{[^}]+\}$/.test(v.trim());
const cleanEnv = (v: string | undefined): string =>
  !v || isUnresolvedPlaceholder(v) ? '' : v.trim();

interface Credentials {
  apiKey: string;
  organizationId?: string;
  baseUrl: string;
}

export function getCredentials(): Credentials | null {
  const apiKey = cleanEnv(process.env.THREATLOCKER_API_KEY);
  if (!apiKey) {
    logger.warn('Missing THREATLOCKER_API_KEY');
    return null;
  }
  const organizationId = cleanEnv(process.env.THREATLOCKER_ORGANIZATION_ID) || undefined;
  // resolveBaseUrl returns the env-var value when set, or the hardcoded
  // default (https://portalapi.g.threatlocker.com/portalapi) when unset.
  const baseUrl = resolveBaseUrl('threatlocker', cleanEnv(process.env.THREATLOCKER_BASE_URL))!;
  return { apiKey, organizationId, baseUrl };
}

export function resetClient(): void {
  _client = null;
  _credKey = null;
  logger.debug('Reset ThreatLocker client');
}

export async function getClient(): Promise<any> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      'No ThreatLocker API credentials configured. Set THREATLOCKER_API_KEY (required). ' +
        'Optionally set THREATLOCKER_ORGANIZATION_ID for managed-org scope and ' +
        'THREATLOCKER_BASE_URL for non-default shards (e.g. https://portalapi.eu.threatlocker.com/portalapi).'
    );
  }

  const key = `${creds.apiKey}:${creds.organizationId || ''}:${creds.baseUrl}`;
  if (_client && _credKey === key) return _client;

  _client = new ThreatLockerClient(creds);
  _credKey = key;
  logger.info('Created ThreatLocker API client', {
    hasOrgScope: !!creds.organizationId,
    baseUrl: creds.baseUrl,
  });
  return _client;
}
