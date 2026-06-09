/**
 * CLI/MCP version compatibility.
 *
 * Replaces the historical strict-equality check with same-major semver
 * compatibility. See issue #183 for the rationale: hosted `.mcpb` bundles
 * ship a frozen MCP server version, while users' CLI versions advance
 * independently via brew/cargo/auto-install. Strict equality turned every
 * version skew into scary user-facing warnings and broke auto-install when
 * the pinned GitHub release tag no longer matched.
 */

export type VersionParts = {
  major: number;
  minor: number;
  patch: number;
};

export type CompatibilitySeverity = "ok" | "info" | "error";

export type CompatibilityResult = {
  ok: boolean;
  severity: CompatibilitySeverity;
  message: string;
};

export function parseVersion(raw: string): VersionParts | null {
  const match = raw.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const [, major, minor, patch] = match;
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
  };
}

const UPGRADE_ADVICE =
  "Update with: brew upgrade minutes (or cargo install minutes-cli)";

/**
 * Decide whether a CLI version is compatible with the running MCP server.
 *
 * Rules (Phase 1 of #183):
 * - Unparseable version string: proceed, log informationally. Old CLIs may
 *   not emit a parseable `--version` but usually still work.
 * - Major-version mismatch: not compatible. Emit one clear error with an
 *   upgrade command.
 * - Same major, same version: ok, one-line info log.
 * - Same major, different minor/patch: ok. Older CLI with newer MCP, or
 *   vice-versa, is backward-compatible within a major per our contract.
 */
export function isCliCompatible(
  cliVersion: string,
  serverVersion: string
): CompatibilityResult {
  const cli = parseVersion(cliVersion);
  const server = parseVersion(serverVersion);

  if (!cli || !server) {
    return {
      ok: true,
      severity: "info",
      message: `CLI reported version '${cliVersion}' (unparseable), proceeding`,
    };
  }

  if (cli.major !== server.major) {
    return {
      ok: false,
      severity: "error",
      message:
        `CLI major-version mismatch: installed ${cliVersion}, ` +
        `MCP server expects ${server.major}.x. ${UPGRADE_ADVICE}`,
    };
  }

  if (
    cli.minor === server.minor &&
    cli.patch === server.patch
  ) {
    return {
      ok: true,
      severity: "ok",
      message: `CLI v${cliVersion}, up to date`,
    };
  }

  return {
    ok: true,
    severity: "info",
    message:
      `CLI v${cliVersion} against MCP server v${serverVersion} ` +
      `(same major, compatible)`,
  };
}
