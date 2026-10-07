import { useEffect, useState } from "react";
import type { UpdateStatus } from "../../shared/update.ts";
import { useHerdrUpdate } from "../lib/herdrUpdate.ts";
import { runningAppVersion, runningHerdrVersion, staleClientVersion, versionLabel } from "../lib/runningVersion.ts";
import { describeUpdate } from "../lib/updateProgress.ts";
import type { UpdatesModel } from "../lib/updates.ts";
import "./Machines.css";
import "./UpdateControls.css";
import { useT } from "../lib/i18n.ts";

declare const __APP_VERSION__: string;

/**
 * An install as a step and a bar. A server that names no step (the one being replaced may be
 * older than the steps) gets the phase in words and a bar that only moves.
 */
function UpdateProgress({ status, fallback }: { status: UpdateStatus | null; fallback: string }) {
  const t = useT();
  const view = describeUpdate(status);
  const label = view ? t(view.label) : fallback;
  return <div className="bridge-progress update-progress">
    <p className="bridge-progress-step"><span>{label}</span>{view && <span className="bridge-progress-count">{view.step}</span>}</p>
    <div className="bridge-progress-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} {...(view ? { "aria-valuenow": view.percent } : {})}>
      <span className={view ? "" : "is-indeterminate"} style={view ? { width: `${view.percent}%` } : undefined} />
    </div>
  </div>;
}

export function UpdateControls({ updates, bridgesFollow = false }: { updates: UpdatesModel; bridgesFollow?: boolean }) {
  const t = useT();
  const { status, error, busy, needsReload, request } = updates;
  const installing = busy && (status?.phase === "building" || status?.phase === "restarting");
  const tabVersion = staleClientVersion(status, __APP_VERSION__);
  return <section className="settings-section settings-updates">
    <h3>{t("Updates")}</h3>
    {/* always a version: the sidebar no longer carries one */}
    <p className="settings-hint">{t("Running {version}", { version: runningAppVersion(status, __APP_VERSION__) })}</p>
    {tabVersion && <p className="settings-hint">{t("This tab still runs {version} until it is reloaded.", { version: tabVersion })}</p>}
    {installing && !error ? <div role="status"><UpdateProgress status={status} fallback={t(status?.phase === "building" ? "Installing dependencies and building…" : "Restarting the bridge…")} /></div> : <p className="settings-hint" role="status">
      {error ?? status?.error ?? status?.blocked_reason ?? (busy ? t("Checking for updates…") :
        status?.available ? t("Version {version} is available.", { version: versionLabel(status.latest_version, status.latest_revision) ?? "" }) : status?.checked_at ? t("Up to date.") : t("Waiting for an update check…"))}
    </p>}
    {status?.managed && <>
      <p className="settings-hint">{t("Checks for new releases every 5 minutes.")} {t(status.auto_update ? "Automatic installation is enabled." : "Install when you are ready; the bridge briefly reconnects and herdr sessions keep running.")}{bridgesFollow ? ` ${t("Remote PCs' bridges are updated afterwards when the new version needs it.")}` : ""}</p>
      <div className="update-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void request("check")}>{t("Check for updates")}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !status.available || !!status.blocked_reason} onClick={() => void request("install")}>{t("Update and restart")}</button>
      </div>
    </>}
    {status?.checked_at && <p className="settings-hint">Last checked {new Date(status.checked_at).toLocaleString()}</p>}
    {needsReload && <p className="settings-hint">{t("The server was updated. Save any unsent drafts, then")} <button type="button" className="btn" onClick={() => window.location.reload()}>{t("Reload app")}</button></p>}
  </section>;
}

/**
 * herdr itself. `herdr update` typed into a pane is refused by herdr, and every terminal here is
 * a pane: the server runs it instead and moves the running panes onto the new version.
 */
