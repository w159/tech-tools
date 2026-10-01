/**
 * Loader for contracts/native-tools.json — the single source the Python hooks
 * (dispatch_tripwire.py, completion_gate.py) also read. Unreadable or
 * malformed → undefined, and every consumer then allows (fail open).
 */
import * as fs from "node:fs";
import * as nodePath from "node:path";

export const NATIVE_TOOLS_PATH = nodePath.resolve(import.meta.dir, "..", "contracts", "native-tools.json");

export type LeanKind = "search" | "glob" | "read" | "shell";
const KINDS: LeanKind[] = ["search", "glob", "read", "shell"];

export interface KindSpec {
	omp: string;
	mode: "deny" | "nudge";
	replacements: Array<{ tool: string; servers: RegExp[] }>;
}

export interface NativeToolContract {
	exemptDirs: string[];
	exemptExtensions: string[];
	kinds: Record<LeanKind, KindSpec>;
}

/** "lean-ctx" → /^lean[-_]?ctx$/i-ish shape match, tolerant of omp's `_` sanitizing. */
function serverPattern(name: string): RegExp {
	const body = name
		.split(/[-_]/)
		.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("[-_]?");
	return new RegExp(body, "i");
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");

function parseKind(raw: unknown): KindSpec | undefined {
	if (!raw || typeof raw !== "object" || !("omp" in raw) || !("mode" in raw) || !("replacements" in raw)) return undefined;
	const { omp, mode, replacements } = raw;
	if (typeof omp !== "string" || (mode !== "deny" && mode !== "nudge") || !Array.isArray(replacements)) return undefined;
	const parsed: KindSpec["replacements"] = [];
	for (const r of replacements) {
		if (!r || typeof r !== "object" || !("tool" in r) || !("servers" in r)) return undefined;
		if (typeof r.tool !== "string" || !strings(r.servers)) return undefined;
		parsed.push({ tool: r.tool, servers: r.servers.map(serverPattern) });
	}
	return { omp, mode, replacements: parsed };
}

let cached: { path: string; value: NativeToolContract | undefined } | undefined;

export function loadNativeTools(path: string = NATIVE_TOOLS_PATH): NativeToolContract | undefined {
	if (cached?.path === path) return cached.value;
	let value: NativeToolContract | undefined;
	try {
		const raw: unknown = JSON.parse(fs.readFileSync(path, "utf8"));
		if (raw && typeof raw === "object" && "delegationExempt" in raw && "kinds" in raw) {
			const { delegationExempt, kinds } = raw;
			if (
				delegationExempt && typeof delegationExempt === "object" &&
				"dirs" in delegationExempt && strings(delegationExempt.dirs) &&
				"extensions" in delegationExempt && strings(delegationExempt.extensions) &&
				kinds && typeof kinds === "object"
			) {
				const table = kinds as Record<string, unknown>;
				const parsedKinds = Object.fromEntries(KINDS.map(k => [k, parseKind(table[k])]));
				if (KINDS.every(k => parsedKinds[k])) {
					value = {
						exemptDirs: delegationExempt.dirs,
						exemptExtensions: delegationExempt.extensions,
						kinds: parsedKinds as Record<LeanKind, KindSpec>,
					};
				}
			}
		}
	} catch {
		value = undefined;
	}
	cached = { path, value };
	return value;
}

/** The kind an omp native tool name belongs to, per the contract. */
export function kindOfOmpTool(tool: string, contract: NativeToolContract | undefined): LeanKind | undefined {
	if (!contract) return undefined;
	return KINDS.find(k => contract.kinds[k].omp === tool);
}
