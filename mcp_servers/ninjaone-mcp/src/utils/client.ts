/**
 * Lazy-loaded NinjaOne client
 *
 * This module provides lazy initialization of the NinjaOne client
 * to avoid loading the entire library upfront.
 */

import type { NinjaOneClient } from "node-ninjaone";
import { isValidRegion, getBaseUrlForRegion, type NinjaOneRegion } from "./types.js";
import { resolveBaseUrl } from "../../../_shared/base-url.js";
import { logger } from "./logger.js";
import { UserTokenManager } from "../oauth/token-manager.js";

// Strip unresolved MCP host template placeholders (e.g. "${user_config.x}")
// and whitespace-only values so optional env vars fall through to their defaults.
const isUnresolvedPlaceholder = (v: string | undefined): boolean =>
  !!v && /^\$\{[^}]+\}$/.test(v.trim());
const cleanEnv = (v: string | undefined): string =>
  !v || isUnresolvedPlaceholder(v) ? "" : v.trim();

export type NinjaOneAuthMode = "client_credentials" | "user";

export interface NinjaOneCredentials {
  clientId: string;
  clientSecret: string;
  region: NinjaOneRegion;
  baseUrl: string;
  authMode: NinjaOneAuthMode;
}

let _userTokenManager: UserTokenManager | null = null;

export function getUserTokenManager(): UserTokenManager | null {
  return _userTokenManager;
}

export function ensureUserTokenManager(creds: NinjaOneCredentials): UserTokenManager {
  if (!_userTokenManager) {
    _userTokenManager = new UserTokenManager(creds.baseUrl, creds.clientId, creds.region);
  }
  return _userTokenManager;
}

let _client: NinjaOneClient | null = null;
let _credentials: NinjaOneCredentials | null = null;

/** Per-request client override — takes priority over the cached singleton */
let _clientOverride: NinjaOneClient | null = null;

/** Per-request credential override — takes priority over env vars */
let _credentialOverrides: NinjaOneCredentials | null = null;

/**
 * Create a fresh NinjaOneClient directly from credentials,
 * bypassing environment variables and the module-level cache.
 */
export async function createClientDirect(
  creds: NinjaOneCredentials
): Promise<NinjaOneClient> {
  const { NinjaOneClient } = await import("node-ninjaone");
  return new NinjaOneClient({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    baseUrl: creds.baseUrl,
  });
}

/**
 * Set a request-scoped client override.
 * While set, getClient() returns this instance instead of the cached one.
 */
export function setClientOverride(client: NinjaOneClient): void {
  _clientOverride = client;
}

/**
 * Clear the request-scoped client override.
 */
export function clearClientOverride(): void {
  _clientOverride = null;
}

/**
 * Set request-scoped credential overrides.
 * While set, getCredentials() returns these instead of reading env vars.
 */
export function setCredentialOverrides(creds: NinjaOneCredentials): void {
  _credentialOverrides = creds;
}

/**
 * Clear request-scoped credential overrides.
 */
export function clearCredentialOverrides(): void {
  _credentialOverrides = null;
}

/**
 * Get credentials from environment variables (or per-request overrides)
 */
export function getCredentials(): NinjaOneCredentials | null {
  if (_credentialOverrides) {
    return _credentialOverrides;
  }

  const clientId = cleanEnv(process.env.NINJAONE_CLIENT_ID);
  const clientSecret = cleanEnv(process.env.NINJAONE_CLIENT_SECRET);
  const regionEnv = (cleanEnv(process.env.NINJAONE_REGION) || "us").toLowerCase();
  const authModeRaw = cleanEnv(process.env.NINJAONE_AUTH_MODE).toLowerCase();
  const authMode: NinjaOneAuthMode = authModeRaw === "user" ? "user" : "client_credentials";

  if (!clientId) {
    logger.warn("Missing NINJAONE_CLIENT_ID");
    return null;
  }
  if (authMode === "client_credentials" && !clientSecret) {
    logger.warn("Missing NINJAONE_CLIENT_SECRET (required for client_credentials mode)");
    return null;
  }

  if (!isValidRegion(regionEnv)) {
    logger.warn("Invalid region configured", { region: regionEnv, valid: ["us", "eu", "oc", "ca", "us2", "fed"] });
    return null;
  }

  const region = regionEnv as NinjaOneRegion;
  // NINJAONE_BASE_URL is optional: empty/placeholder resolves to the
  // region-derived default (e.g. https://app.ninjarmm.com for "us").
  // Set it only to override the regional default for staging/sovereign shards.
  const baseUrlOverride = cleanEnv(process.env.NINJAONE_BASE_URL);
  const baseUrl = resolveBaseUrl("ninjaone", baseUrlOverride) ?? getBaseUrlForRegion(region);

  return { clientId, clientSecret, region, baseUrl, authMode };
}

/**
 * Get or create the NinjaOne client (lazy initialization)
 */
export async function getClient(): Promise<NinjaOneClient> {
  if (_clientOverride) {
    return _clientOverride;
  }

  const creds = getCredentials();

  if (!creds) {
    throw new Error(
      "No API credentials provided. Please configure NINJAONE_CLIENT_ID, NINJAONE_CLIENT_SECRET, and optionally NINJAONE_REGION (us, eu, oc, ca, us2, fed) environment variables."
    );
  }

  // If credentials changed, invalidate the cached client
  if (
    _client &&
    _credentials &&
    (creds.clientId !== _credentials.clientId ||
      creds.clientSecret !== _credentials.clientSecret ||
      creds.region !== _credentials.region)
  ) {
    logger.info("Credentials changed, recreating client");
    _client = null;
  }

  if (!_client) {
    try {
      const { NinjaOneClient } = await import("node-ninjaone");
      logger.info("Creating NinjaOne client", { region: creds.region, baseUrl: creds.baseUrl, authMode: creds.authMode });
      const clientConfig: any = {
        clientId: creds.clientId,
        baseUrl: creds.baseUrl,
      };
      if (creds.authMode === "user") {
        const manager = ensureUserTokenManager(creds);
        clientConfig.tokenSupplier = () => manager.getAccessToken();
      } else {
        clientConfig.clientSecret = creds.clientSecret;
      }
      _client = new NinjaOneClient(clientConfig);
      _credentials = creds;
    } catch (error) {
      logger.error("Failed to create NinjaOne client", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  return _client;
}

/**
 * Clear the cached client (useful for testing)
 */
export function clearClient(): void {
  _client = null;
  _credentials = null;
}