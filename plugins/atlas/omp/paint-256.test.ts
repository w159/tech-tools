// omp painters are paintAnsi: in 256-colour mode the foreground is the stable palette colour runHex names and the fill is 48;5;234 on Mocha.
import { expect, test } from "bun:test";
import { paintAnsi, stable256Indices, type Run, type Tone, type Ui } from "../mod/atlas-ui";
import { paintRun as hudRun } from "./hud-paint";
import { renderPanel, type PanelModel } from "./mission-panel";
import { paintRun as panelRun } from "./panel-view";
import { boardLines } from "./todo-panel";

const TONES: Tone[] = ["text", "sub", "muted", "ok", "run", "warn", "bad", "info", "accent"];
const ui: Ui = { theme: "mocha", ascii: false, color: "256" };
const model: PanelModel = { width: 120, maxLines: 12, phase: "implement", spin: "◆", laneSpin: "⠋", tick: 0, done: 0, total: 1, workers: [], notes: [], gates: [], ui };
const fgs = (s: string): string[] => s.match(/38;5;\d+/g) ?? [];

test("panel-view and hud-paint paint every tone exactly as paintAnsi does", () => {
	for (const tone of TONES) {
		const x: Run = { t: "x", tone, bold: true };
		expect(panelRun(x, ui)).toBe(paintAnsi(x, ui));
		expect(hudRun(x, ui)).toBe(paintAnsi(x, ui));
	}
	expect(panelRun({ t: "x", tone: "text" }, ui)).toContain("48;5;234");
});
test("mission band and todo board draw only stable palette colours", () => {
	const allowed = new Set(stable256Indices().map((i) => `38;5;${i}`));
	const out = [...renderPanel(model), ...boardLines([{ content: "t", status: "in_progress", owner: "a" }], { width: 100, tick: 0, ui })];
	const used = out.flatMap(fgs);
	expect(used.length).toBeGreaterThan(0);
	for (const f of used) expect(allowed.has(f)).toBe(true);
	expect(out.join("")).toContain("48;5;234");
});
