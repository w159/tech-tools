/**
 * Mission Control panel for the omp widget, drawn in Catppuccin Mocha truecolor after the design prototype
 * (.atlas/evidence/optimize-2026-10-13/design/proto.py band_running / band_idle): gradient title bar, chevron phase
 * rail, lanes with state chip + tool chip + eighth-block bar + sparkline, an IRC ticker and a gates footer.
 * omp renders widget strings through pi-tui Text, which is ANSI aware. Every line is clipped by code point OUTSIDE
 * escape sequences and filled with the panel background, so no line is wider than `width` and no escape is ever cut.
 * Pure: renderPanel(model) -> lines. Gate status comes from a throttled async cache over atlas_gates.py.
 */
import { type Cell, type Hue, cellsWidth, coreCells } from "../mod/core-row";
import type { CoreModel } from "../mod/data/core";
import { gatesError, groupOpenCount, parseGates } from "../mod/gates";
import { charFrame } from "../mod/roles";
import type { GateGroup } from "../mod/pane/sidebar";
import { BASE, BLUE, DIM, GREEN, MUT, PANEL, PANEL2, PEACH, PINK, RED, RST, type Rgb, SKY, TEAL, TXT, VIOLET, WHITE, YEL, bar, bg, chip, cut, fg, hx, lerp, seg, visibleWidth } from "./panel-paint";
import { type PanelTodo, todoLines } from "./todo-panel";

export { visibleWidth };

/** Brand mark: one cell, same as the Claude band. */
const MARK = "◆";
const PHASES: Array<[string, Rgb]> = [["research", BLUE], ["theory", VIOLET], ["test", YEL], ["implement", PEACH], ["verify", GREEN], ["done", TEAL]];
const NICKS = [PINK, PEACH, YEL, GREEN, TEAL, SKY, BLUE, VIOLET];
const SPARK = "▁▂▃▄▅▆▇█";
const MAX_LANES = 5;
const BAR_FULL_S = 120; // a lane bar fills over two minutes, then shows an empty track
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
	spark?: number[]; // tool calls per time bucket, oldest first
}
export interface PanelNote {
	from: string;
	to: string;
	text: string;
	ts?: number; // epoch seconds; shown as HH:MM when it is a real clock value
}
export interface PanelModel {
	width: number;
	maxLines: number;
	phase: string;
	spin: string; // current-phase spinner frame
	laneSpin: string;
	tick: number; // drives the current-phase shimmer
	done: number;
	total: number;
	workers: PanelWorker[];
	notes: PanelNote[]; // oldest first
	gates: GateGroup[] | null;
	channel?: string; // `<repo>@<branch>/<lead>`
	team?: string; // `<class>/<effort>`
	elapsedSecs?: number;
	idle?: IdleWave;
	todos?: PanelTodo[]; // the shared board; drawn under the rail
	todosExpanded?: boolean; // ATLAS_TODO_EXPANDED=1: the list instead of the one-row bar
	core?: CoreModel | null; // the Atlas core row under the rail; absent or empty: no row
}
/** The last wave the idle panel summarizes: member count, first join to last finish, non-zero exits. */
export interface IdleWave {
	workers: number;
	secs?: number;
	failed: number;
}

