/**
 * Advisor gate for omp: an Advisor's `concern` / `blocker` note is a work item,
 * not chat. omp delivers advisor notes to the lead as a `custom` message with
 * `customType: "advisor"` and `details.notes: [{ note, severity?, advisor? }]`
 * (severity: "nit" | "concern" | "blocker"; omitted = nit).
 *
 * - `context` (main session): every NEW note of any severity (nit, concern, blocker;
 *   missing = nit) becomes an atlas board item `advisor[<severity>]: <first 200 chars>` for this session.
 *   Dedupe is by note text and session-local (omp rebinds the factory per session).
 * - `session_stop` (main session; omp never fires it for subagents): while this
 *   session still has open advisor items, refuse to stop and list them. At most 3
 *   refusals per user turn (reset on before_agent_start), then allow, so a stuck
 *   advisor can never wedge a turn.
 * - `before_agent_start` (main session): while items are open, append a reminder to the
 *   system prompt (marker-guarded) so the model closes them before any `done` header.
 *
 * Board root = nearest ancestor of cwd with docs/ (same walk as index.ts docsRoot,
 * which is not exported). No docs/ ancestor, no session id, a dependency throwing,
 * or ATLAS_ADVISOR_GATE=off all mean: do nothing (fail open).
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { statSync } from "node:fs";
import * as nodePath from "node:path";
import { runCaptureSync } from "./proc";
import { pluginScript } from "./plugin-path";
import { isRecord } from "./workers";

const MAX_STOP_BLOCKS = 3;
const NOTE_PREFIX_LIMIT = 200;
const CLI_TIMEOUT_MS = 10_000;
const SEVERITIES: Record<string, true> = { nit: true, concern: true, blocker: true };
const REMINDER_MARKER = "ATLAS ADVISOR ITEMS OPEN";

export interface AdvisorDeps {
	/** Append one pending item to the board for `sessionId` under `root`. */
	addBoardItem(text: string, sessionId: string, root: string): void;
	/** Ids of this session's advisor items that are not yet completed. */
	openAdvisorItems(sessionId: string, root: string): { id: string; text: string }[];
	env?: Record<string, string | undefined>;
}

/** Deps backed by `python3 <plugin>/scripts/atlas_todo.py add|list` (argv only, no shell). */
export function defaultAdvisorDeps(): AdvisorDeps {
	const run = (args: string[]) => {
		const { code, stdout } = runCaptureSync(["python3", pluginScript("atlas_todo.py"), ...args], { timeoutMs: CLI_TIMEOUT_MS });
		if (code !== 0) throw new Error(`atlas_todo.py ${args[0]} failed (exit ${code ?? "killed"})`);
		return stdout;
	};
	return {
		addBoardItem(text, sessionId, root) {
			// --unique: omp replays the whole message history into `context` after a restart, so the
			// in-memory `seen` set is not enough; the board must refuse a second copy of the same note.
			run(["add", "--unique", text, "--session", sessionId, "--root", root]);
		},
		openAdvisorItems(sessionId, root) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(run(["list", "--session", sessionId, "--root", root]));
			} catch (error) {
				// Never read "board unreadable" as "no open items": the gate handler fails open on this throw.
				throw new Error(`atlas_todo.py list failed: ${error instanceof Error ? error.message : String(error)}`);
			}
			const items = isRecord(parsed) && Array.isArray(parsed.items) ? parsed.items : [];
			const open: { id: string; text: string }[] = [];
			for (const item of items) {
				if (!isRecord(item) || typeof item.id !== "string") continue;
				if (item.session_id !== sessionId || item.archived === true || item.status === "completed") continue;
				if (typeof item.content === "string" && item.content.startsWith("advisor[")) open.push({ id: item.id, text: item.content });
			}
			return open;
		},
	};
}

/** Nearest ancestor of `cwd` holding a docs/ directory; undefined when none (or unreadable). */
function boardRoot(cwd: string): string | undefined {
	let root = nodePath.resolve(cwd);
	for (;;) {
		try {
			if (statSync(nodePath.join(root, "docs")).isDirectory()) return root;
		} catch {
			// no docs/ here (or unreadable): keep walking
		}
		const parent = nodePath.dirname(root);
		if (parent === root) return undefined;
		root = parent;
	}
}

