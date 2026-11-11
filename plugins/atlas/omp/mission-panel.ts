/**
 * Mission Control panel for the omp widget: a thin adapter over mod/mission-layout.ts, the layout the Claude Code band
 * draws too. renderPanel turns the omp PanelModel into a MissionModel, paints each layout run in ANSI truecolor from
 * the shared tone palette, and fills the board slot with the omp todo list. omp renders widget strings through
 * pi-tui Text, which is ANSI aware. Every line is clipped by code point OUTSIDE escape sequences and filled with the
 * panel background, so no line is wider than `width` and no escape is ever cut. Pure: renderPanel(model) -> lines.
 * Gate status comes from a throttled async cache over atlas_gates.py.
 */
import { coreCells } from "../mod/core-row";
import type { CoreModel } from "../mod/data/core";
import { gatesError, groupOpenCount, parseGates } from "../mod/gates";
import { hostEnv, PALETTES, sgrColor, toneHex, type Ui, uiFromEnv } from "../mod/atlas-ui";
import { bandLines, isMessageKind, type Line, type MissionModel, type MissionWorker, type Run, missionLines, runsText, type WorkerState } from "../mod/mission-layout";
import type { GateGroup } from "../mod/pane/sidebar";
import { RST, bg, PANEL, visibleWidth } from "./panel-paint";
import { type PanelTodo, todoLines } from "./todo-panel";

export { visibleWidth };

const PHASES = ["research", "theory", "test", "implement", "verify", "done"];
const GATES_TTL_MS = 10_000;

/** A lane's current tool (active) or the last one it ran (inactive, between calls). */
export interface LaneTool {
	tool: string;
	target: string;
	active: boolean;
}
export interface PanelWorker {
	name: string;
	secs: number;
	role?: string;
	tool?: LaneTool;
	spark?: number[]; // tool calls per time bucket, oldest first (kept for callers; the layout draws no per-worker graph)
	/** Set when the source knows it: waiting, failed or finished. Otherwise derived from `tool`. */
	state?: WorkerState;
}
export interface PanelNote {
	from: string;
	to: string;
	text: string;
	ts?: number; // epoch seconds; shown as HH:MM when it is a real clock value
	kind?: string; // board note kind; join, leave and merge are presence, never the message row
}
export interface PanelModel {
	width: number;
	maxLines: number;
	phase: string;
	spin: string; // kept for callers; the layout picks its own spinner frame from `tick`
	laneSpin: string; // the todo list's in-progress glyph
	tick: number;
	done: number;
	total: number;
	workers: PanelWorker[];
	notes: PanelNote[]; // oldest first
	gates: GateGroup[] | null;
	channel?: string; // `<repo>@<branch>/<lead>`
	team?: string; // `<class>/<effort>`
	elapsedSecs?: number;
	idle?: IdleWave;
	todos?: PanelTodo[]; // the shared board; listed under the rail when expanded
	todosExpanded?: boolean; // ATLAS_TODO_EXPANDED=1: the list under the rail
	core?: CoreModel | null; // the Atlas core row on the idle panel; absent or empty: no row
	blocked?: boolean; // the lead's last reply declared the blocked phase
	ctx?: number; // lead context used, 0..1; absent hides the ctx gauge
	rich?: boolean; // the tall band; absent reads ATLAS_BAND_RICH=1
	ui?: Ui; // theme, ASCII and colour depth; absent reads the environment
}
/** The last wave the idle panel summarizes: member count, first join to last finish, non-zero exits. */
export interface IdleWave {
	workers: number;
	secs?: number;
	failed: number;
}

