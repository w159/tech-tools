/**
 * Mission Control panel for the omp widget: the same framed look as the Claude band (mod/), as plain lines.
 * omp renders widget strings through pi-tui Text, which is ANSI aware, so border/chip/lane accents are colored.
 * Pure: renderPanel(model) -> lines. Gate status comes from a throttled async cache over atlas_gates.py.
 */
import { gatesError, groupOpenCount, parseGates } from "../mod/gates";
import type { GateGroup } from "../mod/pane/sidebar";

const PHASES = ["research", "theory", "test", "implement", "verify", "done"];
const MAX_LANES = 4;
const NAME_W = 12;
const BAR_CELLS = 10;
const BAR_FULL_S = 120; // a lane bar fills over two minutes
const GATES_TTL_MS = 10_000;

const paint = (code: number) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
const red = paint(31);
const green = paint(32);
const cyan = paint(36);
const dim = paint(2);
const inverse = paint(7);

/** A lane's current tool (active) or the last one it ran (inactive, drawn dim between calls). */
export interface LaneTool {
	tool: string;
	target: string;
	active: boolean;
}
export interface PanelWorker {
	name: string;
	secs: number;
	tool?: LaneTool;
}
export interface PanelModel {
	width: number;
	maxLines: number;
	phase: string;
	spin: string; // current-phase spinner frame
	laneSpin: string;
	done: number;
	total: number;
	workers: PanelWorker[];
	notes: string[]; // already `from > to: text`, oldest first
	gates: GateGroup[] | null;
	idle?: { workers: number; minutes: number };
}

/** Pad or cut (with an ellipsis) to exactly `w` code points; every glyph used here is one column wide. */
function fit(s: string, w: number): string {
	const cs = [...s];
	return cs.length > w ? `${cs.slice(0, Math.max(0, w - 1)).join("")}…` : s + " ".repeat(w - cs.length);
}

const age = (secs: number) => (secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`);
const miniBar = (done: number, total: number, cells: number) => {
	const fill = total ? Math.round((done / total) * cells) : 0;
	return "▰".repeat(fill) + "▱".repeat(cells - fill);
};

function gatesText(g: GateGroup[] | null): string {
	if (g === null) return "gates …";
	const open = g.reduce((n, x) => n + groupOpenCount(x), 0);
	return open ? `gates ✗${open}` : "gates ✓";
}

function headerText(m: PanelModel, inner: number): string {
	const rail = PHASES.map((p, i) => `${i === PHASES.indexOf(m.phase) ? m.spin : i < PHASES.indexOf(m.phase) ? "●" : "○"} ${p}`).join(" ─ ");
	const right = `${m.done}/${m.total} tasks · ${gatesText(m.gates)}`;
	const full = `ATLAS  ${rail}`;
	const left = full.length + 2 + right.length <= inner - 2 ? full : `ATLAS  ${m.spin} ${m.phase}`;
	return left + " ".repeat(Math.max(1, inner - 2 - left.length - right.length)) + right;
}

/** Lane text split at the tool column so the row can dim just the tool part between calls. */
function laneText(w: PanelWorker, m: PanelModel): { head: string; tool: string } {
	const fill = Math.max(1, Math.min(BAR_CELLS, Math.ceil((w.secs / BAR_FULL_S) * BAR_CELLS)));
	const bar = "▰".repeat(fill) + "▱".repeat(BAR_CELLS - fill);
	const tool = w.tool ? `${w.tool.tool} ${w.tool.target}`.trim() : "working";
	return { head: `▌ ${fit(w.name, NAME_W)} ${m.laneSpin} ▕${bar}▏ ${age(w.secs)} `, tool };
}

function laneRow(w: PanelWorker, m: PanelModel, row: Row): string {
	const { head, tool } = laneText(w, m);
	return row(head + tool, 1, cyan, w.tool && !w.tool.active ? { from: [...head].length, paint: dim } : undefined);
}

function footerText(m: PanelModel): string {
	const gates = m.gates === null ? "gates …" : m.gates.map(g => `${groupOpenCount(g) ? "✗" : "✓"} ${g.id}`).join(" ");
	return `todos ${miniBar(m.done, m.total, 9)} ${m.done}/${m.total}  ${gates}`;
}

/** Border color tracks state: red when a gate is open, green when all pass, dim while unknown or idle. */
function borderPaint(m: PanelModel): (s: string) => string {
	if (m.idle || m.gates === null) return dim;
	return m.gates.some(g => groupOpenCount(g)) ? red : green;
}

export function renderPanel(m: PanelModel): string[] {
	const inner = Math.max(20, m.width - 2);
	const edge = borderPaint(m);
	const side = edge("│");
	// head: leading chars of the already-fitted body that get an accent color (ATLAS chip, lane bar); tail: chars from
	// `tail.from` on get `tail.paint` (a lane's idle tool). Split by code point so the ANSI never moves a border.
	const row: Row = (text, head = 0, accent = s => s, tail) => {
		const cs = [...fit(` ${text}`, inner)];
		const cut = tail ? Math.min(cs.length, Math.max(1 + head, 1 + tail.from)) : cs.length;
		const rest = cs.slice(cut).join("");
		return `${side}${cs[0]}${accent(cs.slice(1, 1 + head).join(""))}${cs.slice(1 + head, cut).join("")}${rest && tail ? tail.paint(rest) : rest}${side}`;
	};
	const top = edge(`╭${"─".repeat(inner)}╮`);
	const bottom = edge(`╰${"─".repeat(inner)}╯`);
	if (m.idle) {
		return [top, row(`ATLAS  ○ idle · last run: ${m.idle.workers} workers, ${m.idle.minutes} min`, 5, inverse), bottom];
	}
	return [top, row(headerText(m, inner), 5, inverse), ...middleRows(m, row), row(footerText(m)), bottom];
}

type Row = (text: string, head?: number, accent?: (s: string) => string, tail?: { from: number; paint: (s: string) => string }) => string;

/** Lanes win the budget over the ticker; "+N more" and the ticker take what is left. */
function middleRows(m: PanelModel, row: Row): string[] {
	const room = m.maxLines - 4;
	const shown = Math.min(m.workers.length, MAX_LANES, Math.max(0, room));
	const hidden = m.workers.length - shown;
	const moreRoom = room - shown;
	const more = moreRows(hidden, moreRoom, row);
	const ticker = tickerRows(m.notes, moreRoom - more.length, row);
	return [...m.workers.slice(0, shown).map(w => laneRow(w, m, row)), ...more, ...ticker];
}

const moreRows = (hidden: number, room: number, row: Row): string[] => (hidden > 0 && room >= 1 ? [row(`+${hidden} more`, 40, dim)] : []);

const tickerRows = (notes: string[], room: number, row: Row): string[] => (notes.length && room >= 1 ? [row(`#lead  ${notes.slice(-2).join(" · ")}`)] : []);

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
