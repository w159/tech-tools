/**
 * IRC channel model for omp `task` dispatches. omp gives a subagent no env of its own, so identity travels in the
 * dispatch spec: the first `task` call of a lead opens its subchannel `<main>/<lead>` (scripts/atlas_todo.py
 * `channel-open`), registers every item as a member with parent=lead, and appends the CHANNEL block (channel, siblings,
 * the exact `atlas_todo.py note --channel ... --owner <name>` command, the inbox command) to that item's `task`.
 * The note-draining PostToolUse hook (hooks/worker_inbox.py) keys on the omp agent id the hook bridge sends as
 * `agent_name`; where an omp release does not expose it the subagent still drains by running the inbox command.
 * Claude Code does the same in hooks/dispatch_tripwire.py. Fail open: a dispatch is never blocked by the board.
 */
import * as nodePath from "node:path";

import { taskItems, recordFault } from "./hook-bridge";
import { runCaptureSync } from "./proc";

const TODO_SCRIPT = nodePath.resolve(import.meta.dir, "..", "scripts", "atlas_todo.py");
const BAD_NAME = /[^A-Za-z0-9_.-]/g;

/** Same sanitising as atlas_todo._sanitize_owner. */
export const sanitizeName = (n: string): string => n.trim().replace(BAD_NAME, "_") || "anon";

/** ATLAS_LEAD_NAME, else the mux worker name, else `lead-<first 6 of the session id>` (atlas_todo.lead_name). */
export function leadName(sessionId: string | undefined, env: Record<string, string | undefined> = process.env): string {
	const named = (env.ATLAS_LEAD_NAME || env.ATLAS_WORKER_NAME || "").trim();
	if (named) return sanitizeName(named);
	const sid = sanitizeName(sessionId ?? "").slice(0, 6);
	return sessionId ? `lead-${sid}` : "lead";
}

export type ChannelRunner = (argv: string[], cwd: string) => string | undefined;

const defaultRun: ChannelRunner = (argv, cwd) => {
	const { code, stdout } = runCaptureSync(argv, { cwd, timeoutMs: 15_000 });
	return code === 0 ? stdout : undefined;
};

/**
 * A revised copy of a `task` input with the CHANNEL block on every dispatch item (items without a name get one, so
 * the member name and the agent id agree); undefined when nothing changes or the board is unavailable.
 */
export function reviseForChannel(
	input: Record<string, unknown>,
	opts: { cwd: string; sessionId?: string; env?: Record<string, string | undefined>; run?: ChannelRunner },
): Record<string, unknown> | undefined {
	const env = opts.env ?? process.env;
	if (env.ATLAS_CHANNELS === "off") return undefined;
	const revised = structuredClone(input);
	const items = taskItems(revised).filter(i => typeof i.task === "string");
	if (!items.length) return undefined;
	const names = items.map(item => {
		const agent = typeof item.agent === "string" && item.agent.trim() ? item.agent.trim() : "task";
		if (typeof item.name !== "string" || !item.name.trim()) item.name = `${sanitizeName(agent)}-${Math.random().toString(16).slice(2, 6)}`;
		return sanitizeName(item.name as string);
	});
	const lead = leadName(opts.sessionId, env);
	const out = (opts.run ?? defaultRun)(
		["python3", TODO_SCRIPT, "channel-open", "--root", opts.cwd, "--lead", lead, "--members", names.join(",")],
		opts.cwd,
	);
	if (!out) {
		recordFault("channels", "channel-open produced no output (non-zero exit or timeout)", "ChannelOpen", opts.cwd);
		return undefined;
	}
	let briefs: Record<string, string> = {};
	try {
		briefs = JSON.parse(out).briefs ?? {};
	} catch (error) {
		recordFault("channels", String(error), "ChannelOpen", opts.cwd);
		return undefined;
	}
	let changed = false;
	items.forEach((item, i) => {
		const brief = briefs[names[i]];
		if (!brief || (item.task as string).includes("CHANNEL:")) return;
		item.task = `${item.task as string}\n\n${brief}`;
		changed = true;
	});
	return changed ? revised : undefined;
}