const ANSI_SPLIT = /(\x1b\[[0-9;]*m)/;

/** Cut to `w` columns between escape sequences, then fill the rest with the panel background. */
function fitLine(s: string, w: number): string {
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
	return out + RST + (n < w ? seg(" ".repeat(w - n)) : "");
}


const p2 = (n: number) => String(n).padStart(2, "0");
/** Elapsed time, widest output 6 columns: 59s, 59m59s, 23h59m, 99d23h. */
export const age = (s: number) =>
	s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${p2(s % 60)}s` : s < 86400 ? `${Math.floor(s / 3600)}h${p2(Math.floor((s % 3600) / 60))}m` : `${Math.floor(s / 86400)}d${p2(Math.floor((s % 86400) / 3600))}h`;
const clock = (s: number) => (s < 3600 ? `${p2(Math.floor(s / 60))}:${p2(s % 60)}` : age(s));
/** Role from `role-id` names; a plain name (no hyphen) has no role to show. */
export const roleOf = (name: string) => (name.includes("-") ? name.replace(/-[^-]*$/, "") || name : "task");

/**
 * Fit `s` in `w` columns by dropping leading hyphen words (`completeness-critic-f08e` -> `critic-f08e`), keeping at
 * least `keep` words (a worker name keeps role + id), else cut.
 */
function abbrev(s: string, w: number, keep = 1): string {
	const parts = s.split("-");
	for (let i = 0; i <= parts.length - keep; i++) {
		const tail = parts.slice(i).join("-");
		if ([...tail].length <= w) return cut(tail, w);
	}
	return cut(s, w);
}

/** Full-width title: `left` and `right` in bold base color over a per-cell gradient from `a` to `b`. */
function gradBar(left: string, right: string, w: number, a: Rgb, b: Rgb): string {
	const r = [...right].length < w - 4 ? [...right] : [];
	const l = [...cut(` ${left}`, w - r.length)];
	const cells = [...l, ...r];
	return `\x1b[1m${fg(BASE)}${cells.map((ch, i) => bg(lerp(a, b, i / Math.max(1, w - 1))) + ch).join("")}${RST}`;
}

type RailMode = "full" | "short";
type RailLook = { tick: number; spin: string; idle: boolean };

/** The current phase: a shimmering filled pill with the phase spinner (a steady ◆ when idle). */
function currentPill(name: string, col: Rgb, m: RailLook): string {
	const shimmer = m.idle ? col : lerp(col, WHITE, 0.25 + 0.25 * ((m.tick % 4) / 3));
	return seg(` ${m.idle ? "◆" : m.spin} ${name.toUpperCase()} `, BASE, shimmer, true);
}

function pill(i: number, cur: number, m: RailLook, mode: RailMode): string {
	const [name, col] = PHASES[i]!;
	const label = mode === "full" ? name : name.slice(0, 3);
	if (i < cur) return seg(` ✓ ${label} `, BASE, lerp(col, PANEL, 0.45));
	if (i > cur) return seg(` ${label} `, MUT, PANEL2);
	return currentPill(name, col, m);
}

/** Chevron pills; abbreviated names when the full rail does not fit. */
function rail(phase: string, w: number, m: RailLook): string {
	const cur = Math.max(0, PHASES.findIndex(p => p[0] === phase));
	const build = (mode: RailMode) =>
		seg(" ") + PHASES.map((p, i) => pill(i, cur, m, mode) + seg(i < PHASES.length - 1 ? "▶" : " ", i < cur ? p[1] : DIM)).join("");
	const full = build("full");
	return visibleWidth(full) <= w ? full : build("short");
}


function spark(counts: number[] | undefined, width: number, col: Rgb): string {
	const vals = (counts ?? []).slice(-width);
	const padded = [...Array(Math.max(0, width - vals.length)).fill(0), ...vals] as number[];
	// Absolute steps like the Claude band (mod/paint.ts sparkline): 0 is a dim floor, 1..4+ climb two steps each.
	return padded.map(v => (v ? seg(SPARK[Math.min(7, v * 2 - 1)]!, col) : seg(SPARK[0]!, DIM))).join("");
}

interface LaneCols {
	name: number;
	role: number;
	target: number;
	bar: number;
	spark: number;
}
const FIXED = 30; // lead 1 + state chip 7 + glyph 3 + tool chip 12 + target tail 1 + age 6
const FULL = 120; // the full tier: the geometry of the Claude band (mod/band.tsx lane), so the twins print the same row

/** Column widths for `w`: optional columns join by priority as room allows. */
function laneCols(w: number): LaneCols {
	if (w >= FULL) {
		const c: LaneCols = { name: 25, role: 12, target: 24, bar: 0, spark: 12 };
		const rest = w - FIXED - c.name - c.role - c.target - 16 - 2; // 16: spark 12 + two 2-cell gaps; 2: target lead + margin
		c.bar = Math.min(28, rest);
		c.target += Math.max(0, rest - 28);
		return c;
	}
	const c: LaneCols = { name: 12, role: 0, target: 12, bar: 0, spark: 0 };
	let rest = w - FIXED - c.name - c.target - 1;
	const grow = (k: keyof LaneCols, by: number, need = by) => {
		if (rest >= need) (c[k] += by), (rest -= need);
	};
	grow("bar", 10);
	grow("name", 6);
	grow("spark", 12, 16);
	grow("role", 12);
	grow("target", 12);
	grow("bar", 18);
	c.target += Math.max(0, Math.min(rest, 8)); // the rest stays empty so bars line up like the design
	return c;
}

/** RUN: a tool in flight; THINK: between calls (tool and target muted); START: no tool recorded yet. */
interface LaneLook {
	label: string;
	col: Rgb;
	tool: string;
	target: string;
	ink: Rgb;
	toolInk: Rgb;
}
function laneLook(t: LaneTool | undefined): LaneLook {
	if (!t) return { label: "START", col: SKY, tool: "working", target: "", ink: TXT, toolInk: SKY };
	return t.active
		? { label: "RUN", col: GREEN, tool: t.tool, target: t.target, ink: TXT, toolInk: GREEN }
		: { label: "THINK", col: YEL, tool: t.tool, target: t.target, ink: MUT, toolInk: MUT };
}

const roleCell = (wk: PanelWorker, c: LaneCols) => (c.role ? seg(`${abbrev(wk.role ?? roleOf(wk.name), c.role - 1)} `, MUT) : "");

/** Elapsed bar (fills over BAR_FULL_S) and the tool-call sparkline, each only when its column fits. */
function meterCells(wk: PanelWorker, c: LaneCols, col: Rgb): string {
	const meter = c.bar ? bar(wk.secs >= BAR_FULL_S ? 0 : wk.secs / BAR_FULL_S, c.bar, lerp(col, PANEL, 0.1), lerp(col, WHITE, 0.35)) : "";
	return meter + (c.spark ? seg("  ") + spark(wk.spark, c.spark, col) + seg("  ") : "");
}

function laneRow(wk: PanelWorker, m: PanelModel, c: LaneCols): string {
	const k = laneLook(wk.tool);
	const head =
		seg(" ") + chip(cut(k.label, 5), k.col) + seg(charFrame(wk.role ?? roleOf(wk.name), wk.tool?.active ? "running" : "thinking", m.tick), k.col) + seg(` ${abbrev(wk.name, c.name - 2, 2)} `, TXT, PANEL, true);
	const tool = seg(` ${cut(k.tool, 10)} `, k.toolInk, PANEL2, true) + seg(` ${cut(k.target, c.target)} `, k.ink);
	return head + roleCell(wk, c) + tool + meterCells(wk, c, k.col) + seg(age(wk.secs).padStart(6), MUT);
}

const nick = (name: string) => seg(name, NICKS[[...name].reduce((n, ch) => n + ch.codePointAt(0)!, 0) % NICKS.length], PANEL, true);
const hhmm = (ts?: number) => (ts && ts > 1e9 ? new Date(ts * 1000).toTimeString().slice(0, 5) : "");

function noteSeg(n: PanelNote, text = n.text): string {
	const t = hhmm(n.ts);
	return (t ? seg(`${t} `, DIM) : "") + nick(n.from) + seg(" → ", MUT) + nick(n.to) + seg(`: ${text}   `, TXT);
}

/** `parts` with older note `n` in front, its text cut to `room`, when at least 16 columns of text fit. */
function withCutNote(parts: string[], n: PanelNote, room: number): string[] {
	const text = room - visibleWidth(noteSeg(n, ""));
	return text >= 16 ? [noteSeg(n, cut(n.text, text - 3).trimEnd()), ...parts] : parts;
}

/** The newest notes that fit in `room`, oldest first; one older note may join with its text cut. */
function tickerNotes(notes: PanelNote[], room: number): string[] {
	const parts: string[] = [];
	let used = 0;
	for (const n of [...notes].reverse()) {
		const whole = noteSeg(n);
		if (parts.length && used + visibleWidth(whole) > room) return withCutNote(parts, n, room - used);
		parts.unshift(whole);
		used += visibleWidth(whole);
	}
	return parts;
}

function tickerRow(m: PanelModel, w: number): string {
	const head = seg(" ") + chip(`#${(m.channel ?? "lead").split("/").at(-1)}`, VIOLET) + seg(" ");
	return head + tickerNotes(m.notes, w - visibleWidth(head)).join("");
}

const gateChip = (g: GateGroup) => (groupOpenCount(g) ? chip(`✖ ${g.id}`, RED) : chip(`✔ ${g.id}`, GREEN)) + seg(" ");

/** Whole chips while they fit in `room`, then `+N` for the rest; fixed order (the title still counts open gates). */
function fitChips(chips: string[], room: number): string {
	let out = "";
	for (const [i, c] of chips.entries()) {
		if (visibleWidth(out + c) + 4 > room && i < chips.length - 1) return out + seg(`+${chips.length - i}`, MUT);
		out += c;
	}
	return out;
}

function footerRow(m: PanelModel, w: number): string {
	const s = seg(" ") + seg("tasks ", MUT) + bar(m.total ? m.done / m.total : 0, 18, GREEN, TEAL) + seg(` ${m.done}/${m.total}  `, TXT);
	return s + (m.gates === null ? chip("gates …", DIM) : fitChips(m.gates.map(gateChip), w - visibleWidth(s)));
}

function gatesBrief(g: GateGroup[] | null): string {
	if (g === null) return "gates …";
	const open = g.reduce((n, x) => n + groupOpenCount(x), 0);
	return open ? `✖ ${open} gates` : "✔ gates";
}

/** Spawn clusters (twin: mod/band.tsx waves): workers whose start times sit within 10 s share a wave. ponytail: same gap heuristic as the band. */
const WAVE_GAP_S = 10;
function waveCount(ws: PanelWorker[]): number {
	const starts = ws.map(wk => -wk.secs).sort((a, b) => a - b);
	return starts.reduce((n, t, i) => (i === 0 || t - starts[i - 1]! > WAVE_GAP_S ? n + 1 : n), 0);
}

const channelScope = (c?: string | null) => (c ? c.replace(/\/[^/]*$/, "") : "");
const waveLabel = (ws: PanelWorker[]) => (ws.length ? `wave ${waveCount(ws)}` : "");

function titleRow(m: PanelModel, w: number): string {
	const parts = [channelScope(m.channel), waveLabel(m.workers), m.team ?? ""].filter(Boolean);
	const left = [`${MARK} ATLAS  ·  mission control`, ...parts].join("  ·  ");
	const right = `◷ ${clock(m.elapsedSecs ?? 0)}   ${m.workers.length} live   ${gatesBrief(m.gates)} `;
	return gradBar(left, right, w, VIOLET, SKY);
}

/** Spare budget becomes the design's breathing room: under the rail, then between the lanes and the extras. */
function breathe(lanes: string[], extras: string[], room: number): string[] {
	const spare = room - lanes.length - extras.length;
	const gap = spare >= 2 && extras.length ? [seg(" ")] : [];
	return [...(spare >= 1 ? [seg(" ")] : []), ...lanes, ...gap, ...extras];
}

/** Lanes win the `room` over "+N more", which wins over the ticker. */
function middleRows(m: PanelModel, w: number, room: number): string[] {
	const shown = Math.min(m.workers.length, MAX_LANES, room);
	const cols = laneCols(w);
	const lanes = m.workers.slice(0, shown).map(wk => laneRow(wk, m, cols));
	const more = m.workers.length > shown ? [seg(` +${m.workers.length - shown} more`, MUT)] : [];
	const extras = [...more, ...(m.notes.length ? [tickerRow(m, w)] : [])].slice(0, room - lanes.length);
	return breathe(lanes, extras, room);
}

/** Claude band idle wording (mod/band.tsx lastWave): `last wave: N workers · 1m10s · ✔ ok`. */
function idleRows(idle: IdleWave, w: number): string[] {
	const wave = [`last wave: ${idle.workers} workers`, ...(idle.secs === undefined ? [] : [age(idle.secs)]), idle.failed ? `✖ ${idle.failed} failed` : "✔ ok"];
	const title = `${MARK} ATLAS  ·  idle  ·  ${wave.join(" · ")}`;
	return [gradBar(title, "", w, hx("#585b70"), hx("#313244")), rail("done", w, { tick: 0, spin: "◆", idle: true })];
}
const withBoard = (m: PanelModel, w: number, rows: string[]) => [...rows.slice(0, 2), ...boardRows(m, w, Math.max(0, m.maxLines - 2)), ...rows.slice(2)];

/** Board rows within `room` lines: the list only when it can show 3+, else the one-row bar. */
function boardRows(m: PanelModel, w: number, room: number): string[] {
	return todoLines(m.todos ?? [], { width: w, tick: m.tick, spin: m.laneSpin, expanded: !!m.todosExpanded && room >= 3, maxLines: room });
}

const HUES: Record<Hue, Rgb> = { text: TXT, muted: MUT, green: GREEN, red: RED, yellow: YEL, violet: VIOLET, sky: SKY, peach: PEACH, teal: TEAL };

/** The core row (twin: mod/band.tsx coreSegments): chips are filled labels, other cells plain text in their hue. */
export function coreLine(cells: readonly Cell[]): string {
	return cells.map((x) => (x.chip ? chip(x.t, HUES[x.hue]) : seg(x.t, HUES[x.hue]))).join("");
}

/** The core row when there is core data and room: it must leave every lane its row (lanes win over the core row). */
function coreRows(m: PanelModel, w: number, room: number): string[] {
	const cells = coreCells(m.core, w);
	if (!cells.length || cellsWidth(cells) > w || room < Math.min(m.workers.length, MAX_LANES) + 1) return [];
	return [coreLine(cells)];
}

/** Title, rail and footer always show; the board and the middle rows take what is left of maxLines. */
function liveRows(m: PanelModel, w: number): string[] {
	const railLine = rail(m.phase, w, { tick: m.tick, spin: m.spin, idle: false });
	const mid = Math.max(0, m.maxLines - 3);
	const board = boardRows(m, w, Math.min(m.todosExpanded ? 5 : 1, Math.max(0, mid - 2))); // keep two rows for lanes
	const core = coreRows(m, w, mid - board.length);
	return [titleRow(m, w), railLine, ...core, ...board, ...middleRows(m, w, mid - board.length - core.length), footerRow(m, w)];
}

export function renderPanel(m: PanelModel): string[] {
	const w = Math.max(20, m.width);
	return (m.idle ? withBoard(m, w, idleRows(m.idle, w)) : liveRows(m, w)).map(s => fitLine(s, w));
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
