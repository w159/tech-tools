/**
 * omp painter for the ATLAS side panel, worker card and toast (design system rev 4). UNMOUNTED: nothing in omp imports
 * `paintPanel`, `paintCard` or `paintToast` (omp/index.ts, channel-view.ts and todo-fallback.ts draw through their own
 * painters), and omp has no host surface for them: it has no docked pane for a tabbed panel, draws no transcript cards, and its
 * only toast-like surface (`ctx.ui.notify`) takes plain text, which is what `toastText` in mod/panel-layout.ts gives. They are
 * kept as the omp half of the shared layout (mod/panel-layout.ts) so a future mount paints the same rows; until then
 * omp/panel-view.test.ts is a painter parity test, NOT evidence that any omp surface shows a side panel, card or toast.
 */
import { cells, paintAnsi, uiFromEnv, type Run, type Ui } from "../mod/atlas-ui";
import { cardLines, panelLines, toastRuns, type CardModel, type PanelModel } from "../mod/panel-layout";


/** One run in ANSI: bold/strike, the tone foreground on the run's fill or the panel; NO_COLOR keeps bold and strike only. */
export function paintRun(x: Run, ui: Ui): string {
	return paintAnsi(x, ui);
}

/** A row of runs painted and padded to `cols` cells on the panel fill. */
export function paintRow(runs: readonly Run[], cols: number, ui: Ui): string {
	const used = runs.reduce((n, x) => n + cells(x.t), 0);
	const fill: Run = { t: " ".repeat(Math.max(0, cols - used)), tone: "text" };
	return [...runs, fill].map((x) => paintRun(x, ui)).join("");
}

/** The side panel (ribbon, tab strip, the active tab) as ANSI rows. Unmounted: no omp surface calls it. */
export const paintPanel = (m: PanelModel): string[] => panelLines(m).map((l) => paintRow(l.runs, m.cols, m.ui));

/** A worker card as ANSI rows (closed box, `min(44, cols)` wide). Unmounted: omp draws no transcript cards. */
export function paintCard(c: CardModel, cols = 120): string[] {
	return cardLines(c, cols).map((runs) => paintRow(runs, runs.reduce((n, x) => n + cells(x.t), 0), c.ui));
}

/** A toast as one ANSI row: state, name, one fact. Unmounted: omp's `ctx.ui.notify` is plain text and nothing calls this. */
export function paintToast(state: Parameters<typeof toastRuns>[0], name: string, fact: string, ui: Ui = uiFromEnv()): string {
	return toastRuns(state, name, fact, ui).map((x) => paintRun(x, ui)).join("");
}
