/**
 * Atlas tool mandates for omp — twins of the Claude Code hooks:
 *
 * Text and the git-commit parse cases live in contracts/mandates.json, shared
 * with the Python hooks.
 *
 * 1. claude-mem recall (hooks/session_boot.py recall_mandate): the main
 *    session's system prompt carries one "recall first" line naming the
 *    claude-mem search route that is callable RIGHT NOW (getActiveTools).
 *    Absent route → nothing.
 * 2. ponytail before commit (hooks/bash_advisor.py COMMIT_NUDGE): a main-thread
 *    `bash` running `git commit` gets a one-time additionalContext nudge, armed
 *    only when the ponytail-review skill is listed in the session's system
 *    prompt (omp lists available skills there). Same parse contract as
 *    bash_advisor._match_git_commit.
 *
 * Kill switch: ATLAS_MANDATES=off (exact string, as in Python). Fail open.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";

import { gatesArmed } from "./scope";
import { pluginRoot } from "./plugin-path";
import { atlasKnob } from "./knobs";

/** The shared mandate contract (also read by the Python hooks). */
export interface Mandates {
	commitNudge: string;
	recall: string;
	/** Recall-gate block reason; `{route}` and `{example}` are filled per harness. */
	recallGate: string;
	recallGateExample: string;
}

/** Undefined when the contract is unreadable or lacks a field. */
export function loadMandates(path: string = nodePath.join(pluginRoot(), "contracts", "mandates.json")): Mandates | undefined {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object") return undefined;
		const { commitNudge, recall, recallGate, recallGateExample } = parsed as Record<string, unknown>;
		if (typeof commitNudge !== "string" || typeof recall !== "string") return undefined;
		if (typeof recallGate !== "string" || typeof recallGateExample !== "string") return undefined;
		return { commitNudge, recall, recallGate, recallGateExample };
	} catch {
		return undefined;
	}
}

/** The recall line's stable prefix, used as the idempotency marker. */
export const RECALL_MARKER = "Recall first:";

// Anchored like hooks/recall_gate.py _MEM_TOOL: the server part of the tool name must itself be
// claude-mem / mcp-search (optionally behind Claude Code's `plugin_` prefix), so a foreign
// server whose tool is merely named like one (`mcp__evil__claude_mem_dump`) never counts.
const CLAUDE_MEM_SERVER = /^mcp__(?:plugin_)?(?:claude[-_]?mem|mcp[-_]?search)(?:[-_]|$)/i;

/** The claude-mem search route callable now: a bare tool or an xd:// device (needs `write`). */
export function claudeMemRoute(active: string[] | undefined): string | undefined {
	if (!Array.isArray(active)) return undefined;
	if (!active.includes("write")) return undefined;
	for (const name of active) {
		if (!name.startsWith("mcp__") || !name.toLowerCase().endsWith("_search")) continue;
		if (CLAUDE_MEM_SERVER.test(name)) return `xd://${name}`;
	}
	return undefined;
}

/** Tools that neither trigger nor satisfy the recall gate (omp `todo`, Claude Code `TodoWrite`). */
const RECALL_EXEMPT: Record<string, true> = { todo: true, todowrite: true };

/**
 * True when a tool call IS the claude-mem recall: a bare claude-mem tool, or a `write`
 * to an `xd://mcp__` claude-mem device (`path`, or `file_path` as Claude Code names it).
 */
function satisfiesRecall(toolName: string, input: unknown): boolean {
	if (CLAUDE_MEM_SERVER.test(toolName)) return true;
	if (toolName.toLowerCase() !== "write" || !input || typeof input !== "object") return false;
	const { path, file_path: filePath } = input as { path?: unknown; file_path?: unknown };
	return [path, filePath].some(p => typeof p === "string" && p.startsWith("xd://mcp__") && CLAUDE_MEM_SERVER.test(p.slice("xd://".length)));
}

