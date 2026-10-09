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

/** Called once a dispatch has opened the lead's channel: the live view subscribes here. */
export type OnChannelOpen = (info: { channel: string; members: string[]; cwd: string }) => void;

/**
 * A revised copy of a `task` input with the CHANNEL block on every dispatch item (items without a name get one, so
 * the member name and the agent id agree); undefined when nothing changes or the board is unavailable.
 */
export function reviseForChannel(
	input: Record<string, unknown>,
	opts: { cwd: string; sessionId?: string; env?: Record<string, string | undefined>; run?: ChannelRunner; onOpen?: OnChannelOpen },
): Record<string, unknown> | undefined {
	const env = opts.env ?? process.env;
	if (env.ATLAS_CHANNELS === "off") return undefined;
	const revised = structuredClone(input);
	const items = taskItems(revised).filter(i => typeof i.task === "string");
	if (!items.length) return undefined;
	return openAndInject(revised, items, opts, env);
}

type Item = Record<string, unknown>;

const agentOf = (item: Item): string => (typeof item.agent === "string" ? item.agent.trim() : "");

/** The item's member name; an unnamed item gets `<agent>-<hex>` written back so the member name and agent id agree. */
function memberName(item: Item): string {
	if (typeof item.name !== "string" || !item.name.trim()) {
		item.name = `${sanitizeName(agentOf(item) || "task")}-${Math.random().toString(16).slice(2, 6)}`;
	}
	return sanitizeName(item.name as string);
}

/** channel-open output -> briefs + channel name; undefined (and a recorded fault) when it is empty or not JSON. */
function parseOpen(out: string | undefined, cwd: string): { briefs: Record<string, string>; channel: string } | undefined {
	if (!out) {
		recordFault("channels", "channel-open produced no output (non-zero exit or timeout)", "ChannelOpen", cwd);
		return undefined;
	}
	try {
		const doc = JSON.parse(out);
		return { briefs: doc.briefs ?? {}, channel: String(doc.channel?.name ?? "") };
	} catch (error) {
		recordFault("channels", String(error), "ChannelOpen", cwd);
		return undefined;
	}
}

const memberTitle = (task: string): string =>
	task.match(/^\s*GOAL:\s*(.+)$/m)?.[1]?.trim() || task.replace(/\s+/g, " ").trim().slice(0, 80);

/** contract C4: one owned todo per named-agent member, titled by the GOAL line. */
function addMemberTodo(run: ChannelRunner, cwd: string, channel: string, item: Item, name: string): void {
	const agent = agentOf(item);
	if (!channel || !agent || agent === "task") return;
	run(["python3", TODO_SCRIPT, "add", memberTitle(item.task as string), "--root", cwd, "--owner", name, "--channel", channel], cwd);
}

function injectBriefs(
	run: ChannelRunner,
	cwd: string,
	items: Item[],
	names: string[],
	parsed: { briefs: Record<string, string>; channel: string },
): boolean {
	let changed = false;
	items.forEach((item, i) => {
		const brief = parsed.briefs[names[i]];
		if (!brief || (item.task as string).includes("CHANNEL:")) return;
		addMemberTodo(run, cwd, parsed.channel, item, names[i]);
		item.task = `${item.task as string}\n\n${brief}`;
		changed = true;
	});
	return changed;
}

function openAndInject(
	revised: Item,
	items: Item[],
	opts: { cwd: string; sessionId?: string; run?: ChannelRunner; onOpen?: OnChannelOpen },
	env: Record<string, string | undefined>,
): Item | undefined {
	const run = opts.run ?? defaultRun;
	const names = items.map(memberName);
	const out = run(
		["python3", TODO_SCRIPT, "channel-open", "--root", opts.cwd, "--lead", leadName(opts.sessionId, env), "--members", names.join(",")],
		opts.cwd,
	);
	const parsed = parseOpen(out, opts.cwd);
	if (!parsed || !injectBriefs(run, opts.cwd, items, names, parsed)) return undefined;
	opts.onOpen?.({ channel: parsed.channel, members: names, cwd: opts.cwd });
	return revised;
}
