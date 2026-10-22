// Leaf helpers shared by hook-bridge and channels; split out so channels.ts need not import hook-bridge (import cycle).
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

/** The omp `task` tool's dispatch items: `tasks[]` entries, else the single top-level dispatch. */
export function taskItems(input: unknown): Record<string, unknown>[] {
	if (!input || typeof input !== "object") return [];
	const tasks = (input as Record<string, unknown>).tasks;
	if (Array.isArray(tasks)) return tasks.filter((t): t is Record<string, unknown> => t !== null && typeof t === "object" && !Array.isArray(t));
	return [input as Record<string, unknown>];
}

const FAULT_LOG_MAX_BYTES = 1 << 20;

/**
 * One row in `<ATLAS_HOME or ~/.atlas>/hook-faults.jsonl`, the same file and row shape scripts/atlas_faults.py writes,
 * so the doctor sees bridge fail-opens beside python hook crashes. Best effort, never throws.
 * ponytail: skipped once the file passes 1 MiB (atlas_faults.py owns truncation), so a flood cannot grow it.
 */
export function recordFault(hook: string, error: string, type: string, cwd: string | undefined): void {
	try {
		const file = nodePath.join(process.env.ATLAS_HOME || nodePath.join(os.homedir(), ".atlas"), "hook-faults.jsonl");
		fs.mkdirSync(nodePath.dirname(file), { recursive: true });
		if (fs.existsSync(file) && fs.statSync(file).size > FAULT_LOG_MAX_BYTES) return;
		fs.appendFileSync(file, `${JSON.stringify({ ts: Date.now() / 1000, hook, error: error.slice(0, 500), type, cwd: cwd ?? process.cwd() })}\n`);
	} catch {
		// the fault log must never be the thing that fails
	}
}