const SEGMENT_SPLIT = /&&|\|\||[;|&()`\n]/g;
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** git global options that consume the NEXT token as their value (`--opt=v` forms are covered by the generic "starts with -" rule). */
const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env", "--attr-source"]);
/** Prefix wrappers that run their remaining argv; value = flags that take a value. */
const WRAPPERS = new Map<string, Set<string>>([
	["env", new Set(["-u", "-C", "-S", "--unset", "--chdir", "--split-string"])],
	["time", new Set(["-f", "-o", "--format", "--output"])],
	["nohup", new Set()],
	["command", new Set()],
	["exec", new Set(["-a"])],
	["builtin", new Set()],
	["eval", new Set()],
	["setsid", new Set()],
	["nice", new Set(["-n"])],
	["xargs", new Set(["-I", "-n", "-L", "-P", "-d", "-E", "-s", "-a", "-l"])],
	["sudo", new Set(["-u", "-g", "-h", "-p", "-C", "-r", "-t", "-U", "-D", "-R", "-T"])],
]);
const LEADERS = new Set(["then", "do", "else", "elif", "if", "while", "until", "!", "{", "}"]);
const SEPARATOR_CHARS = new Set(";&|()`\n");
const PUNCTUATION_CHARS = new Set(";&|()<>`\n");
/** Bounds from bash_advisor.py: only the head of each segment is tokenised and only the first segments are visited. */
const SEGMENT_HEAD = 2048;
const MAX_SEGMENTS = 4096;
const SHLEX_MAX = 16384;
const SHELL_C = /\b(?:ba|z|da|k)?sh\s+(?:-[A-Za-z]*\s+)*-[A-Za-z]*c[A-Za-z]*\s+(['"])(.*?)\1/gs;
const EVAL_Q = /\beval\s+(['"])(.*?)\1/gs;

/**
 * Port of Python's shlex (posix mode, whitespace_split). `punct` mimics `punctuation_chars=";&|()<>`\n"`
 * with `#` as a comment character (bash_advisor builds shlex.shlex directly); `shlex.split` is the other
 * mode (no punctuation, no comments, newline is whitespace). Throws like Python's ValueError on an
 * unbalanced quote or a trailing backslash.
 */
function shlexTokens(text: string, punct: boolean): string[] {
	const whitespace = punct ? " \t\r" : " \t\r\n";
	const tokens: string[] = [];
	let token = "";
	let quoted = false;
	let state: string = " ";
	let escapedState = "";
	const isPunct = (c: string) => punct && PUNCTUATION_CHARS.has(c);
	const skipComment = (from: number): number => {
		const nl = text.indexOf("\n", from);
		return nl < 0 ? text.length : nl + 1;
	};
	const emit = () => {
		if (token !== "" || quoted) tokens.push(token);
		token = "";
		quoted = false;
	};
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (state === " ") {
			if (whitespace.includes(c)) continue;
			if (punct && c === "#") i = skipComment(i + 1) - 1;
			else if (c === "\\") ((escapedState = "a"), (state = c));
			else if (c === "'" || c === '"') ((state = c), (quoted = true));
			else if (isPunct(c)) ((token = c), (state = "c"));
			else ((token = c), (state = "a"));
		} else if (state === "a" || state === "c") {
			if (whitespace.includes(c)) {
				state = " ";
				emit();
			} else if (punct && c === "#") {
				state = " ";
				i = skipComment(i + 1) - 1;
				emit();
			} else if (state === "c") {
				if (isPunct(c)) token += c;
				else {
					i -= 1; // push the char back; it starts the next token
					state = " ";
					emit();
				}
			} else if (c === "'" || c === '"') ((state = c), (quoted = true));
			else if (c === "\\") ((escapedState = "a"), (state = c));
			else if (isPunct(c)) {
				i -= 1;
				state = " ";
				emit();
			} else token += c;
		} else if (state === "\\") {
			if ((escapedState === "'" || escapedState === '"') && c !== state && c !== escapedState) token += state;
			token += c;
			state = escapedState;
		} else {
			// inside a quote (state is the quote character)
			quoted = true;
			if (c === state) state = "a";
			else if (c === "\\" && state === '"') ((escapedState = state), (state = c));
			else token += c;
		}
	}
	if (state === "'" || state === '"') throw new Error("No closing quotation");
	if (state === "\\") throw new Error("No escaped character");
	emit();
	return tokens;
}

/** Fallback segmentation (bounded, quote-unaware regex split). */
function* regexSegments(command: string): Generator<string[]> {
	let last = 0;
	let splits = 0;
	const segments: string[] = [];
	for (const m of command.matchAll(SEGMENT_SPLIT)) {
		if (splits >= MAX_SEGMENTS) break;
		segments.push(command.slice(last, m.index));
		last = (m.index ?? 0) + m[0].length;
		splits += 1;
	}
	segments.push(command.slice(last));
	for (const raw of segments) {
		const segment = raw.slice(0, SEGMENT_HEAD);
		if (!segment.includes("git")) continue;
		try {
			yield shlexTokens(segment, false);
		} catch {
			yield segment.split(/\s+/).filter(Boolean);
		}
	}
}

/** One argv token list per shell segment; segments end at ; & | && || ( ) ` and newlines. */
function* commandSegments(command: string): Generator<string[]> {
	if (command.length > SHLEX_MAX) return yield* regexSegments(command);
	let tokens: string[];
	try {
		tokens = shlexTokens(command, true);
	} catch {
		return yield* regexSegments(command);
	}
	let current: string[] = [];
	for (const tok of tokens) {
		if ([...tok].every(ch => SEPARATOR_CHARS.has(ch))) {
			if (current.length) yield current;
			current = [];
		} else current.push(tok);
	}
	if (current.length) yield current;
}

/** Drop leading NAME=val, shell keywords and prefix wrappers with their flags; return the real argv. */
function stripWrappers(input: string[]): string[] {
	let tokens = input;
	while (tokens.length) {
		const tok = tokens[0];
		if (ENV_ASSIGN.test(tok) || LEADERS.has(tok)) {
			tokens = tokens.slice(1);
			continue;
		}
		const valueFlags = WRAPPERS.get(tok.slice(tok.lastIndexOf("/") + 1));
		if (!valueFlags) break;
		const name = tok.slice(tok.lastIndexOf("/") + 1);
		tokens = tokens.slice(1);
		if (name === "command" && (tokens[0] === "-v" || tokens[0] === "-V")) return [];
		while (tokens.length && tokens[0].startsWith("-")) {
			const flag = tokens[0];
			tokens = tokens.slice(1);
			if (flag === "--") break;
			if (valueFlags.has(flag) && tokens.length) tokens = tokens.slice(1);
		}
	}
	return tokens;
}

/** The git subcommand each shell segment runs (and those of `sh -c` / `eval` quoted scripts, two levels deep). */
function gitSubcommands(command: string, depth = 0): string[] {
	const out: string[] = [];
	if (!command || !command.includes("git")) return out;
	if (depth < 2) {
		const head = command.slice(0, SEGMENT_HEAD * 4);
		for (const re of [SHELL_C, EVAL_Q]) for (const m of head.matchAll(re)) out.push(...gitSubcommands(m[2], depth + 1));
	}
	for (const raw of commandSegments(command)) {
		const tokens = stripWrappers(raw);
		if (!tokens.length || !(tokens[0] === "git" || tokens[0].endsWith("/git"))) continue;
		let i = 1;
		while (i < tokens.length) {
			if (GIT_VALUE_OPTS.has(tokens[i])) i += 2;
			else if (tokens[i].startsWith("-")) i += 1;
			else break;
		}
		if (i < tokens.length) out.push(tokens[i]);
	}
	return out;
}

/** Parse contract mirrored from hooks/bash_advisor.py `_match_git_commit` (pinned by a parity test). */
export function matchGitCommit(command: string): boolean {
	return gitSubcommands(command ?? "").includes("commit");
}

/** Python's `re.sub(r"[^A-Za-z0-9_.-]", "_", id)`: the marker filename scheme shared with hooks/recall_gate.py. */
function markerPath(sessionId: string, dir: string = defaultMarkerDir()): string {
	return nodePath.join(dir, `recall-${sessionId.replace(/[^A-Za-z0-9_.-]/g, "_")}`);
}

/** Same directory as hooks/recall_gate.py GATE_MARKER_DIR, so both gates share one source of truth. */
function defaultMarkerDir(): string {
	return nodePath.join(tmpdir(), "atlas-recall-gate");
}

/** The handler context's session id, or undefined (then the gate behaves as without persistence). */
function sessionIdOf(ctx: unknown): string | undefined {
	const id = (ctx as { sessionManager?: { getSessionId?: () => unknown } } | undefined)?.sessionManager?.getSessionId?.();
	return typeof id === "string" && id.trim() !== "" ? id : undefined;
}

/** True when this session id already made its claude-mem call; any fs error reads as "no marker". */
function markerExists(sessionId: string, dir?: string): boolean {
	try {
		return fs.existsSync(markerPath(sessionId, dir));
	} catch {
		return false;
	}
}

/** Record the recall (idempotent, O_CREAT|O_EXCL like the Python twin); fails open on any fs error. */
function markRecalled(sessionId: string, dir: string = defaultMarkerDir()): void {
	try {
		fs.mkdirSync(dir, { recursive: true });
		fs.closeSync(fs.openSync(markerPath(sessionId, dir), "wx"));
	} catch {
		// EEXIST means already recorded; any other fs error must not break the turn
	}
}

export interface MandateDeps {
	activeTools(): string[] | undefined;
	env?: Record<string, string | undefined>;
	mandatesPath?: string;
	/** Per-session recall markers directory; tests point it at a temp dir (Python: GATE_MARKER_DIR). */
	gateMarkerDir?: string;
}

export function registerMandates(pi: Pick<ExtensionAPI, "on">, deps: MandateDeps): void {
	let ponytailListed = false;
	let commitNudged = false;
	let recalled = false; // true only once a real claude-mem call happened; a denial never sets it
	/** The recall line once rendered, re-served byte for byte so the provider's prompt cache is not rewritten when a route changes mid-session. Absence is never stored. */
	let recallLine: string | undefined;
	const off = () => atlasKnob("ATLAS_MANDATES", deps.env ?? process.env) === "off";
	const reset = () => {
		ponytailListed = false;
		commitNudged = false;
		recalled = false;
		recallLine = undefined;
	};
	pi.on("session_start", reset);
	pi.on("session_switch", reset);

	pi.on("before_agent_start", (event, ctx) => {
		try {
			if (ctx.agent.kind !== "main" || off() || !gatesArmed(ctx.cwd, deps.env)) return undefined;
			const base = Array.isArray(event.systemPrompt) ? event.systemPrompt : [];
			ponytailListed = base.some(entry => typeof entry === "string" && entry.includes("ponytail-review"));
			if (base.some(entry => typeof entry === "string" && entry.includes(RECALL_MARKER))) return undefined;
			if (recallLine === undefined) {
				let active: string[] | undefined;
				try {
					active = deps.activeTools();
				} catch {
					return undefined;
				}
				const route = claudeMemRoute(active);
				const contract = loadMandates(deps.mandatesPath);
				if (!route || !contract) return undefined;
				recallLine = contract.recall.replace("{route}", `write JSON args to ${route}`);
			}
			return { systemPrompt: [...base, recallLine] };
		} catch {
			return undefined; // fail open
		}
	});

	pi.on("tool_call", (event, ctx) => {
		try {
			if (ctx.agent.kind !== "main" || off() || !gatesArmed(ctx.cwd, deps.env)) return undefined;
			const toolName = event.toolName ?? "";
			if (!recalled && !Object.hasOwn(RECALL_EXEMPT, toolName.toLowerCase())) {
				const sessionId = sessionIdOf(ctx);
				if (satisfiesRecall(toolName, event.input)) {
					recalled = true; // the recall happened; nothing to block from here on
					if (sessionId) markRecalled(sessionId, deps.gateMarkerDir);
					return undefined;
				}
				if (sessionId && markerExists(sessionId, deps.gateMarkerDir)) {
					recalled = true; // same session id recalled before a resume: stay satisfied
					return undefined;
				}
				let active: string[] | undefined;
				try {
					active = deps.activeTools();
				} catch {
					return undefined; // cannot prove the replacement is reachable: stay unarmed
				}
				const route = claudeMemRoute(active);
				const contract = loadMandates(deps.mandatesPath);
				if (route && contract) {
					// still unsatisfied: the gate stays armed and denies the next call too
					return {
						block: true,
						reason: contract.recallGate.replace("{route}", `write JSON args to ${route}`).replace("{example}", contract.recallGateExample),
					};
				}
			}
			if (toolName.toLowerCase() !== "bash") return undefined;
			if (commitNudged || !ponytailListed || off()) return undefined;
			const input: unknown = event.input;
			const command = input && typeof input === "object" && "command" in input ? input.command : undefined;
			if (typeof command !== "string" || !matchGitCommit(command)) return undefined;
			const contract = loadMandates(deps.mandatesPath);
			if (!contract) return undefined;
			commitNudged = true;
			return { additionalContext: contract.commitNudge };
		} catch {
			return undefined; // fail open
		}
	});
}
