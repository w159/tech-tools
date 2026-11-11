/**
 * The TODO tree and Subagents block for omp, drawn by the same host-free rows as Claude Code (mod/hud-surface.ts via
 * mod/hud.ts hudLines), so both hosts show identical text, columns and states. This file only paints Runs as ANSI,
 * the way omp/mission-panel.ts paints the band. omp draws its own native Subagents widget; `paintHud` is the shared
 * draw for any Atlas widget that shows agents (the TODO fallback passes none).
 */
import { paintAnsi, runsString, uiFromEnv, type Run, type Ui } from "../mod/atlas-ui";
import { hudLines, type HudInput, type HudOpts } from "../mod/hud";

/** One run in ANSI: bold/strike, the tone foreground on the run's fill or the rev 4 panel; NO_COLOR keeps bold and strike only. */
export function paintRun(x: Run, ui: Ui): string {
	if (x.t === "") return "";
	return paintAnsi(x, ui);
}

/** The HUD as ANSI rows, each padded to `opts.cols`. */
export function paintHud(input: HudInput, opts: HudOpts): string[] {
	const ui = opts.ui ?? uiFromEnv();
	return hudLines(input, { ...opts, ui }).map(row => row.map(x => paintRun(x, ui)).join(""));
}

/** The HUD as plain text rows (trailing spaces trimmed): what the goldens compare. */
export function hudText(input: HudInput, opts: HudOpts): string[] {
	const ui = opts.ui ?? uiFromEnv();
	return hudLines(input, { ...opts, ui }).map(row => runsString(row).trimEnd());
}
