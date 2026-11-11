/**
 * omp painter for the ATLAS side panel, worker card and toast (design system rev 4). omp has no docked pane to mount a
 * tabbed panel in, so this is the host half of the shared layout (mod/panel-layout.ts): the same rows the Claude Code pane
 * draws, as ANSI strings, each padded to the panel width on the rev 4 panel token. Parity is structural (the text comes from
 * the layout) and asserted in omp/panel-view.test.ts against the same goldens as mod/panel-layout.test.ts.
 */
import { cells, hostEnv, PALETTES, sgrColor, toneHex, uiFromEnv, type Run, type Ui } from "../mod/atlas-ui";
import { cardLines, panelLines, toastRuns, type CardModel, type PanelModel } from "../mod/panel-layout";

const RST = "\x1b[0m";

/** One run in ANSI: bold/strike, the tone foreground on the run's fill or the panel; NO_COLOR keeps bold and strike only. */
export function paintRun(x: Run, ui: Ui): string {
	const p = PALETTES[ui.theme];
	const sgr = [x.bold ? "1" : "", x.strike ? "9" : "", sgrColor(toneHex(x.tone, ui.theme), 38, ui.color), sgrColor(x.bg ? p[x.bg] : p.panel, 48, ui.color)].filter(Boolean).join(";");
	return sgr ? `\x1b[${sgr}m${x.t}${RST}` : x.t;
}

/** A row of runs painted and padded to `cols` cells on the panel fill. */
export function paintRow(runs: readonly Run[], cols: number, ui: Ui): string {
	const used = runs.reduce((n, x) => n + cells(x.t), 0);
	const fill: Run = { t: " ".repeat(Math.max(0, cols - used)), tone: "text" };
	return [...runs, fill].map((x) => paintRun(x, ui)).join("");
}

/** The side panel (ribbon, tab strip, the active tab) as ANSI rows. */
export const paintPanel = (m: PanelModel): string[] => panelLines(m).map((l) => paintRow(l.runs, m.cols, m.ui));

/** A worker card as ANSI rows (closed box, `min(44, cols)` wide). */
export function paintCard(c: CardModel, cols = 120): string[] {
	return cardLines(c, cols).map((runs) => paintRow(runs, runs.reduce((n, x) => n + cells(x.t), 0), c.ui));
}

/** A toast as one ANSI row: state, name, one fact. */
export function paintToast(state: Parameters<typeof toastRuns>[0], name: string, fact: string, ui: Ui = uiFromEnv(hostEnv())): string {
	return toastRuns(state, name, fact, ui).map((x) => paintRun(x, ui)).join("");
}
