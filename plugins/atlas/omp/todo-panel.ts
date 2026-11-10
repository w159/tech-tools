/**
 * Shared-board rows for the omp widget (twin of mod/todo-panel.tsx): collapsed it is `N of M tasks` with a thin
 * single-tone bar and the in-progress item; expanded it is one row per item with the route view's marks (✓ done,
 * ◉ in progress, ⏸ blocked with the word, ○ pending), grouped by phase, capped by the line budget with `+N more`.
 * Colour is state only, from the one TONE_HEX palette. Pure; mission-panel.ts clips and fills each line. The helpers
 * come from panel-paint, which mission-panel also imports, so the two panels never import each other.
 */
import { isPlanItem } from "../mod/data/todos";
import { TONE_HEX } from "../mod/mission-layout";
import { fitText, textWidth } from "../mod/theme";
import { hx, seg } from "./panel-paint";

export interface PanelTodo {
	content: string;
	status: string;
	owner?: string;
	evidence?: string;
	phase?: string;
	origin?: string;
}
export interface TodoOpts {
	width: number;
	/** Kept for callers: nothing on the board moves, because nothing on it is a spinner. */
	tick: number;
	spin: string;
	expanded: boolean;
	maxLines: number;
}

const T = Object.fromEntries(Object.entries(TONE_HEX).map(([k, v]) => [k, hx(v)])) as Record<keyof typeof TONE_HEX, ReturnType<typeof hx>>;
type Part = { t: string; tone: keyof typeof TONE_HEX; bold?: boolean };
const part = (t: string, tone: keyof typeof TONE_HEX = "text", bold?: boolean): Part => ({ t, tone, bold });
const paint = (parts: Part[], width: number): string => {
	const used = parts.reduce((n, p) => n + textWidth(p.t), 0);
	return [...parts, part(" ".repeat(Math.max(0, width - used)))].map(p => seg(p.t, T[p.tone], undefined, p.bold)).join("");
};
const partsWidth = (parts: Part[]): number => parts.reduce((n, p) => n + textWidth(p.t), 0);

/** Status mark and its tone. Unknown statuses read as pending. */
const MARK: Record<string, [string, keyof typeof TONE_HEX]> = { completed: ["✓", "ok"], in_progress: ["◉", "accent"], blocked: ["⏸", "warn"], pending: ["○", "muted"] };
const markOf = (status: string): Part => {
	const [g, tone] = MARK[status] ?? MARK.pending!;
	return part(g, tone);
};

/** Board text without the contract's `[phase] ` / `[label] ` prefix. */
const bare = (content: string): string => content.replace(/^\s*\[[^\]]+\]\s*/, "");

/** `width` cells: `━` in `tone` for the done share, dim `─` for the rest. */
function bar(frac: number, width: number, tone: keyof typeof TONE_HEX): Part[] {
	const whole = Math.round(Math.max(0, Math.min(1, frac)) * width);
	return [part("━".repeat(whole), tone), part("─".repeat(width - whole), "dim")].filter(p => p.t);
}

/** Cut a row to `cols` cells; runs are never split mid-run, so shorten the last ones. */
function fitRow(parts: Part[], cols: number): Part[] {
	const out: Part[] = [];
	let used = 0;
	for (const p of parts) {
		const w = textWidth(p.t);
		if (used + w <= cols) {
			out.push(p);
			used += w;
			continue;
		}
		const left = cols - used;
		if (left > 0) out.push({ ...p, t: fitText(p.t, left) });
		break;
	}
	return out;
}

const taskWord = (done: number, total: number): string => `${done} of ${total} task${total === 1 ? "" : "s"}`;

function collapsed(todos: PanelTodo[], width: number): string {
	const plan = todos.filter(isPlanItem); // the lead's plan only: per-subagent dispatch rows stay out of the count and the bar
	const done = plan.filter(t => t.status === "completed").length;
	const cur = todos.find(t => t.status === "in_progress");
	const tone = plan.length > 0 && done === plan.length ? "ok" : cur ? "accent" : "muted";
	const barW = Math.max(6, Math.min(24, Math.floor(width / 4)));
	const head = [part(" "), part(taskWord(done, plan.length), "text", true), part(" "), ...bar(done / Math.max(1, plan.length), barW, tone), part(" ")];
	const room = width - partsWidth(head) - 1;
	const tail = cur && room > 6 ? [markOf("in_progress"), part(` ${fitText(`${cur.owner ? `${cur.owner}: ` : ""}${bare(cur.content)}`, room - 2)}`)] : [];
	return paint(fitRow([...head, ...tail], width), width);
}

const cleanEvidence = (t: PanelTodo): string => (t.evidence ?? "").replace(/^\s*\d+[.)]\s*/, "").replace(/\s+/g, " ");

/** `✓ map the auth flow · explorer-1  rg auth -> 3 hits`; a blocked item says `blocked` before its evidence. */
function itemRow(t: PanelTodo, width: number, indent = ""): string {
	const head = [part(` ${indent}`), markOf(t.status), part(" ")];
	const owner = t.owner ? ` · ${fitText(t.owner, 14)}` : "";
	const blocked = t.status === "blocked" ? "  blocked" : "";
	const ev = cleanEvidence(t);
	const evText = ev ? `  ${ev}` : "";
	const room = width - partsWidth(head) - 1;
	const title = fitText(bare(t.content), Math.max(1, Math.max(10, ev ? Math.floor(room * 0.6) : room) - textWidth(owner) - textWidth(blocked)));
	const used = textWidth(title) + textWidth(owner) + textWidth(blocked);
	return paint(
		fitRow(
			[
				...head,
				part(title, t.status === "completed" ? "muted" : "text"),
				...(owner ? [part(owner, "muted")] : []),
				...(blocked ? [part(blocked, "warn")] : []),
				...(evText ? [part(fitText(evText, Math.max(0, room - used)), "muted")] : []),
			],
			width,
		),
		width,
	);
}

// Phase order of the operating contract (contracts/operating-contract.json); twin of mod/todo-panel.tsx.
const PHASE_ORDER = ["research", "theory", "test", "validate", "implement", "verify", "done"];

/** One heading per phase (`research  1 of 2`) followed by its items nested; items without a phase go last under `other`. */
function treeLines(todos: PanelTodo[], width: number): string[] {
	const groups: Array<[string, PanelTodo[]]> = [...PHASE_ORDER.map((p): [string, PanelTodo[]] => [p, todos.filter(t => t.phase === p)]), ["other", todos.filter(t => !t.phase || !PHASE_ORDER.includes(t.phase))]];
	return groups
		.filter(([, g]) => g.length)
		.flatMap(([name, g]) => {
			const done = g.filter(t => t.status === "completed").length;
			return [paint([part(` ${name}`, "text", true), part(`  ${done} of ${g.length}`, "muted")], width), ...g.map(t => itemRow(t, width, "  "))];
		});
}

function expandedLines(todos: PanelTodo[], o: TodoOpts): string[] {
	const lines = todos.some(t => t.phase) ? treeLines(todos, o.width) : todos.map(t => itemRow(t, o.width));
	if (lines.length <= o.maxLines) return lines;
	const shown = lines.slice(0, Math.max(0, o.maxLines - 1));
	return [...shown, paint([part(`   +${lines.length - shown.length} more`, "muted")], o.width)];
}

/** [] without todos, one row collapsed, else at most `maxLines` rows. */
export function todoLines(todos: PanelTodo[], o: TodoOpts): string[] {
	if (!todos.length || o.maxLines < 1) return [];
	return o.expanded ? expandedLines(todos, o) : [collapsed(todos, o.width)];
}
