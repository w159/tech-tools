/**
 * Live terminal view of the lead's atlas channel while `task` subagents run.
 *
 * omp's own `irc:relay` card lives 10s and never shows lead<->child traffic (irc/bus.ts #relayToMainUi), and an
 * extension cannot observe IrcBus (ExtensionAPI has no IRC event). The board is the shared record instead: atlas
 * children post with `atlas_todo.py note`, and index.ts mirrors every delivered `write agent://` message onto it.
 * This view polls that board and paints it with ctx.ui.setWidget, which sits above the editor outside the `task`
 * progress renderer and is only cleared by a session switch (omp extension-ui-controller.ts setHookWidget/clearHookWidgets).
 *
 * Lifecycle: shown when a `task` dispatch opens the channel and polled every POLL_MS for as long as any dispatched
 * member is unfinished (`task` returns right after spawning; children run for minutes). A member is finished when its
 * TERMINAL `yield` sets ended_at in channels.json (stop-bridge.ts isTerminalYield). Polling stops after QUIET_POLLS (3)
 * polls with every member finished and no new note, or after MAX_MS (30 min) regardless; the widget then clears
 * LINGER_MS (15s) later. ATLAS_CHANNELS=off: never shown. Fails soft everywhere.
 * Rendering lives in mission-panel.ts: framed Mission Control panel, gates from a 10s-throttled async atlas_gates.py
 * cache; omp widget strings go through pi-tui Text, which is ANSI aware, so borders and accents are colored.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as nodePath from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { type GatesCache, type PanelWorker, createGatesCache, renderPanel, spawnText } from "./mission-panel";
import { gatesArmed } from "./scope";

export const WIDGET_KEY = "atlas-channel";
const MAX_LINES = 10; // omp MAX_WIDGET_LINES: frame + header + lanes + ticker + footer, collapsed by renderPanel
const MAX_NOTES = 8;
const MAX_LINE = 110;
const POLL_MS = 1500;
const LINGER_MS = 15_000;
const MAX_MS = 30 * 60_000; // hard cap: the view never outlives this even if no member is ever marked finished
const QUIET_POLLS = 3; // polls with every member finished and no new note before the linger starts

export interface ChannelOpenInfo {
	channel: string;
	members: string[];
	cwd: string;
	sessionId?: string;
}
export interface WidgetUi {
	setWidget(key: string, content: string[] | undefined): void;
}
interface Note {
	owner?: string;
	to?: string;
	text?: string;
	channel?: string;
	seq?: number;
	ts?: number;
}
export interface ViewDeps {
	env?: Record<string, string | undefined>;
	pollMs?: number;
	lingerMs?: number;
	maxMs?: number;
	now?: () => number;
	setInterval?: (fn: () => void, ms: number) => unknown;
	clearInterval?: (h: unknown) => void;
	setTimeout?: (fn: () => void, ms: number) => unknown;
	clearTimeout?: (h: unknown) => void;
	columns?: () => number | undefined; // terminal width; default process.stdout.columns, else 120
	gates?: GatesCache; // default: atlas_gates.py through spawnText, armed projects only
}
export interface ChannelView {
	/** A `task` dispatch opened (or reused) the lead's channel. */
	open(ui: WidgetUi, info: ChannelOpenInfo): void;
	/** Session shutdown: drop timers and the widget. */
	stop(): void;
}

