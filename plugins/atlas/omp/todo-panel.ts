/**
 * The Atlas Board for the omp widget (design rev 4), twin of mod/todo-panel.tsx: both draw the lines of mod/board-model.ts,
 * so the two hosts print the same strings. `todoLines` is the board slot of the mission panel (header and one row per item,
 * capped by the line budget with `+N more`); `boardLines` is the whole surface with its ribbon. Each Run is painted in ANSI
 * from the shared tokens and every line is filled with the panel background to exactly `width` cells. Pure.
 */
import { hostEnv, paintAnsi, sgrColor, surfaceHex, uiFromEnv, type Run, type Ui } from "../mod/atlas-ui";
import { boardBody, boardLines as modelLines, boardRowsOf, type BoardLine, type BoardSource } from "../mod/board-model";
import type { MotionCtx } from "../mod/motion";
import { RST } from "./panel-paint";

export interface PanelTodo extends BoardSource {
	status: string;
	phase?: string;
}
export interface TodoOpts {
	width: number;
	/** The spinner frame of the running row. */
	tick: number;
	/** Kept for callers; the board draws its own spinner from `tick`. */
	spin?: string;
	expanded: boolean;
	maxLines: number;
	/** Epoch seconds: times the running item. */
	now?: number;
	ui?: Ui;
	rich?: boolean;
	/** Motion view (mod/motion.ts); absent: the resting render. */
	motion?: MotionCtx | undefined;
}

/** One run in ANSI: bold/strike, the tone on the run's fill or the panel; NO_COLOR keeps bold and strike only. */
const paintRun = (x: Run, ui: Ui): string => {
	return paintAnsi(x, ui);
};
const fillOf = (ui: Ui): string => (ui.color === "none" ? "" : `\x1b[${sgrColor(surfaceHex("panel", ui), 48, ui.color)}m`);

/** A line painted and padded with the panel fill to `width`. */
function paintLine(l: BoardLine, width: number, ui: Ui): string {
	const cells = [...l.runs.map(x => x.t).join("")].length;
	const fill = cells < width ? `${fillOf(ui)}${" ".repeat(width - cells)}${ui.color === "none" ? "" : RST}` : "";
	return l.runs.map(x => paintRun(x, ui)).join("") + fill;
}

const moreLine = (n: number): BoardLine => ({ runs: [{ t: `  +${n} more`, tone: "muted" }] });
function cap(lines: BoardLine[], max: number): BoardLine[] {
	if (lines.length <= max) return lines;
	const shown = lines.slice(0, Math.max(0, max - 1));
	return [...shown, moreLine(lines.length - shown.length)];
}
const richEnv = (): boolean => hostEnv().ATLAS_BAND_RICH === "1";

/** [] without todos or room, else the header and one row per item, at most `maxLines`. */
export function todoLines(todos: PanelTodo[], o: TodoOpts): string[] {
	if (!todos.length || o.maxLines < 1 || !o.expanded) return [];
	const ui = o.ui ?? uiFromEnv();
	const body = boardBody(boardRowsOf(todos, o.now), { cols: o.width, ui, rich: o.rich ?? richEnv(), tick: o.tick, motion: o.motion });
	return cap(body, o.maxLines).map(l => paintLine(l, o.width, ui));
}

/** The whole board surface (ribbon, blank row, header, items) as ANSI lines of exactly `width` cells. */
export function boardLines(todos: PanelTodo[], o: Pick<TodoOpts, "width" | "tick" | "now" | "ui" | "rich" | "motion"> & { maxLines?: number }): string[] {
	const ui = o.ui ?? uiFromEnv();
	const at = { cols: o.width, ui, rich: o.rich ?? richEnv(), tick: o.tick, motion: o.motion };
	const lines = todos.length ? modelLines(boardRowsOf(todos, o.now), at) : [...modelLines([], at), { runs: [{ t: "  (no state)", tone: "muted" as const }] }];
	return cap(lines, o.maxLines ?? lines.length).map(l => paintLine(l, o.width, ui));
}
