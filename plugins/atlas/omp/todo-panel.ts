/**
 * Shared-board rows for the omp widget (twin of mod/todo-panel.tsx): collapsed it is one gradient progress bar with
 * done/total and the in-progress item; expanded it is one row per item (glyph, owner chip, text, evidence) capped
 * by the line budget with `+N more`. Pure; mission-panel.ts clips and fills each line. The helpers come from
 * panel-paint, which mission-panel also imports, so the two panels never import each other.
 */
import { C, bar, chip, cut, lerp, seg, visibleWidth } from "./panel-paint";

export interface PanelTodo {
	content: string;
	status: string;
	owner?: string;
	evidence?: string;
	phase?: string;
}
export interface TodoOpts {
	width: number;
	tick: number;
	spin: string;
	expanded: boolean;
	maxLines: number;
}

const glyph = (status: string, spin: string) =>
	status === "in_progress" ? seg(spin, C.YEL) : status === "completed" ? seg("✔", C.GREEN) : status === "blocked" ? seg("✖", C.RED) : seg("○", C.MUT);

/** The bar with one lit cell sweeping the filled part (drawn over `bar` by repainting that cell). */
function pulseBar(frac: number, width: number, tick: number): string {
	const whole = Math.floor(Math.max(0, Math.min(1, frac)) * width);
	if (!whole) return bar(frac, width, C.VIOLET, C.TEAL);
	const lit = tick % whole;
	const cells = Array.from({ length: width }, (_, i) => bar(i < whole ? 1 : i === whole ? frac * width - whole : 0, 1, lerp(C.VIOLET, C.TEAL, i / Math.max(1, width - 1)), lerp(C.VIOLET, C.TEAL, i / Math.max(1, width - 1))));
	cells[lit] = bar(1, 1, lerp(C.VIOLET, C.WHITE, 0.6), lerp(C.VIOLET, C.WHITE, 0.6));
	return cells.join("");
}

const withOwner = (t: PanelTodo) => `${t.owner ? `${t.owner}: ` : ""}${t.content}`;

/** The in-progress tail of the collapsed row: spinner plus owner and text, or nothing when no room is left. */
function currentTail(cur: PanelTodo | undefined, room: number, spin: string): string {
	if (!cur || room <= 6) return "";
	return glyph("in_progress", spin) + seg(` ${cut(withOwner(cur), room - 2).trimEnd()}`, C.TXT);
}

function collapsed(todos: PanelTodo[], o: TodoOpts): string {
	const done = todos.filter(t => t.status === "completed").length;
	const cur = todos.find(t => t.status === "in_progress");
	const head = seg(" ") + seg("board ", C.MUT) + pulseBar(done / todos.length, Math.max(6, Math.min(24, Math.floor(o.width / 4))), cur ? o.tick : 0) + seg(` ${done}/${todos.length} `, C.TXT, undefined, true);
	return head + currentTail(cur, o.width - visibleWidth(head) - 1, o.spin);
}

const ownerCell = (t: PanelTodo) => (t.owner ? chip(cut(t.owner, 10), t.status === "in_progress" ? C.YEL : C.PANEL2) + seg(" ") : seg(" ".repeat(13)));
const cleanEvidence = (t: PanelTodo) => (t.evidence ?? "").replace(/^\s*\d+[.)]\s*/, "").replace(/\s+/g, " ");
const textColor = (status: string) => (status === "completed" ? C.MUT : C.TXT);
const evidenceTail = (ev: string, room: number, used: number) => (ev ? seg(`  ${cut(ev, Math.max(0, room - used - 2)).trimEnd()}`, C.MUT) : "");

function itemRow(t: PanelTodo, o: TodoOpts, indent = ""): string {
	const head = seg(` ${indent}`) + glyph(t.status, o.spin) + seg(" ") + ownerCell(t);
	const ev = cleanEvidence(t);
	const room = o.width - visibleWidth(head) - 1;
	const text = cut(t.content, ev ? Math.max(10, Math.floor(room * 0.6)) : room).trimEnd();
	return head + seg(text, textColor(t.status)) + evidenceTail(ev, room, [...text].length);
}

// Phase order of the operating contract (contracts/operating-contract.json); twin of mod/todo-panel.tsx.
const PHASE_ORDER = ["research", "theory", "test", "validate", "implement", "verify", "done"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

/** One row per heading (`I. Research 1/2`) followed by its items nested; items without a phase go last under Other. */
function treeLines(todos: PanelTodo[], o: TodoOpts): string[] {
	const groups: Array<[string, PanelTodo[]]> = [...PHASE_ORDER.map((p): [string, PanelTodo[]] => [p, todos.filter(t => t.phase === p)]), ["other", todos.filter(t => !t.phase || !PHASE_ORDER.includes(t.phase))]];
	return groups.filter(([, g]) => g.length).flatMap(([name, g], n) => {
		const done = g.filter(t => t.status === "completed").length;
		const title = name[0]!.toUpperCase() + name.slice(1);
		return [seg(` ${ROMAN[n] ?? n + 1}. ${title} ${done}/${g.length}`, C.TXT, undefined, true), ...g.map(t => itemRow(t, o, "  "))];
	});
}

function expandedLines(todos: PanelTodo[], o: TodoOpts): string[] {
	const lines = todos.some(t => t.phase) ? treeLines(todos, o) : todos.map(t => itemRow(t, o));
	if (lines.length <= o.maxLines) return lines;
	const shown = lines.slice(0, Math.max(0, o.maxLines - 1));
	return [...shown, seg(`   +${lines.length - shown.length} more`, C.MUT)];
}

/** [] without todos, one row collapsed, else at most `maxLines` rows. */
export function todoLines(todos: PanelTodo[], o: TodoOpts): string[] {
	if (!todos.length || o.maxLines < 1) return [];
	return o.expanded ? expandedLines(todos, o) : [collapsed(todos, o)];
}
