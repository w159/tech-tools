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

export interface ExplorationShellSpec {
	commands: string[];
	cases: { deny: string[]; allow: string[] };
}

export interface NativeToolContract {
	exemptDirs: string[];
	exemptExtensions: string[];
	/** Dirs agent tooling writes on its own (.serena, .lean-ctx, ...); shell dirt under them is not a model edit. Absent or malformed → [] so older contract files still load. */
	toolStateDirs: string[];
	kinds: Record<LeanKind, KindSpec>;
	/** Absent or malformed → undefined, and nothing is ever classified as exploration (fail open). */
	explorationShell?: ExplorationShellSpec;
}

function parseExplorationShell(raw: unknown): ExplorationShellSpec | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const { commands, cases } = raw as { commands?: unknown; cases?: unknown };
	if (!strings(commands) || !cases || typeof cases !== "object") return undefined;
	const { deny, allow } = cases as { deny?: unknown; allow?: unknown };
	if (!strings(deny) || !strings(allow)) return undefined;
	return { commands, cases: { deny, allow } };
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
				const rawToolState = (raw as Record<string, unknown>).ompToolStateDirs;
				const parsedKinds = Object.fromEntries(KINDS.map(k => [k, parseKind(table[k])]));
				if (KINDS.every(k => parsedKinds[k])) {
					value = {
						exemptDirs: delegationExempt.dirs,
						exemptExtensions: delegationExempt.extensions,
						toolStateDirs: strings(rawToolState) ? rawToolState : [],
						kinds: parsedKinds as Record<LeanKind, KindSpec>,
						explorationShell: parseExplorationShell((raw as Record<string, unknown>).explorationShell),
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

/** Words that make a shell command a write regardless of the command that carries them. */
const WRITE_TOKENS: Record<string, true> = { tee: true, "-delete": true, "-exec": true, "-execdir": true };

/** ctx_* equivalent per exploration command; anything unlisted (wc, stat, file, less, more, sed, awk) → ctx_shell. */
const EXPLORATION_TOOL: Record<string, string> = {
	cat: "ctx_read", head: "ctx_read", tail: "ctx_read",
	grep: "ctx_search", rg: "ctx_search", ag: "ctx_search",
	ls: "ctx_tree", tree: "ctx_tree",
	find: "ctx_glob", fd: "ctx_glob",
};

/**
 * Redirections that write nothing: fd duplications (`2>&1`, `1>&2`) and
 * redirects to exactly /dev/null (`>/dev/null`, `2>/dev/null`, `&>/dev/null`,
 * `>>/dev/null`). Stripped before the "any `>` is a write" check; whatever `>`
 * is left (`> out.txt`, `2>err.log`, `2>1`, `> /dev/nullx`) still counts as a
 * write. Twin: dispatch_tripwire._HARMLESS_REDIRECT.
 */
const HARMLESS_REDIRECT = /\d*>&\d+|(?:\d*|&)>>?\s*\/dev\/null(?![\w./-])/g;

/**
 * The exploration segments of a command as [command, ...args] token lists, or
 * undefined when it is not exploration-only. Splits the RAW text, so quoted
 * operators (`grep 'a && b'`) over-split and every such misparse lands on
 * "not exploration" — the allow direction. Twin: dispatch_tripwire._exploration_segments.
 */
function explorationSegments(command: string, contract: NativeToolContract | undefined): string[][] | undefined {
	const spec = contract?.explorationShell;
	if (!spec || typeof command !== "string") return undefined;
	const text = command.replace(HARMLESS_REDIRECT, " ");
	if (text.includes(">")) return undefined;
	const segments = text.split(/&&|\|\||[;|\n]/).map(s => s.trim().split(/\s+/)).filter(t => t[0]);
	while (segments[0]?.[0] === "cd") segments.shift();
	if (segments.length === 0) return undefined;
	for (const tokens of segments) {
		const name = tokens[0].split("/").pop() ?? "";
		if (tokens.some(t => Object.hasOwn(WRITE_TOKENS, t))) return undefined;
		const inPlaceFlag = tokens.slice(1).some(t => t.startsWith("-i"));
		let ok = spec.commands.includes(name);
		if (name === "sed") ok = !!tokens[1]?.startsWith("-n") && !inPlaceFlag;
		else if (name === "awk") ok = !inPlaceFlag;
		if (!ok) return undefined;
		tokens[0] = name;
	}
	return segments;
}

/**
 * True when the command only reads/inspects: every segment is an exploration
 * command (contracts/native-tools.json explorationShell.commands, `sed -n`,
 * `awk`) and nothing writes. The contract argument defaults to the shared file
 * only when OMITTED; an explicit undefined (unreadable contract) → false, fail open.
 */
export function isExplorationShell(command: string, ...contract: [NativeToolContract | undefined?]): boolean {
	return explorationSegments(command, contract.length ? contract[0] : loadNativeTools()) !== undefined;
}

/** The lean-ctx replacement a session can reach right now (structurally index.ts LeanReplacement). */
export type ExplorationRoute = { via: "tool"; name: string } | { via: "device"; device: string };

/**
 * The ctx_* tool an exploration-only bash command maps to: ctx_read
 * (cat/head/tail), ctx_search (grep/rg/ag), ctx_tree (ls/tree), ctx_glob
 * (find/fd), else ctx_shell; a mixed pipeline → ctx_shell. undefined when the
 * command is not exploration-only. Twin: dispatch_tripwire._exploration_deny.
 */
export function explorationTool(command: string, ...contract: [NativeToolContract | undefined?]): string | undefined {
	const segments = explorationSegments(command, contract.length ? contract[0] : loadNativeTools());
	if (!segments) return undefined;
	const tools = new Set(segments.map(t => EXPLORATION_TOOL[t[0]] ?? "ctx_shell"));
	return tools.size === 1 ? [...tools][0] : "ctx_shell";
}

/**
 * Deny text for an exploration-only bash command, naming the ctx_* equivalent
 * (see explorationTool) and how the session reaches lean-ctx. `route` must be
 * the route to THAT tool. undefined when the command is not exploration-only
 * (caller allows).
 */
export function explorationDenyReason(
	command: string,
	route: ExplorationRoute,
	...contract: [NativeToolContract | undefined?]
): string | undefined {
	const tool = explorationTool(command, ...contract);
	if (!tool) return undefined;
	const how =
		route.via === "tool"
			? `call ${route.name} directly with JSON args`
			: `write JSON args to the device ${route.device}`;
	return `Atlas enforcement: this bash command only reads files, so use lean-ctx ${tool} instead (${how}; lean-ctx is reachable in this session). Native bash stays available for tests, git, builds and anything that writes.`;
}
