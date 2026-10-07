/**
 * Scope check for orchestration gates — twin of scripts/atlas_scope.py (same
 * markers, same rule; hooks/test_atlas_contract.py asserts the lists match).
 *
 * Gates never arm in scratch dirs (/tmp, mux bench runs) or in a directory with
 * no project marker in itself or any ancestor below $HOME. ATLAS_GATES=always
 * forces armed, ATLAS_GATES=off forces unarmed. Never throws: any error (and a
 * missing cwd) reads as armed.
 */
import { Database } from "bun:sqlite";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import * as nodePath from "node:path";

export const SCRATCH_ROOTS = ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];
export const PROJECT_MARKERS = [".git", ".claude", ".atlas", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "CLAUDE.md", "AGENTS.md"];

const HISTORY_SQL =
	"SELECT 1 FROM projects p JOIN runs r ON r.project_id=p.id JOIN dispatches d ON d.run_id=r.id WHERE p.root_path IN (?,?) LIMIT 1";

/** True when the atlas DB has a project row for cwd with >=1 dispatch ever. Only runs a SELECT; any error reads as no history.
 * Opened with a read-write handle (create:false): a readonly handle cannot open a WAL DB when no -shm exists. */
function hasDispatchHistory(paths: [string, string], env: Record<string, string | undefined>): boolean {
	try {
		const db = env.ATLAS_DB || nodePath.join(homedir(), ".atlas", "atlas.db");
		if (!existsSync(db)) return false;
		const conn = new Database(db, { readwrite: true, create: false });
		try {
			return conn.query(HISTORY_SQL).get(paths[0], paths[1]) != null;
		} finally {
			conn.close();
		}
	} catch {
		return false;
	}
}

export function gatesArmed(cwd: unknown, env: Record<string, string | undefined> = process.env): boolean {
	try {
		const mode = (env.ATLAS_GATES ?? "").trim().toLowerCase();
		if (mode === "always") return true;
		if (mode === "off") return false;
		if (typeof cwd !== "string" || cwd === "") return true;
		const abs = nodePath.resolve(cwd);
		let real = abs;
		try {
			real = realpathSync(abs);
		} catch {
			// nonexistent path: python's realpath also keeps it as-is
		}
		if ([abs, real].some(p => SCRATCH_ROOTS.some(r => p === r || p.startsWith(`${r}/`)))) return false;
		const home = realpathSync(homedir());
		for (let cur = real; cur !== home && cur !== nodePath.dirname(cur); cur = nodePath.dirname(cur)) {
			if (PROJECT_MARKERS.some(m => existsSync(nodePath.join(cur, m)))) return true;
		}
		if (real === home) return false;
		return hasDispatchHistory([abs, real], env);
	} catch {
		return true;
	}
}
