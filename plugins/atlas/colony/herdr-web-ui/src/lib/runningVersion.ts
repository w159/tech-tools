import type { HerdrUpdateStatus, UpdateStatus } from "../../shared/update.ts";

/** "v0.2.0 (1c4ad6a0e502)" when the version is known, else the commit alone. */
export function versionLabel(version: string | null | undefined, revision: string | null | undefined): string | null {
  const commit = revision?.slice(0, 12);
  if (version) return commit ? `v${version} (${commit})` : `v${version}`;
  return commit ?? null;
}

/**
 * The app version Settings prints. The server's answer names the version and commit it runs;
 * before it answers, and where it names no version (an older server sent only the commit), the
 * version this client was built from: the line always carries a version number.
 */
export function runningAppVersion(status: Pick<UpdateStatus, "current_version" | "current_revision"> | null, built: string): string {
  return versionLabel(status?.current_version || built, status?.current_revision) ?? `v${built}`;
}

/**
 * The version this tab's client was built from, when the server already runs another one: after
 * an update and before the reload, or behind a cached client. A bug seen in this tab belongs to
 * this version, not to the one the server reports.
 */
export function staleClientVersion(status: Pick<UpdateStatus, "current_version"> | null, built: string): string | null {
  return status?.current_version && status.current_version !== built ? `v${built}` : null;
}

/**
 * The herdr version Settings prints: the running server's, else the installed binary's, else
 * the one the health check reported, which is all there is where herdr cannot be updated from
 * here (Windows, an older server, the demo).
 */
export function runningHerdrVersion(status: Pick<HerdrUpdateStatus, "server_version" | "binary_version"> | null, reported: string | null): string | null {
  return status?.server_version || status?.binary_version || reported || null;
}