/** `from > to: text`, whitespace collapsed to one line and cut to `max`. */
export function formatNote(n: Note, max = MAX_LINE): string {
	const line = `${n.owner ?? "?"} > ${n.to ?? "all"}: ${(n.text ?? "").replace(/\s+/g, " ").trim()}`;
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const PLUGIN_ROOT = nodePath.resolve(import.meta.dir, "..");
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// Mirror of PHASE_FRAMES in mod/theme.ts (module-private there); channel-view.test.ts asserts equality via spin().
const PHASE_FRAMES: Record<string, string[]> = {
	research: ["◜", "◠", "◝", "◞", "◡", "◟"],
	theory: ["✶", "✷", "✸", "✹", "✺", "✻"],
	test: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠"],
	implement: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟"],
	verify: ["◐", "◓", "◑", "◒", "◔", "◕"],
};

export function spinFrame(n: number, phase?: string): string {
	const f = (phase && PHASE_FRAMES[phase]) || SPIN;
	return f[Math.abs(Math.floor(n)) % f.length] ?? SPIN[0];
}

export interface LiveWorker {
	name: string;
	joined?: number;
}

/** Members of `channel` still running: no ended_at, no exit_code, not the lead. */
export function liveWorkers(root: string, channel: string): LiveWorker[] {
	try {
		const reg = JSON.parse(readFileSync(nodePath.join(root, ".atlas", ".run", "channels.json"), "utf8"));
		const ms: Array<{ name?: string; role?: string; joined?: number; ended_at?: unknown; exit_code?: unknown }> = reg?.channels?.[channel]?.members ?? [];
		return ms
			.filter(m => m.name && m.role !== "lead" && m.ended_at === undefined && m.exit_code === undefined)
			.map(m => ({ name: String(m.name), joined: m.joined }));
	} catch {
		return [];
	}
}

/** Panel width for a terminal of `columns` (pi-tui Text pads one cell each side); 120 when unknown. */
function panelWidth(columns: number | undefined): number {
	return Math.max(40, (columns ?? 122) - 2);
}

/** Set only when no lane is left: the "last run" line of the idle panel. */
function idleSummary(workers: PanelWorker[], members: number, elapsedMs: number): { workers: number; minutes: number } | undefined {
	return workers.length ? undefined : { workers: members, minutes: Math.round(elapsedMs / 60_000) };
}

const maxSeq = (notes: Note[]) => notes.reduce((m, n) => Math.max(m, n.seq ?? 0), 0);

/** Lane rows: running members; before the registry lists anyone, the dispatched members not yet finished. */
function panelWorkers(live: LiveWorker[], pending: string[], nowMs: number): PanelWorker[] {
	const src: LiveWorker[] = live.length ? live : pending.map(name => ({ name }));
	return src.map(w => ({ name: w.name, secs: w.joined ? Math.max(0, Math.floor(nowMs / 1000 - w.joined)) : 0 }));
}

/** This session's todo progress, scoped like the Claude mod (mod/data/todos.ts): other sessions' rows and advisor notes never count. */
export function todoSummary(root: string, sessionId?: string): { done: number; total: number; phase: string } {
	let items: Array<{ status?: string; phase?: string; archived?: boolean; origin?: string; session_id?: string }> = [];
	try {
		items = JSON.parse(readFileSync(nodePath.join(root, ".atlas", ".run", "todos.json"), "utf8")).items ?? [];
	} catch {
		// no board yet: zeroes
	}
	items = items.filter(i => !i.archived && i.origin !== "advisor" && (!sessionId || i.session_id === sessionId));
	const open = items.filter(i => i.status !== "completed");
	const phase = (open.find(i => i.status === "in_progress" && i.phase) ?? open.find(i => i.phase))?.phase ?? "research";
	return { done: items.length - open.length, total: items.length, phase };
}

/** Main repo root of a linked git worktree dir (`.git` file -> gitdir -> commondir), else undefined. Mirrors atlas_todo._worktree_main_root. */
function worktreeMainRoot(dir: string): string | undefined {
	try {
		const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(nodePath.join(dir, ".git"), "utf8"))?.[1]?.trim();
		if (!gitdir) return undefined;
		const priv = nodePath.resolve(dir, gitdir);
		const common = readFileSync(nodePath.join(priv, "commondir"), "utf8").trim();
		return common ? nodePath.dirname(nodePath.resolve(priv, common)) : undefined;
	} catch {
		return undefined; // plain repo (`.git` is a directory) or unreadable: fall through
	}
}

/** Board root for a cwd: ATLAS_PROJECT_ROOT, else the nearest ancestor holding `.atlas` (a linked worktree maps to its main repo, like atlas_todo.find_root). */
function boardRoot(cwd: string, env: Record<string, string | undefined>): string {
	if (env.ATLAS_PROJECT_ROOT) return env.ATLAS_PROJECT_ROOT;
	for (let dir = cwd; ; dir = nodePath.dirname(dir)) {
		const main = worktreeMainRoot(dir);
		if (main) return main;
		if (existsSync(nodePath.join(dir, ".atlas"))) return dir;
		if (nodePath.dirname(dir) === dir) return cwd;
	}
}

/** Last `limit` notes of `channel`, oldest first, from every <root>/.atlas/.run/board/*.jsonl; [] when unreadable. */
export function readChannelNotes(root: string, channel: string, limit = MAX_NOTES): Note[] {
	const dir = nodePath.join(root, ".atlas", ".run", "board");
	const out: Note[] = [];
	try {
		for (const f of readdirSync(dir)) {
			if (!f.endsWith(".jsonl")) continue;
			for (const raw of readFileSync(nodePath.join(dir, f), "utf8").split("\n")) {
				try {
					const rec = JSON.parse(raw) as Note;
					if (rec && rec.channel === channel) out.push(rec);
				} catch {
					// blank or torn line: skip it, keep the rest
				}
			}
		}
	} catch {
		return [];
	}
	// ponytail: full rescan each poll; tail the files if boards ever grow past a few MB
	return out.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || (a.ts ?? 0) - (b.ts ?? 0)).slice(-limit);
}

/** Members of `channel` that carry `ended_at` in .atlas/.run/channels.json (atlas_todo.mark_finished). */
export function finishedMembers(root: string, channel: string): Set<string> {
	try {
		const reg = JSON.parse(readFileSync(nodePath.join(root, ".atlas", ".run", "channels.json"), "utf8"));
		const members: Array<{ name?: string; ended_at?: unknown }> = reg?.channels?.[channel]?.members ?? [];
		return new Set(members.filter(m => m.ended_at !== undefined && m.name).map(m => String(m.name)));
	} catch {
		return new Set();
	}
}

