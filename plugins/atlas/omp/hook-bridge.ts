/**
 * Claude Code hook bridge for omp.
 *
 * hooks/hooks.json is the single wiring source for the Python hooks. This
 * module reads it and runs the hooks that contracts/hook-bridge.json marks as
 * bridgeable, translating omp events into Claude Code hook payloads:
 *
 *   SessionStart     — first main-session before_agent_start; its
 *                      additionalContext is appended to every main prompt
 *   UserPromptSubmit — each main-session before_agent_start (prompt text)
 *   PreToolUse       — tool_call (main and subagents, as in Claude Code);
 *                      permissionDecision "deny" blocks the call
 *   PostToolUse      — tool_result; additionalContext / block reason is
 *                      returned as additionalContext
 *
 * Tool names translate through contracts/tool-names.json (omp → every Claude
 * name that maps to it), so hooks.json matchers apply unchanged. Hooks run via
 * /bin/sh with CLAUDE_PLUGIN_ROOT set, ATLAS_HARNESS=omp and
 * ATLAS_MANDATES=off (omp/mandates.ts owns mandates). Every failure, timeout
 * or unparseable output allows. Each hook is killed at min(its hooks.json
 * timeout, ATLAS_BRIDGE_HOOK_TIMEOUT_S, default 25 s) and all hooks of one
 * before_agent_start share omp's 30 s handler budget. Kill switch:
 * ATLAS_HOOK_BRIDGE=off.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { runCapture } from "./proc";

const PLUGIN_ROOT = nodePath.resolve(import.meta.dir, "..");
export const HOOKS_JSON = nodePath.join(PLUGIN_ROOT, "hooks", "hooks.json");
export const BRIDGE_CONTRACT = nodePath.join(PLUGIN_ROOT, "contracts", "hook-bridge.json");
export const TOOL_NAMES = nodePath.join(PLUGIN_ROOT, "contracts", "tool-names.json");
const DEFAULT_TIMEOUT_S = 60;
/** Default per-hook hard cap (s); ATLAS_BRIDGE_HOOK_TIMEOUT_S overrides. omp cuts a handler at 30 s. */
export const DEFAULT_HOOK_CAP_S = 25;
/** omp's EXTENSION_HANDLER_TIMEOUT_MS (extensions/runner.ts): all hooks of one before_agent_start share it. */
export const HANDLER_BUDGET_MS = 30_000;
export const SESSION_MARKER = "<!-- atlas-session-start -->";

export type ClaudeEvent = "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse";
export interface BridgedHook {
	event: ClaudeEvent;
	matcher: RegExp | undefined;
	command: string;
	timeoutMs: number;
}

export interface HookOutput {
	deny?: string;
	context?: string;
}

function readJson(path: string): unknown {
	return JSON.parse(fs.readFileSync(path, "utf8"));
}

/** Bridgeable hook commands from hooks.json, filtered by the bridge contract. */
export function loadBridgedHooks(hooksPath: string = HOOKS_JSON, contractPath: string = BRIDGE_CONTRACT): BridgedHook[] {
	try {
		const contract = readJson(contractPath);
		if (!contract || typeof contract !== "object" || !("bridged" in contract) || !Array.isArray(contract.bridged)) return [];
		const allowed = new Set(contract.bridged.filter((s: unknown): s is string => typeof s === "string"));
		const root = readJson(hooksPath);
		if (!root || typeof root !== "object" || !("hooks" in root) || !root.hooks || typeof root.hooks !== "object") return [];
		const out: BridgedHook[] = [];
		for (const [event, groups] of Object.entries(root.hooks as Record<string, unknown>)) {
			if (!["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"].includes(event) || !Array.isArray(groups)) continue;
			for (const group of groups) {
				if (!group || typeof group !== "object" || !("hooks" in group) || !Array.isArray(group.hooks)) continue;
				const rawMatcher = "matcher" in group && typeof group.matcher === "string" ? group.matcher : "";
				const matcher = rawMatcher && rawMatcher !== "*" ? new RegExp(`^(?:${rawMatcher})$`) : undefined;
				for (const hook of group.hooks) {
					if (!hook || typeof hook !== "object" || !("command" in hook) || typeof hook.command !== "string") continue;
					const script = /([\w.-]+\.py)/.exec(hook.command)?.[1];
					if (!script || !allowed.has(script)) continue;
					const timeout = "timeout" in hook && typeof hook.timeout === "number" ? hook.timeout : DEFAULT_TIMEOUT_S;
					out.push({ event: event as ClaudeEvent, matcher, command: hook.command, timeoutMs: timeout * 1000 });
				}
			}
		}
		return out;
	} catch {
		return [];
	}
}