export function HerdrUpdateControls({ enabled, herdrVersion }: { enabled: boolean; herdrVersion: string | null }) {
  const t = useT();
  const { status, error, busy, request } = useHerdrUpdate(enabled);
  const version = runningHerdrVersion(status, herdrVersion);
  // Windows, an older server, a herdr that does not answer: nothing to offer, and the version
  // the health check reported is still read here, since the sidebar no longer carries it
  if (!status?.supported) {
    return version ? <section className="settings-section settings-herdr-update">
      <h3>herdr</h3>
      <p className="settings-hint">{t("Running herdr {version}", { version })}</p>
    </section> : null;
  }
  const stale = status.stale && !!status.binary_version && !!status.server_version;
  return <section className="settings-section settings-herdr-update">
    <h3>herdr</h3>
    {version && <p className="settings-hint">{t("Running herdr {version}", { version })}</p>}
    {stale && <p className="settings-hint">{t("herdr {installed} is installed, but the running server is {running}. Updating moves your panes onto the installed version.", { installed: status.binary_version ?? "", running: status.server_version ?? "" })}</p>}
    <p className="settings-hint">{t("Installs the newest herdr on the PC this app runs on and moves its running panes onto it. Panes and agents keep running, and open terminals reconnect.")}</p>
    <div className="update-actions">
      <button type="button" className={stale ? "btn btn-primary" : "btn"} disabled={busy} onClick={() => void request()}>{t("Update herdr")}</button>
    </div>
    {(error || busy) && <p className="settings-hint" role="status">{error ?? t("Updating herdr…")}</p>}
    {/* herdr's own words: what it installed, or why it did not */}
    {!busy && status.output && <pre className="update-output" data-failed={status.phase === "error" || undefined}>{status.output}</pre>}
  </section>;
}

/**
 * The app-wide line for a release: one button installs it from here, and the line follows the
 * install to the reload. Settings is only where a failure is read in full.
 */
export function UpdateNotice({ updates, onOpen }: { updates: UpdatesModel; onOpen: () => void }) {
  const t = useT();
  const { status, error, busy, needsReload, request } = updates;
  // the check an install starts with reports nothing available until it is done: the line this
  // button sits on must not leave between the tap and the first step
  const [started, setStarted] = useState(false);
  useEffect(() => { if (!busy) setStarted(false); }, [busy]);
  const failed = error !== null || (status?.phase === "error" && !!status.error);
  // that same check can be what fails, and then nothing is available either: the line stays for
  // the install asked for here. A background check that fails alone is Settings' to report.
  const [attempted, setAttempted] = useState(false);
  useEffect(() => { if (!busy && !failed) setAttempted(false); }, [busy, failed]);
  const installing = status?.phase === "building" || status?.phase === "restarting";
  // Try again after such a failure looks for the release again, and the line waits with it
  const looking = attempted && busy;
  if (!needsReload && !status?.available && !installing && !started && !looking && !(attempted && failed)) return null;
  if (installing || started || looking) {
    return <div className="update-notice is-progress" role="status">
      <UpdateProgress status={status} fallback={t(installing ? status?.phase === "building" ? "Installing dependencies and building…" : "Restarting the bridge…" : started ? "Starting the update…" : "Checking for updates…")} />
    </div>;
  }
  if (needsReload) {
    return <div className="update-notice" role="status">
      <span>{t("App updated. Save unsent drafts before reloading.")}</span>
      <button type="button" className="btn" onClick={() => window.location.reload()}>{t("Reload app")}</button>
    </div>;
  }
  // without a release in reach the server refuses an install: ask it to look again first
  const retry = status?.available ? "install" : "check";
  return <div className="update-notice" role="status">
    <span>{failed ? t("The update could not be installed.") : status?.latest_version ? t("herdr web ui v{version} is available.", { version: status.latest_version }) : t("A herdr web ui update is available.")}</span>
    {failed && <button type="button" className="btn btn-ghost" onClick={onOpen}>{t("Details")}</button>}
    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { setAttempted(true); setStarted(retry === "install"); void request(retry); }}>{t(failed ? "Try again" : "Update")}</button>
  </div>;
}
