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

afterAll(() => rmSync(root, { recursive: true, force: true }));
