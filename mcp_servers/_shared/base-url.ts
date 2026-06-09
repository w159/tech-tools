/**
 * base-url.ts — vendor default URL resolution with optional env overrides.
 *
 * CLAUDE.md rule: "Base URL fields must be TRULY optional."
 * Every vendor whose API has a documented stable default base URL must
 * hardcode that default in code. The corresponding env var is optional —
 * missing values resolve to the documented default with no warning or error.
 *
 * This module provides:
 *   - `resolveBaseUrl`  — generic resolver used by every vendor.
 *   - `VENDOR_DEFAULTS` — registry of known vendor defaults, used both by
 *                         the resolver and by status tools to report which
 *                         URL is active.
 *   - `makeBaseUrlResolver` — factory that creates a typed resolver bound to
 *                             a specific vendor (eliminates boilerplate in
 *                             each server's client.ts / utils.ts).
 *
 * Import path (after tsconfig widening — see ADOPTION.md):
 *   import { resolveBaseUrl, makeBaseUrlResolver } from "../../_shared/base-url.js";
 *
 * No runtime dependencies. Pure functions only.
 */

// ---------------------------------------------------------------------------
// Vendor defaults registry
// ---------------------------------------------------------------------------

/**
 * Canonical vendor keys used as the first argument to `resolveBaseUrl` and
 * as keys in `VENDOR_DEFAULTS`. Add new vendors here when they are onboarded.
 */
export type VendorKey =
  | "auvik"
  | "blumira"
  | "cipp"
  | "connectwise"
  | "kaseya_spanning"
  | "knowbe4"
  | "ninjaone"
  | "paylocity"
  | "threatlocker"
  | "vanta";

/**
 * Documented default base URLs, sourced from each vendor's public developer
 * documentation. Regional vendors (Auvik, KnowBe4, NinjaOne, ThreatLocker)
 * use their primary/US default; operators deploying to other regions set the
 * env var override.
 *
 * Sources:
 *   auvik        https://support.auvik.com/hc/en-us/articles/204309844
 *   blumira      https://docs.blumira.com/reference
 *   kaseya_spanning  https://developer.kaseya.com/spanning
 *   knowbe4      https://developer.knowbe4.com (US datacenter)
 *   ninjaone     https://app.ninjarmm.com (US region)
 *   paylocity    https://developer.paylocity.com
 *   threatlocker https://threatlocker.com/platform/api (US cloud)
 *   vanta        https://developer.vanta.com
 *   cipp         self-hosted — no global default, env var is REQUIRED
 *   connectwise  self-hosted — no global default, env var is REQUIRED
 */
export const VENDOR_DEFAULTS: Partial<Record<VendorKey, string>> = {
  auvik:           "https://auvikapi.us1.my.auvik.com/v1",
  blumira:         "https://api.blumira.com/public-api/v1",
  kaseya_spanning: "https://o365-api.spanning.com",
  knowbe4:         "https://us.api.knowbe4.com/v1",
  ninjaone:        "https://app.ninjarmm.com",
  paylocity:       "https://api.paylocity.com/api/v2",
  threatlocker:    "https://portalapi.g.threatlocker.com/portalapi",
  vanta:           "https://api.vanta.com/v1",
  // cipp and connectwise are self-hosted; no default. resolveBaseUrl will
  // return undefined and the server must treat a missing value as a config error.
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the base URL for a vendor by checking (in order):
 *   1. The provided `override` string (typically from an env var).
 *   2. The hardcoded default in `VENDOR_DEFAULTS`.
 *   3. `undefined` — only for self-hosted vendors with no global default.
 *
 * Trailing slashes are removed from the resolved URL so callers can safely
 * append paths with a leading slash.
 *
 * @param vendor    Canonical vendor key.
 * @param override  Value of the optional env var (empty string treated as absent).
 * @returns         Resolved base URL without trailing slash, or `undefined` for
 *                  self-hosted vendors when no override is supplied.
 *
 * Usage in a server's client.ts:
 * ```ts
 * const baseUrl = resolveBaseUrl("ninjaone", process.env.NINJAONE_BASE_URL);
 * // baseUrl === "https://app.ninjarmm.com" when env var is unset
 * ```
 */
export function resolveBaseUrl(
  vendor: VendorKey,
  override?: string
): string | undefined {
  const cleaned = override?.trim();
  if (cleaned) return stripTrailingSlash(cleaned);

  const def = VENDOR_DEFAULTS[vendor];
  return def ? stripTrailingSlash(def) : undefined;
}

/**
 * Create a resolver function bound to a specific vendor. The returned
 * function takes an optional override string and returns the resolved URL.
 * Useful in a server's initialization code to avoid repeating the vendor key.
 *
 * @param vendor  Canonical vendor key.
 * @returns       Bound resolver: `(override?: string) => string | undefined`.
 *
 * Usage:
 * ```ts
 * const resolveNinjaOneUrl = makeBaseUrlResolver("ninjaone");
 * const baseUrl = resolveNinjaOneUrl(process.env.NINJAONE_BASE_URL);
 * ```
 */
export function makeBaseUrlResolver(
  vendor: VendorKey
): (override?: string) => string | undefined {
  return (override?: string) => resolveBaseUrl(vendor, override);
}

/**
 * Return a human-readable description of the resolved base URL suitable for
 * inclusion in a `<vendor>_status` tool response. States clearly whether the
 * URL comes from an env var or the hardcoded default.
 *
 * @param vendor    Canonical vendor key.
 * @param override  Value of the optional env var (empty string treated as absent).
 * @returns         Descriptive string for the status tool output.
 *
 * Usage:
 * ```ts
 * const urlDesc = describeBaseUrl("ninjaone", process.env.NINJAONE_BASE_URL);
 * // => "https://app.ninjarmm.com (vendor default; set NINJAONE_BASE_URL to override)"
 * // or  "https://eu.ninjarmm.com (from NINJAONE_BASE_URL env var)"
 * ```
 */
export function describeBaseUrl(
  vendor: VendorKey,
  override?: string,
  envVarName?: string
): string {
  const cleaned = override?.trim();
  if (cleaned) {
    const label = envVarName ? `from ${envVarName} env var` : "from env var override";
    return `${stripTrailingSlash(cleaned)} (${label})`;
  }

  const def = VENDOR_DEFAULTS[vendor];
  if (def) {
    const hint = envVarName
      ? `vendor default; set ${envVarName} to override`
      : "vendor default";
    return `${stripTrailingSlash(def)} (${hint})`;
  }

  const required = envVarName ? `${envVarName} is required` : "env var is required";
  return `not configured (${required} — self-hosted vendor has no global default)`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