/** omp tool name → every Claude tool name mapping to it (contracts/tool-names.json); itself when unmapped. */
export function claudeNamesFor(ompTool: string, namesPath: string = TOOL_NAMES): string[] {
	try {
		const parsed = readJson(namesPath);
		if (!parsed || typeof parsed !== "object" || !("claudeToOmp" in parsed) || !parsed.claudeToOmp || typeof parsed.claudeToOmp !== "object") return [ompTool];
		const names = Object.entries(parsed.claudeToOmp as Record<string, unknown>)
			.filter(([claude, omp]) => omp === ompTool && /^[A-Z]\w*$/.test(claude))
			.map(([claude]) => claude);
		return names.length ? names : [ompTool];
	} catch {
		return [ompTool];
	}
}

/** Parse a Claude Code hook's stdout into a deny reason and/or context text. */
export function parseHookOutput(stdout: string): HookOutput {
	const text = stdout.trim();
	if (!text) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {};
	}
	if (!parsed || typeof parsed !== "object") return {};
	const out: HookOutput = {};
	const spec = "hookSpecificOutput" in parsed ? parsed.hookSpecificOutput : undefined;
	if (spec && typeof spec === "object") {
		if ("permissionDecision" in spec && spec.permissionDecision === "deny") {
			out.deny = "permissionDecisionReason" in spec && typeof spec.permissionDecisionReason === "string" ? spec.permissionDecisionReason : "denied by atlas hook";
		}
		if ("additionalContext" in spec && typeof spec.additionalContext === "string" && spec.additionalContext.trim()) out.context = spec.additionalContext;
	}
	if ("decision" in parsed && parsed.decision === "block" && "reason" in parsed && typeof parsed.reason === "string") {
		out.context = [out.context, parsed.reason].filter(Boolean).join("\n");
	}
	return out;
}

/** Hard per-hook cap in ms: min(the hooks.json timeout, ATLAS_BRIDGE_HOOK_TIMEOUT_S or the 25 s default). */
export function hookTimeoutMs(configuredMs: number, env: Record<string, string | undefined> = process.env): number {
	const requested = Number(env.ATLAS_BRIDGE_HOOK_TIMEOUT_S);
	const capS = env.ATLAS_BRIDGE_HOOK_TIMEOUT_S && Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_HOOK_CAP_S;
	return Math.min(configuredMs, capS * 1000);
}

export type HookRunner = (command: string, payload: Record<string, unknown>, timeoutMs: number) => Promise<string>;

/**
 * Real runner: /bin/sh -c <command>, payload on stdin, stdout captured; any
 * failure → "". Transport (temp files, own process group, timeout kill) lives
 * in ./proc.
 */
export const runHook: HookRunner = async (command, payload, timeoutMs) => {
	try {
		const { stdout } = await runCapture(["/bin/sh", "-c", command], {
			input: JSON.stringify(payload),
			timeoutMs,
			env: { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ATLAS_HARNESS: "omp", ATLAS_MANDATES: "off" },
		});
		return stdout;
	} catch {
		return "";
	}
};

/** Claude-shaped tool_input: omp `path` becomes an absolute `file_path` too. */
function claudeToolInput(input: unknown, cwd: string): Record<string, unknown> {
	const base: Record<string, unknown> = input && typeof input === "object" ? { ...(input as Record<string, unknown>) } : {};
	const first = typeof base.path === "string" ? base.path : Array.isArray(base.paths) && typeof base.paths[0] === "string" ? base.paths[0] : undefined;
	if (first && !first.includes("://") && base.file_path === undefined) base.file_path = nodePath.resolve(cwd, first);
	return base;
}

export interface BridgeDeps {
	hooks?: BridgedHook[];
	run?: HookRunner;
	namesPath?: string;
	env?: Record<string, string | undefined>;
}

