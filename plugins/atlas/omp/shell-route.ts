/**
 * Shell routing for omp sessions: parity with the lean-ctx Claude Code plugin's
 * PreToolUse hook, which rewrites EVERY Bash call to
 * `<lean-ctx> -c '<original command>'` so output is compressed. omp has no such
 * hook, so this registers a `tool_call` handler that revises the bash `input`
 * the same way (last handler's `input` wins in omp; revisions are not seen by
 * sibling handlers). One registration covers main and sub sessions: omp
 * rebinds the extension per session and `tool_call` fires in both.
 *
 * Routing happens only when ALL hold: the binary resolves; a lean-ctx route is
 * active in this session (proof lean-ctx is set up here); no kill switch
 * (LEAN_CTX_DISABLED, ATLAS_LEAN_SHELL=off); the call is not a pty session; the
 * command is non-empty and not already routed. Everything else — and any
 * failure — returns undefined so bash runs untouched (fail open).
 */
import { accessSync, constants, statSync } from "node:fs";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

type Env = Record<string, string | undefined>;

export interface ShellRouteDeps {
	/** Absolute path of the lean-ctx binary, or undefined when unavailable. */
	leanCtxBin(): string | undefined;
	/** Names callable in the session right now; undefined = unknown (no routing). */
	activeTools(): string[] | undefined;
	/** Environment snapshot for the kill switches; default process.env. */
	env?: Env;
}

const LEAN_NAME = "lean-ctx";

/** True when the command already begins with the lean-ctx binary path or bare name. */
function startsWithLeanCtx(command: string, bin: string): boolean {
	const c = command.trim();
	if (c === LEAN_NAME || c.startsWith(`${LEAN_NAME} `)) return true;
	return bin !== "" && (c === bin || c.startsWith(`${bin} `));
}

/**
 * `<bin> -c '<command>'` with POSIX single-quote escaping (' -> '\''). Commands
 * already starting with lean-ctx pass through unchanged, so wrapping is idempotent.
 */
export function wrapCommand(command: string, bin: string): string {
	if (command === "" || bin === "" || startsWithLeanCtx(command, bin)) return command;
	return `${bin} -c '${command.replaceAll("'", "'\\''")}'`;
}

/** Executable regular file at path? */
function isExecutableFile(path: string): boolean {
	try {
		if (!statSync(path).isFile()) return false;
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** Walk env.PATH for an executable named `name`; undefined when absent. */
export function findExecutableOnPath(name: string, env: Env = process.env): string | undefined {
	for (const dir of (env.PATH ?? "").split(":")) {
		if (dir === "") continue;
		const candidate = `${dir}/${name}`;
		if (isExecutableFile(candidate)) return candidate;
	}
	return undefined;
}

/** Resolve `lean-ctx` on PATH (Bun.which when available, else a PATH walk); undefined when absent. */
export function defaultLeanCtxBin(env: Env = process.env): string | undefined {
	try {
		const bun = (globalThis as { Bun?: { which(command: string, options?: { PATH?: string }): string | null } }).Bun;
		if (bun) return bun.which(LEAN_NAME, { PATH: env.PATH ?? "" }) ?? undefined;
	} catch {
		// fall through to the manual walk
	}
	return findExecutableOnPath(LEAN_NAME, env);
}

/** A lean-ctx MCP route (minted tool/device name) or the bare ctx_shell tool is callable. */
function leanRouteActive(names: string[] | undefined): boolean {
	return names?.some(name => /^mcp__lean[-_]?ctx_/.test(name) || name === "ctx_shell") === true;
}

export function registerShellRoute(pi: Pick<ExtensionAPI, "on">, deps: ShellRouteDeps): void {
	pi.on("tool_call", event => {
		try {
			if (event.toolName !== "bash") return undefined;
			const input = event.input as Record<string, unknown> | undefined;
			const command = input?.command;
			if (input === undefined || typeof command !== "string" || command.trim() === "") return undefined;
			if (input.pty === true) return undefined;
			const env = deps.env ?? process.env;
			if (env.LEAN_CTX_DISABLED || env.ATLAS_LEAN_SHELL === "off") return undefined;
			const bin = deps.leanCtxBin();
			if (!bin || startsWithLeanCtx(command, bin)) return undefined;
			if (!leanRouteActive(deps.activeTools())) return undefined;
			return { input: { ...input, command: wrapCommand(command, bin) } };
		} catch {
			return undefined; // fail open: bash runs unrouted
		}
	});
}