const ANSI_SPLIT = /(\x1b\[[0-9;]*m)/;

/** Cut to `w` columns between escape sequences, then fill the rest with `fillSeq` (an SGR background; empty: no colour). */
function fitLine(s: string, w: number, fillSeq: string = bg(PANEL)): string {
	let out = "";
	let n = 0;
	for (const part of s.split(ANSI_SPLIT)) {
		if (part.startsWith("\x1b[")) out += part;
		else {
			const take = [...part].slice(0, Math.max(0, w - n));
			out += take.join("");
			n += take.length;
		}
	}
	return out + RST + (n < w ? `${fillSeq}${" ".repeat(w - n)}${RST}` : "");
}

const p2 = (n: number) => String(n).padStart(2, "0");
/** Elapsed time, widest output 6 columns: 59s, 59m59s, 23h59m, 99d23h. */
export const age = (s: number) =>
	s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${p2(s % 60)}s` : s < 86400 ? `${Math.floor(s / 3600)}h${p2(Math.floor((s % 3600) / 60))}m` : `${Math.floor(s / 86400)}d${p2(Math.floor((s % 86400) / 3600))}h`;
/** Role from `role-id` names; a plain name (no hyphen) has no role to show. */
export const roleOf = (name: string) => (name.includes("-") ? name.replace(/-[^-]*$/, "") || name : "task");

const hhmm = (ts?: number) => (ts && ts > 1e9 ? new Date(ts * 1000).toTimeString().slice(0, 5) : undefined);
const channelScope = (c?: string | null) => (c ? c.replace(/\/[^/]*$/, "") : "");
/** The lead's name in the channel (`<repo>@<branch>/<lead>`); comms collapse it to `lead`, the message row names it. */
const channelLead = (c?: string | null) => (c?.includes("/") ? c.slice(c.lastIndexOf("/") + 1) : "");

/** A worker's state: the source's own when it has one, else running with a tool in flight, thinking between calls,
 * starting before its first tool (twin: mod/band.tsx workerState). */
const stateOf = (w: PanelWorker): WorkerState => w.state ?? (w.tool ? (w.tool.active ? "running" : "thinking") : "starting");

const missionWorker = (w: PanelWorker): MissionWorker => ({
	name: w.name,
	role: w.role ?? roleOf(w.name),
	state: stateOf(w),
	tool: w.tool?.tool || undefined,
	target: w.tool?.target || undefined,
	secs: w.secs,
});

function missionModel(m: PanelModel, w: number): MissionModel {
	const last = [...m.notes].reverse().find(n => isMessageKind(n.kind));
	const lead = channelLead(m.channel);
	const named = (n: string) => (lead && n === "lead" ? lead : n);
	const gates = (m.gates ?? []).filter(g => g.lines.length > 0 || !!g.error);
	const workers = m.idle ? [] : m.workers.map(missionWorker);
	return {
		cols: w,
		maxRows: m.maxLines,
		tick: m.tick,
		project: channelScope(m.channel) || "atlas",
		scope: m.team,
		phases: PHASES,
		phase: PHASES.includes(m.phase) ? m.phase : PHASES[0]!,
		blocked: m.blocked,
		done: m.done,
		total: m.total,
		workers,
		note: last ? { from: named(last.from), to: named(last.to), text: last.text, at: hhmm(last.ts) } : undefined,
		checks: gates.length ? gates.map(g => ({ id: g.id, ok: !groupOpenCount(g) && !g.error })) : null,
		elapsedSecs: m.elapsedSecs,
		lastRun: m.idle,
		core: coreCells(m.core, w),
		boardRows: m.todosExpanded && m.todos?.length ? m.todos.length + 1 : 0,
		ctx: m.ctx,
		rich: m.rich ?? hostEnv().ATLAS_BAND_RICH === "1",
		ui: m.ui ?? uiFromEnv(),
	};
}

/** One run in ANSI: bold/strike, the tone foreground on the run's fill or the panel; NO_COLOR keeps bold and strike only. */
const paintRun = (x: Run, ui: Ui): string => {
	const p = PALETTES[ui.theme];
	const sgr = [x.bold ? "1" : "", x.strike ? "9" : "", sgrColor(toneHex(x.tone, ui.theme), 38, ui.color), sgrColor(x.bg ? p[x.bg] : p.panel, 48, ui.color)].filter(Boolean).join(";");
	return sgr ? `\x1b[${sgr}m${x.t}${RST}` : x.t;
};
const fillOf = (ui: Ui): string => (ui.color === "none" ? "" : `\x1b[${sgrColor(PALETTES[ui.theme].panel, 48, ui.color)}m`);

/** A MissionModel as ANSI rows; `board(rows)` fills the todo slot (omitted: no slot rows). */
export function paintMission(mm: MissionModel, board: (rows: number) => string[] = () => []): string[] {
	const ui = mm.ui ?? uiFromEnv();
	return missionLines(mm).flatMap(l => (l.board ? board(l.board) : [fitLine(l.runs.map(x => paintRun(x, ui)).join(""), mm.cols, fillOf(ui))]));
}

export function renderPanel(m: PanelModel): string[] {
	const w = Math.max(20, m.width);
	return paintMission(missionModel(m, w), rows => todoLines(m.todos ?? [], { width: w, tick: m.tick, spin: m.laneSpin, expanded: true, maxLines: rows }).map(s => fitLine(s, w)));
}
/** Last gate groups from atlas_gates.py; re-runs at most once per GATES_TTL_MS and never blocks a paint. */
export interface GatesCache {
	read(): GateGroup[] | null;
	refresh(sessionId: string, root: string): void;
}

export function createGatesCache(spawn: (argv: string[]) => Promise<string>, now: () => number, script: string, ttlMs = GATES_TTL_MS): GatesCache {
	let groups: GateGroup[] | null = null;
	let lastRun = Number.NEGATIVE_INFINITY;
	let busy = false;
	return {
		read: () => groups,
		refresh(sessionId, root) {
			if (busy || now() - lastRun < ttlMs) return;
			busy = true;
			lastRun = now(); // failures throttle too
			spawn(["python3", script, "--session", sessionId, "--root", root, "--json"])
				.then(parseGates)
				.catch((err: unknown) => [gatesError(err instanceof Error ? err.message : String(err))])
				.then(g => {
					groups = g;
					busy = false;
				});
		},
	};
}

/** Real spawner: stdout of the command, rejecting on nonzero exit or an 8s timeout. */
export async function spawnText(argv: string[]): Promise<string> {
	const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", timeout: 8000 });
	const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	if (code !== 0) throw new Error(`gates exit ${code}`);
	return out;
}

/** The band rows alone (plain text, trailing spaces trimmed), for the tier goldens: one row in the widest form that fits, three when rich. */
export function bandText(m: PanelModel, width: number): string[] {
	const w = Math.max(20, width);
	return bandLines(missionModel(m, w)).map(l => runsText(l.runs).trimEnd());
}