export function registerHookBridge(pi: Pick<ExtensionAPI, "on">, deps: BridgeDeps = {}): void {
	let hooks: BridgedHook[] | undefined = deps.hooks;
	const all = () => (hooks ??= loadBridgedHooks());
	const run = deps.run ?? runHook;
	const off = () => (deps.env ?? process.env).ATLAS_HOOK_BRIDGE === "off";
	let sessionContext: Promise<string> | undefined;
	const reset = () => {
		sessionContext = undefined;
	};
	pi.on("session_start", reset);
	pi.on("session_switch", reset);

	/** Runs matching hooks in order; each gets min(its capped timeout, what is left before `deadline`). */
	const runAll = async (event: ClaudeEvent, toolNames: string[] | undefined, payload: Record<string, unknown>, deadline: number = Date.now() + HANDLER_BUDGET_MS): Promise<HookOutput[]> => {
		const selected = all().filter(h => h.event === event && (!h.matcher || !toolNames || toolNames.some(n => h.matcher?.test(n))));
		const outputs: HookOutput[] = [];
		for (const hook of selected) {
			const remaining = deadline - Date.now();
			if (remaining <= 0) break; // out of handler budget: skip the rest (fail open)
			const timeoutMs = Math.min(hookTimeoutMs(hook.timeoutMs, deps.env ?? process.env), remaining);
			const out = parseHookOutput(await run(hook.command, payload, timeoutMs));
			outputs.push(out);
			if (out.deny) break; // first deny wins, as in Claude Code
		}
		return outputs;
	};
	const join = (outs: HookOutput[]) => outs.map(o => o.context).filter((c): c is string => Boolean(c)).join("\n\n");
	const sessionIdOf = (ctx: { sessionManager?: { getSessionId?: () => unknown } }) => {
		try {
			const id = ctx.sessionManager?.getSessionId?.();
			return typeof id === "string" ? id : "";
		} catch {
			return "";
		}
	};

	pi.on("before_agent_start", async (event, ctx) => {
		try {
			if (ctx.agent.kind !== "main" || off()) return undefined;
			const base = Array.isArray(event.systemPrompt) ? event.systemPrompt : [];
			const common = { session_id: sessionIdOf(ctx), cwd: ctx.cwd };
			const deadline = Date.now() + HANDLER_BUDGET_MS;
			sessionContext ??= runAll("SessionStart", undefined, { ...common, hook_event_name: "SessionStart", source: "startup" }, deadline).then(join);
			const startText = await sessionContext;
			const promptText = join(await runAll("UserPromptSubmit", undefined, { ...common, hook_event_name: "UserPromptSubmit", prompt: event.prompt ?? "" }, deadline));
			const additions: string[] = [];
			if (startText && !base.some(e => typeof e === "string" && e.includes(SESSION_MARKER))) additions.push(`${SESSION_MARKER}\n${startText}`);
			if (promptText) additions.push(promptText);
			return additions.length ? { systemPrompt: [...base, ...additions] } : undefined;
		} catch {
			return undefined; // fail open
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		try {
			if (off()) return undefined;
			const tool = event.toolName ?? "";
			const names = claudeNamesFor(tool, deps.namesPath);
			const outs = await runAll("PreToolUse", names, {
				hook_event_name: "PreToolUse",
				session_id: sessionIdOf(ctx),
				cwd: ctx.cwd,
				tool_name: names[0],
				tool_input: claudeToolInput(event.input, ctx.cwd),
			});
			const deny = outs.find(o => o.deny)?.deny;
			if (deny) return { block: true, reason: deny };
			const context = join(outs);
			return context ? { additionalContext: context } : undefined;
		} catch {
			return undefined;
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		try {
			if (off() || event.isError) return undefined;
			const tool = event.toolName ?? "";
			const names = claudeNamesFor(tool, deps.namesPath);
			const context = join(
				await runAll("PostToolUse", names, {
					hook_event_name: "PostToolUse",
					session_id: sessionIdOf(ctx),
					cwd: ctx.cwd,
					tool_name: names[0],
					tool_input: claudeToolInput(event.input, ctx.cwd),
				}),
			);
			return context ? { additionalContext: context } : undefined;
		} catch {
			return undefined;
		}
	});
}
