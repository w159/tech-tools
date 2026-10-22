import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

/**
 * Knob values saved by the Command Center: `<ATLAS_HOME or ~/.atlas>/settings.json` `env` (scripts/atlas_control.py
 * owns the file; Claude Code gets the same values through its own settings.json env). Only ATLAS_* string values;
 * an unreadable or malformed file exports nothing. The store wins over the real environment: that value is the stale
 * copy from session start (or from applyAtlasStoreEnv at load), so a knob saved mid-session applies on the next run.
 */
function readStoredEnv(file: string): Record<string, unknown> {
	try {
		const stored = JSON.parse(fs.readFileSync(file, "utf8"))?.env;
		return stored && typeof stored === "object" ? stored : {};
	} catch {
		return {};
	}
}

export function atlasStoreEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
	const file = nodePath.join(env.ATLAS_HOME || process.env.ATLAS_HOME || nodePath.join(os.homedir(), ".atlas"), "settings.json");
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(readStoredEnv(file))) {
		if (/^ATLAS_[A-Z0-9_]+$/.test(k) && typeof v === "string" && v !== "") out[k] = v;
	}
	return out;
}

/** One behavior knob, read per call: the saved store value, else the process env value. */
export function atlasKnob(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
	return atlasStoreEnv(env)[name] ?? env[name];
}
