/**
 * CLI capabilities feature-detection probe.
 *
 * Phase 2 of #183: instead of guessing which MCP tools to expose based on
 * version strings, ask the CLI directly via `minutes capabilities --json`.
 * Tools whose backing CLI subcommand the report confirms get registered;
 * tools whose subcommand is missing (or whose feature key is absent) stay
 * hidden from the MCP tool list.
 *
 * The wrinkle is first-run `npx minutes-mcp`: the CLI may not exist at boot,
 * but `isCliAvailable()` can auto-install it later in the same session. We
 * therefore distinguish:
 * - `missing-cli`: no binary was found at boot, so keep gated tools visible
 *   and let later auto-install make them usable.
 * - `unsupported-cli`: a binary exists, but the capabilities probe failed or
 *   the payload is invalid. Treat as fail-closed and hide gated tools.
 * - `report`: parsed capability payload; register only the features that are
 *   explicitly `true`.
 */

import { execFileSync } from "child_process";

export type CapabilityReport = {
  /** Semver of the CLI, e.g. "0.14.0". */
  version: string;
  /** Wire-contract version. Bumps only on breaking changes. */
  api_version: number;
  /** Feature name to whether the CLI supports it. */
  features: Record<string, boolean>;
};

export type CapabilityProbeResult =
  | { kind: "report"; report: CapabilityReport }
  | { kind: "missing-cli" }
  | { kind: "unsupported-cli" };

/**
 * Probe the installed CLI for its capability report. Synchronous so it
 * runs before tool registrations at module load.
 *
 * Returns one of:
 * - `{ kind: "report", report }` when the probe succeeds and parses.
 * - `{ kind: "missing-cli" }` when the binary is not present at boot.
 * - `{ kind: "unsupported-cli" }` when a binary exists but the capabilities
 *   subcommand fails or returns invalid output.
 */
export function probeCapabilitiesSync(
  binPath: string,
  options: { timeoutMs?: number } = {}
): CapabilityProbeResult {
  const timeoutMs = options.timeoutMs ?? 2000;

  let stdout: string;
  try {
    stdout = execFileSync(binPath, ["capabilities", "--json"], {
      timeout: timeoutMs,
      encoding: "utf-8",
      // Silence stderr so the MCP console stays quiet when the CLI is
      // old (and prints an unknown-subcommand error to stderr).
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return { kind: "missing-cli" };
    }
    return { kind: "unsupported-cli" };
  }

  const report = parseCapabilityReport(stdout);
  if (report === null) {
    return { kind: "unsupported-cli" };
  }
  return { kind: "report", report };
}

/**
 * The newest wire-contract version this MCP server understands. A report
 * whose `api_version` exceeds this value is rejected (treated as null by
 * the caller) so a future breaking CLI schema cannot be silently trusted
 * by an older MCP.
 *
 * Add a new compatibility branch here, don't just bump this number, when
 * the CLI schema changes in a non-additive way.
 */
export const MAX_SUPPORTED_API_VERSION = 1;

/**
 * Parse a capability report JSON payload with shape validation.
 *
 * Exposed separately from the probe so unit tests can exercise the
 * parser without spawning a subprocess.
 */
export function parseCapabilityReport(raw: string): CapabilityReport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  // Object.create(null) would be ideal for the target map; we guard
  // against `__proto__`/`constructor`/`prototype` pollution below.
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.version !== "string") return null;
  if (typeof obj.api_version !== "number") return null;

  // Reject reports from a future CLI with a wire contract we do not
  // understand. Treating this as null triggers the fail-closed path so
  // no tools get silently enabled based on a schema we cannot verify.
  if (
    !Number.isInteger(obj.api_version) ||
    obj.api_version < 1 ||
    obj.api_version > MAX_SUPPORTED_API_VERSION
  ) {
    return null;
  }

  if (!obj.features || typeof obj.features !== "object") return null;

  // Coerce feature map values to booleans; drop non-boolean entries so
  // a misformed payload never accidentally enables a tool. Use a
  // null-prototype object so polluted keys (__proto__, constructor,
  // prototype) cannot reach anything via the prototype chain.
  const rawFeatures = obj.features as Record<string, unknown>;
  const features: Record<string, boolean> = Object.create(null);
  for (const [name, value] of Object.entries(rawFeatures)) {
    if (name === "__proto__" || name === "constructor" || name === "prototype") {
      continue;
    }
    if (typeof value === "boolean") {
      features[name] = value;
    }
  }

  return {
    version: obj.version,
    api_version: obj.api_version,
    features,
  };
}

/**
 * Decide whether to expose a feature-gated MCP tool.
 *
 * Registration contract:
 * - `missing-cli`: return `true` so first-run auto-install sessions do not
 *   permanently lose gated tools until restart.
 * - `unsupported-cli`: return `false` so an older already-installed CLI does
 *   not expose tools whose backing subcommands it definitely lacks.
 * - `report`: return `true` only when the feature key is explicitly `true`.
 */
export function hasFeature(
  probe: CapabilityProbeResult,
  name: string
): boolean {
  if (probe.kind === "missing-cli") return true;
  if (probe.kind !== "report") return false;
  return probe.report.features[name] === true;
}