export function createChannelView(deps: ViewDeps = {}): ChannelView {
	const env = deps.env ?? process.env;
	const pollMs = deps.pollMs ?? POLL_MS;
	const lingerMs = deps.lingerMs ?? LINGER_MS;
	const maxMs = deps.maxMs ?? MAX_MS;
	const now = deps.now ?? Date.now;
	const setIv =
		deps.setInterval ??
		((fn, ms) => {
			const t = setInterval(fn, ms);
			t.unref?.();
			return t;
		});
	const clearIv = deps.clearInterval ?? ((h: unknown) => clearInterval(h as Timer));
	const setTo =
		deps.setTimeout ??
		((fn, ms) => {
			const t = setTimeout(fn, ms);
			t.unref?.();
			return t;
		});
	const clearTo = deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as Timer));

	const gates = deps.gates ?? createGatesCache(spawnText, now, nodePath.join(PLUGIN_ROOT, "scripts", "atlas_gates.py"));
	let ui: WidgetUi | undefined;
	let info: (ChannelOpenInfo & { root: string }) | undefined;
	let poll: unknown;
	let linger: unknown;
	let openedAt = 0;
	let lastSeq = -1;
	let quiet = 0;
	let painted = "";
	let tickN = 0;

	const stopPoll = () => {
		if (poll !== undefined) clearIv(poll);
		poll = undefined;
	};
	const finished = () => (info ? finishedMembers(info.root, info.channel) : new Set<string>());

	const columns = () => deps.columns?.() ?? process.stdout.columns;
	const refreshGates = (i: ChannelOpenInfo & { root: string }) => {
		if (deps.gates || gatesArmed(i.cwd, env)) gates.refresh(i.sessionId ?? "-", i.root);
	};
	/** Paint the widget when its lines changed; returns the highest note seq seen. */
	const paint = (): number => {
		if (!ui || !info) return lastSeq;
		const notes = readChannelNotes(info.root, info.channel);
		const fin = finished();
		const pending = info.members.filter(m => !fin.has(m));
		const todos = todoSummary(info.root, info.sessionId);
		refreshGates(info);
		const workers = panelWorkers(liveWorkers(info.root, info.channel), pending, now());
		const lines = renderPanel({
			width: panelWidth(columns()),
			maxLines: MAX_LINES,
			phase: todos.phase,
			spin: spinFrame(tickN, todos.phase),
			laneSpin: spinFrame(tickN),
			done: todos.done,
			total: todos.total,
			workers,
			notes: notes.map(n => formatNote(n, 60)),
			gates: gates.read(),
			idle: idleSummary(workers, info.members.length, now() - openedAt),
		});
		const key = lines.join("\n");
		if (key !== painted) ui.setWidget(WIDGET_KEY, lines);
		painted = key;
		return maxSeq(notes);
	};
	const clear = () => {
		stopPoll();
		if (linger !== undefined) clearTo(linger);
		linger = undefined;
		try {
			ui?.setWidget(WIDGET_KEY, undefined);
		} catch {
			// UI gone
		}
		ui = info = undefined;
		painted = "";
	};
	const finish = () => {
		stopPoll();
		linger = setTo(clear, lingerMs);
	};
	// `task` returns as soon as the children are spawned and they run for minutes, so the tool call ending says
	// nothing: the view lives while any dispatched member is unfinished (channels.json ended_at, set by the sub's
	// `yield`, stop-bridge.ts) and stops after QUIET_POLLS polls with everyone finished and no new note, or at MAX_MS.
	const tick = () => {
		try {
			tickN++;
			const seq = paint();
			const done = finished();
			const allDone = !!info && info.members.every(m => done.has(m));
			quiet = allDone && seq === lastSeq ? quiet + 1 : 0;
			lastSeq = seq;
			if (quiet >= QUIET_POLLS || now() - openedAt >= maxMs) finish();
		} catch {
			// fail soft: a bad board never breaks the session
		}
	};

	return {
		open(u, i) {
			try {
				if (env.ATLAS_CHANNELS === "off" || !i.channel) return;
				if (linger !== undefined) clearTo(linger);
				linger = undefined;
				const members = info?.channel === i.channel ? [...new Set([...info.members, ...i.members])] : i.members;
				ui = u;
				info = { ...i, members, root: boardRoot(i.cwd, env) };
				openedAt = now();
				quiet = 0;
				lastSeq = paint();
				if (poll === undefined) poll = setIv(tick, pollMs);
			} catch {
				// fail soft
			}
		},
		stop: clear,
	};
}

export function registerChannelView(pi: Pick<ExtensionAPI, "on">, deps: ViewDeps = {}): ChannelView {
	const view = createChannelView(deps);
	pi.on("session_shutdown", () => {
		view.stop();
		return undefined;
	});
	return view;
}
