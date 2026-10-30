/**
 * Fallback TODO tree for omp. omp's own TODO tree is fed only by a successful `todo` tool result, and the extension
 * API cannot set native todos. A lead that records its plan on the Atlas board without ever calling `todo` would get
 * the Subagents widget and the ATLAS band but no tree. While the board holds this session's plan items and no native
 * `todo` result has succeeded, this module draws a tree that looks like omp's (header TODO, roman-numbered phases
 * with done/total, ☑/☐ items, active phase expanded) as a widget above the editor. The first successful native `todo`
 * result removes it for good, so there is never a double tree. Main agent only; fails soft.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { boardRoot, sessionTodos } from "./channel-view";

export const TODO_WIDGET_KEY = "atlas-todo";
const POLL_MS = 2000;
const MAX_TEXT = 100;

export interface TreeItem {
	content?: string;
	status?: string;
}

/** `[label] text` or `Word: text` → phase label and the remaining text; no prefix → the generic "Tasks" phase. */
function splitPhase(content: string): { phase: string; text: string } {
	const m = /^\[([^\]]{1,24})\]\s+(.+)$/.exec(content) ?? /^([A-Za-z][A-Za-z-]{1,19}):\s+(.+)$/.exec(content);
	if (!m) return { phase: "Tasks", text: content };
	return { phase: m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1), text: m[2]! };
}

function roman(n: number): string {
	const table: Array<[number, string]> = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
	let out = "";
	for (const [v, s] of table) while (n >= v) ((out += s), (n -= v));
	return out;
}

/** omp-style tree: phases in first-appearance order, the in-progress (else first unfinished) phase expanded. */
export function todoTreeLines(items: TreeItem[]): string[] {
	const phases = new Map<string, Array<{ text: string; done: boolean; active: boolean }>>();
	for (const i of items) {
		const { phase, text } = splitPhase((i.content ?? "").replace(/\s+/g, " ").trim());
		if (!text) continue;
		const rows = phases.get(phase) ?? [];
		rows.push({ text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text, done: i.status === "completed", active: i.status === "in_progress" });
		phases.set(phase, rows);
	}
	if (phases.size === 0) return [];
	const all = [...phases.entries()];
	const open = (all.find(([, r]) => r.some(x => x.active)) ?? all.find(([, r]) => r.some(x => !x.done)))?.[0];
	const lines = [" TODO"];
	all.forEach(([name, rows], n) => {
		lines.push(`  ├─ ${roman(n + 1)}. ${name} · ${rows.filter(r => r.done).length}/${rows.length}`);
		if (name !== open) return;
		rows.forEach((r, k) => lines.push(`  │  ${k === rows.length - 1 ? "└─" : "├─"} ${r.done ? "☑" : "☐"} ${r.text}`));
	});
	lines.push("  └─────");
	return lines;
}

interface Ctx {
	agent?: { kind?: string };
	cwd?: string;
	hasUI?: boolean;
	ui?: { setWidget(key: string, content: string[] | undefined): void };
	sessionManager?: { getSessionId?: () => unknown };
}
export interface FallbackDeps {
	env?: Record<string, string | undefined>;
	pollMs?: number;
	setInterval?: (fn: () => void, ms: number) => unknown;
	clearInterval?: (h: unknown) => void;
}

export function registerTodoFallback(pi: Pick<ExtensionAPI, "on">, deps: FallbackDeps = {}): { stop(): void } {
	const env = deps.env ?? process.env;
	const setIv =
		deps.setInterval ??
		((fn, ms) => {
			const t = setInterval(fn, ms);
			t.unref?.();
			return t;
		});
	const clearIv = deps.clearInterval ?? ((h: unknown) => clearInterval(h as Timer));
	let native = false;
	let ctx: Ctx | undefined;
	let poll: unknown;
	let painted: string | undefined;

	const set = (lines: string[] | undefined) => {
		const key = lines ? lines.join("\n") : "";
		if (key === painted) return;
		painted = key;
		try {
			ctx?.ui?.setWidget(TODO_WIDGET_KEY, lines);
		} catch {
			// UI gone
		}
	};
	const stopPoll = () => {
		if (poll !== undefined) clearIv(poll);
		poll = undefined;
	};
	const paint = () => {
		try {
			if (native || !ctx?.cwd) return set(undefined);
			const id = ctx.sessionManager?.getSessionId?.();
			const rows = sessionTodos(boardRoot(ctx.cwd, env), typeof id === "string" && id.trim() ? id : undefined);
			const lines = todoTreeLines(rows);
			set(lines.length ? lines : undefined);
		} catch {
			// fail soft: a bad board never breaks the session
		}
	};
	const main = (c: Ctx | undefined): c is Ctx => !!c && c.agent?.kind === "main" && c.hasUI !== false && !!c.ui;
	const refresh = (c: Ctx | undefined) => {
		if (!main(c)) return;
		ctx = c;
		paint();
		if (!native && poll === undefined) poll = setIv(paint, deps.pollMs ?? POLL_MS);
	};

	pi.on("before_agent_start", ((_e: unknown, c: Ctx) => {
		refresh(c);
		return undefined;
	}) as never);
	pi.on("tool_result", ((e: { toolName?: string; isError?: boolean }, c: Ctx) => {
		if (!main(c)) return undefined;
		if ((e?.toolName ?? "").toLowerCase() === "todo" && !e?.isError) {
			native = true;
			ctx = c;
			stopPoll();
			set(undefined);
			return undefined;
		}
		refresh(c);
		return undefined;
	}) as never);
	pi.on("session_shutdown", (() => {
		stopPoll();
		set(undefined);
		ctx = undefined;
		return undefined;
	}) as never);
	return { stop: stopPoll };
}
