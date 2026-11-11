/**
 * Fallback TODO tree for omp. omp's own TODO tree is fed only by a successful `todo` tool result, and the extension
 * API cannot set native todos. A lead that records its plan on the Atlas board without ever calling `todo` would get
 * the Subagents widget and the ATLAS band but no tree. While the board holds this session's plan items and no native
 * `todo` result has succeeded, this module draws the rev 4 ATLAS TODO surface (the rows Claude Code draws: ribbon,
 * progress gauge, one row per plan item with its state word, completed rows kept) as a widget above the editor. The
 * first successful native `todo` result removes it for good, so there is never a double tree. Main agent only; fails soft.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { boardRoot, sessionTodos } from "./channel-view";
import { hudText, paintHud } from "./hud-paint";
import type { TodoItem } from "../mod/contract";

export const TODO_WIDGET_KEY = "atlas-todo";
const POLL_MS = 2000;
const MAX_ROWS = 60;
const WIDTH = 120;

export interface TreeItem {
	content?: string;
	status?: string;
	owner?: string;
	evidence?: string;
	origin?: string;
}

const planOf = (items: TreeItem[]): TodoItem[] =>
	items
		.filter(i => (i.content ?? "").trim() !== "")
		.map((i, n) => ({ id: `T${n + 1}`, content: i.content!, status: i.status ?? "pending", ...(i.owner ? { owner: i.owner } : {}), ...(i.evidence ? { evidence: i.evidence } : {}), ...(i.origin ? { origin: i.origin } : {}) }));

/** The TODO surface as plain text rows (width `cols`, trailing spaces trimmed); [] for an empty board. */
export function todoTreeLines(items: TreeItem[], cols = WIDTH): string[] {
	return hudText({ todos: planOf(items), agents: [] }, { cols, maxRows: MAX_ROWS });
}

const widgetWidth = (): number => Math.max(40, Math.min(WIDTH, Number(process.stdout?.columns) || WIDTH));

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
			const lines = paintHud({ todos: planOf(rows), agents: [] }, { cols: widgetWidth(), maxRows: MAX_ROWS });
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