/** Advisor notes of one `context` event, in message order. */
function gatedNotes(messages: unknown): { text: string; severity: string }[] {
	const out: { text: string; severity: string }[] = [];
	if (!Array.isArray(messages)) return out;
	for (const message of messages) {
		if (!isRecord(message) || message.role !== "custom" || message.customType !== "advisor") continue;
		const notes = isRecord(message.details) ? message.details.notes : undefined;
		if (!Array.isArray(notes)) continue;
		for (const entry of notes) {
			if (!isRecord(entry) || typeof entry.note !== "string" ) continue;
			// a missing or unknown severity is a nit (omp omits it for nits)
			const severity = typeof entry.severity === "string" && SEVERITIES[entry.severity] ? entry.severity : "nit";
			out.push({ text: entry.note, severity });
		}
	}
	return out;
}

type OpenItem = { id: string; text: string };
const itemLines = (items: OpenItem[]) => items.map(i => `- ${i.id}: ${i.text}`).join("\n");

const reminder = (items: OpenItem[]) =>
	`${REMINDER_MARKER}: this session has ${items.length} open advisor item(s) on the atlas board. Operating contract: verify each one against the cited code or output, fix it or refute it with evidence, and close it with \`python3 ${pluginScript("atlas_todo.py")} complete --id <id> --evidence <proof>\` before any \`done\` header.\n${itemLines(items)}`;

const stopReason = (items: OpenItem[]) =>
	`Advisor gate: this session has ${items.length} open advisor item(s) on the atlas board. An advisor note is a work item: for each id below, check the note against the cited code or output, fix it (or refute it with evidence), then close it with \`python3 ${pluginScript("atlas_todo.py")} complete --id <id> --evidence <what you changed or the proof it does not hold>\`. (Set ATLAS_ADVISOR_GATE=off to disable this gate.)\n${itemLines(items)}`;

export function registerAdvisorGate(pi: Pick<ExtensionAPI, "on">, deps: AdvisorDeps = defaultAdvisorDeps()): void {
	const seen = new Set<string>();
	let blocks = 0;
	const off = () => (deps.env ?? process.env).ATLAS_ADVISOR_GATE === "off";
	/** This session's board coordinates, or undefined when the gate must stay out of the way. */
	const scope = (ctx: { cwd: string; agent: { kind: string }; sessionManager?: { getSessionId?: () => unknown } }) => {
		if (ctx.agent.kind !== "main" || off()) return undefined;
		const sessionId = ctx.sessionManager?.getSessionId?.();
		const root = boardRoot(ctx.cwd);
		return typeof sessionId === "string" && sessionId.trim() !== "" && root ? { sessionId, root } : undefined;
	};

	const reset = () => {
		seen.clear();
		blocks = 0;
	};
	pi.on("session_start", () => {
		reset();
		return undefined;
	});
	pi.on("session_switch", () => {
		reset();
		return undefined;
	});

	// before_agent_start fires once per user prompt: the stop-block cap is per turn, and open items are re-announced.
	pi.on("before_agent_start", (event, ctx) => {
		blocks = 0;
		try {
			const where = scope(ctx);
			if (!where) return undefined;
			const open = deps.openAdvisorItems(where.sessionId, where.root);
			if (open.length === 0) return undefined;
			const base = Array.isArray(event.systemPrompt) ? event.systemPrompt : [];
			if (base.some(entry => typeof entry === "string" && entry.includes(REMINDER_MARKER))) return undefined;
			return { systemPrompt: [...base, reminder(open)] };
		} catch {
			return undefined; // fail open
		}
	});

	pi.on("context", (event, ctx) => {
		const where = scope(ctx);
		if (!where) return undefined;
		let notes: { text: string; severity: string }[];
		try {
			notes = gatedNotes(event.messages);
		} catch {
			return undefined; // fail open
		}
		for (const { text, severity } of notes) {
			if (seen.has(text)) continue;
			try {
				deps.addBoardItem(`advisor[${severity}]: ${text.slice(0, NOTE_PREFIX_LIMIT)}`, where.sessionId, where.root);
				seen.add(text); // only after the write landed: a failed note is retried on the next context event
			} catch {
				// fail open: a broken board must never break the turn
			}
		}
		return undefined;
	});

	pi.on("session_stop", (_event, ctx) => {
		try {
			const where = scope(ctx);
			if (!where || blocks >= MAX_STOP_BLOCKS) return undefined;
			const open = deps.openAdvisorItems(where.sessionId, where.root);
			if (open.length === 0) return undefined;
			blocks += 1;
			return { decision: "block" as const, reason: stopReason(open) };
		} catch {
			return undefined; // fail open
		}
	});
}
