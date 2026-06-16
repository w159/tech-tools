/**
 * KnowBe4 HTTP client and credential management.
 *
 * In gateway mode (AUTH_MODE=gateway), per-request credentials are stored
 * in AsyncLocalStorage to prevent cross-tenant leakage under concurrent load.
 *
 * In env mode (AUTH_MODE=env or unset), credentials come from
 * KNOWBE4_API_KEY and KNOWBE4_REGION environment variables directly.
 *
 * Authentication: Bearer token via Authorization header.
 *
 * Base URLs by region:
 * - US: https://us.api.knowbe4.com
 * - EU: https://eu.api.knowbe4.com
 * - CA: https://ca.api.knowbe4.com
 * - UK: https://uk.api.knowbe4.com
 * - DE: https://de.api.knowbe4.com
 *
 * Rate limits: 2,000 requests/day + licensed user count,
 * 4 requests/second max, 50 requests/minute burst limit.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "./logger.js";
import { KNOWBE4_REGIONS, type KnowBe4Credentials } from "./types.js";
import { resolveBaseUrl, describeBaseUrl } from "../../../_shared/base-url.js";

// Strip unresolved MCP host template placeholders (e.g. "${user_config.x}")
// and whitespace-only values so optional env vars fall through to their defaults.
const isUnresolvedPlaceholder = (v: string | undefined): boolean =>
  !!v && /^\$\{[^}]+\}$/.test(v.trim());
const cleanEnv = (v: string | undefined): string =>
  !v || isUnresolvedPlaceholder(v) ? "" : v.trim();

/**
 * Per-request credential store for gateway mode.
 * Prevents cross-tenant leakage when concurrent requests
 * are handled by the same process.
 */
export const credentialStore = new AsyncLocalStorage<KnowBe4Credentials>();

/**
 * Get credentials from the request-scoped store (gateway mode)
 * or from environment variables (stdio/env mode).
 */
export function getCredentials(): KnowBe4Credentials | null {
  // Check request-scoped credentials first (gateway mode)
  const override = credentialStore.getStore();
  if (override) {
    return override;
  }

  // Fall back to environment variables (stdio/env mode)
  const apiKey = cleanEnv(process.env.KNOWBE4_API_KEY);

  if (!apiKey) {
    logger.warn("Missing credentials", { hasApiKey: false });
    return null;
  }

  // Base URL resolution order:
  // 1. KNOWBE4_BASE_URL env var (explicit override) — always wins.
  // 2. Region-derived URL from KNOWBE4_REGIONS map (us/eu/ca/uk/de).
  // 3. Vendor default via resolveBaseUrl ("https://us.api.knowbe4.com").
  //
  // NOTE: resolveBaseUrl("knowbe4") ALWAYS returns the hardcoded US default
  // when no explicit override is given, so it must only be consulted for the
  // explicit-override case. Consulting it before the region map would make
  // KNOWBE4_REGION a no-op and silently route EU/CA/UK/DE accounts to the US
  // shard. We therefore branch on whether an explicit override is present.
  const explicitOverride = cleanEnv(process.env.KNOWBE4_BASE_URL) || undefined;
  const region = (cleanEnv(process.env.KNOWBE4_REGION) || "us").toLowerCase();
  const regionUrl = KNOWBE4_REGIONS[region];
  const baseUrl = explicitOverride
    ? (resolveBaseUrl("knowbe4", explicitOverride) as string)
    : regionUrl ?? (KNOWBE4_REGIONS.us as string);

  return { apiKey, baseUrl };
}

/**
 * Make an authenticated HTTP request to the KnowBe4 API.
 * Reads credentials fresh from env on each call so gateway mode
 * header injection is always reflected.
 */
export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
  } = {}
): Promise<T> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      "No KnowBe4 API credentials configured. Please set the KNOWBE4_API_KEY environment variable."
    );
  }

  const url = new URL(path, creds.baseUrl);

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const method = options.method || "GET";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (options.body !== undefined && method !== "GET") {
    fetchOptions.body = JSON.stringify(options.body);
  }

  logger.debug("KnowBe4 API request", { method, url: url.toString() });

  const response = await fetch(url.toString(), fetchOptions);

  // Safe: read text once, then try JSON parse
  const rawText = await response.text();
  let responseBody: unknown;
  try {
    responseBody = JSON.parse(rawText);
  } catch {
    responseBody = rawText;
  }

  if (!response.ok) {
    const message =
      typeof responseBody === "object" &&
      responseBody !== null &&
      "message" in responseBody
        ? String((responseBody as Record<string, unknown>).message)
        : `HTTP ${response.status}: ${response.statusText}`;

    logger.error("KnowBe4 API error", {
      status: response.status,
      url: url.toString(),
      message,
    });

    if (response.status === 401) {
      throw new Error(`Authentication failed: ${message}. Check your KNOWBE4_API_KEY.`);
    }
    if (response.status === 403) {
      throw new Error(`Forbidden: ${message}. Insufficient permissions or subscription level.`);
    }
    if (response.status === 404) {
      throw new Error(`Not found: ${message}`);
    }
    if (response.status === 429) {
      throw new Error(`Rate limit exceeded: ${message}. KnowBe4 allows 4 req/sec and 2000+seats req/day.`);
    }
    throw new Error(`KnowBe4 API error (${response.status}): ${message}`);
  }

  return responseBody as T;
}

/**
 * Return a human-readable description of the resolved base URL.
 * Used by the status tool to report which endpoint is active.
 */
export function describeKnowBe4BaseUrl(): string {
  const region = (cleanEnv(process.env.KNOWBE4_REGION) || "us").toLowerCase();
  const regionUrl = KNOWBE4_REGIONS[region];
  const explicitOverride = cleanEnv(process.env.KNOWBE4_BASE_URL) || undefined;
  if (explicitOverride) {
    return describeBaseUrl("knowbe4", explicitOverride, "KNOWBE4_BASE_URL");
  }
  if (regionUrl) {
    return `${regionUrl} (from KNOWBE4_REGION=${region}; set KNOWBE4_BASE_URL to override)`;
  }
  // Unknown region code — fall back to the US default.
  return `${KNOWBE4_REGIONS.us} (default; KNOWBE4_REGION='${region}' is not a known region, set KNOWBE4_REGION to one of us, eu, ca, uk, de)`;
}

/**
 * Clear cached credentials (useful for testing)
 */
export function clearCredentials(): void {
  // No-op — credentials are read fresh from env each call
}
