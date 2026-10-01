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
import * as nodePath from "node:path";

export const MANDATES_PATH = nodePath.resolve(import.meta.dir, "..", "contracts", "mandates.json");

/** The shared mandate contract (also read by the Python hooks); undefined when unreadable. */
export function loadMandates(path: string = MANDATES_PATH): { commitNudge: string; recall: string } | undefined {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object" || !("commitNudge" in parsed) || !("recall" in parsed)) return undefined;
		const { commitNudge, recall } = parsed;
		if (typeof commitNudge !== "string" || typeof recall !== "string") return undefined;
		return { commitNudge, recall };
	} catch {
		return undefined;
	}
}

/** The recall line's stable prefix, used as the idempotency marker. */
export const RECALL_MARKER = "Recall first:";

const CLAUDE_MEM_SERVER = /claude[-_]?mem|mcp[-_]?search/i;

/** The claude-mem search route callable now: a bare tool or an xd:// device (needs `write`). */
export function claudeMemRoute(active: string[] | undefined): string | undefined {
	if (!Array.isArray(active)) return undefined;
	if (!active.includes("write")) return undefined;
	for (const name of active) {
		if (!name.startsWith("mcp__") || !name.toLowerCase().endsWith("_search")) continue;
		const server = name.slice("mcp__".length, -"_search".length);
		if (CLAUDE_MEM_SERVER.test(server)) return `xd://${name}`;
	}
	return undefined;
}


const SEGMENT_SPLIT = /&&|\|\||;|\|/;
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const GIT_EQ_OPTS = ["--git-dir=", "--work-tree=", "--exec-path=", "--namespace="];

/** Minimal shlex-like split: whitespace-separated, single/double quotes group. */
function shellWords(segment: string): string[] {
	const words: string[] = [];
	const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
	for (let m = re.exec(segment); m; m = re.exec(segment)) words.push(m[1] ?? m[2] ?? m[3]);
	return words;
}

/** Parse contract mirrored from hooks/bash_advisor.py `_match_git_commit`. */
export function matchGitCommit(command: string): boolean {
	for (const segment of (command ?? "").split(SEGMENT_SPLIT)) {
		let tokens = shellWords(segment);
		while (tokens.length && ENV_ASSIGN.test(tokens[0])) tokens = tokens.slice(1);
		if (!tokens.length || !(tokens[0] === "git" || tokens[0].endsWith("/git"))) continue;
		let i = 1;
		while (i < tokens.length) {
			const tok = tokens[i];
			if (tok === "-C" || tok === "-c") i += 2;
			else if (tok === "--" || GIT_EQ_OPTS.some(p => tok.startsWith(p))) i += 1;
			else break;
		}
		if (tokens[i] === "commit") return true;
	}
	return false;
}

export interface MandateDeps {
	activeTools(): string[] | undefined;
	env?: Record<string, string | undefined>;
	mandatesPath?: string;
}

export function registerMandates(pi: Pick<ExtensionAPI, "on">, deps: MandateDeps): void {
	let ponytailListed = false;
	let commitNudged = false;
	const off = () => (deps.env ?? process.env).ATLAS_MANDATES === "off";
	const reset = () => {
		ponytailListed = false;
		commitNudged = false;
	};
	pi.on("session_start", reset);
	pi.on("session_switch", reset);

	pi.on("before_agent_start", (event, ctx) => {
		try {
			if (ctx.agent.kind !== "main" || off()) return undefined;
			const base = Array.isArray(event.systemPrompt) ? event.systemPrompt : [];
			ponytailListed = base.some(entry => typeof entry === "string" && entry.includes("ponytail-review"));
			if (base.some(entry => typeof entry === "string" && entry.includes(RECALL_MARKER))) return undefined;
			let active: string[] | undefined;
			try {
				active = deps.activeTools();
			} catch {
				return undefined;
			}
			const route = claudeMemRoute(active);
			const contract = loadMandates(deps.mandatesPath);
			if (!route || !contract) return undefined;
			return { systemPrompt: [...base, contract.recall.replace("{route}", `write JSON args to ${route}`)] };
		} catch {
			return undefined; // fail open
		}
	});

	pi.on("tool_call", (event, ctx) => {
		try {
			if ((event.toolName ?? "").toLowerCase() !== "bash" || ctx.agent.kind !== "main") return undefined;
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
