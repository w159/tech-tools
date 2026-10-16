// bun test preload (omp/bunfig.toml). Several tests run the REAL hooks (session_boot.py -> ensure_dashboard /
// ensure_colony), whose subprocesses would otherwise start or adopt a dashboard daemon on the user's :7421 (a temp
// ATLAS_HOME there leaked a daemon serving a throwaway DB) or the herdr colony. Every state path goes to a tempdir,
// both daemons are switched off, and a daemon that is started anyway gets a spare port, never the live one.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "bun:test";

const root = mkdtempSync(join(tmpdir(), "atlas-omp-test-"));
process.env.ATLAS_HOME = join(root, ".atlas");
process.env.ATLAS_DB = join(root, ".atlas", "atlas.db");
process.env.ATLAS_DASHBOARD_DB = process.env.ATLAS_DB;
process.env.ATLAS_DASHBOARD = "off";
process.env.ATLAS_COLONY = "off";
process.env.ATLAS_DASHBOARD_PORT = "17969";
// a test that reaches for herdr here (an explicit path past the ignore in bunfig.toml) fails
// rather than opening workspaces in the herdr the user works in
process.env.HERDR_SOCKET = join(root, "no-herdr.sock");
delete process.env.HERDR_SOCKET_PATH;

// every tmux a test runs lands on a private server (default socket = <dir>/tmux-<uid>/default), never the user's
process.env.TMUX_TMPDIR = mkdtempSync(join("/tmp", "atmx"));
delete process.env.TMUX;
delete process.env.TMUX_PANE;

afterAll(() => {
	Bun.spawnSync(["tmux", "kill-server"], { env: process.env }); // private socket only: TMUX_TMPDIR is set above
	rmSync(process.env.TMUX_TMPDIR!, { recursive: true, force: true });
	rmSync(root, { recursive: true, force: true });
});
