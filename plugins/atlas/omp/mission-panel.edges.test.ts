// Edge pins for omp/mission-panel.ts (surviving mutants of the 553a9bce run): the panel-fill tail of a row that is shorter than the
// panel in code points (colour vs NO_COLOR), the real gates spawner, and bandText.
import { expect, test } from "bun:test";
import { worldModel } from "../contracts/band-world";
import { PALETTES, sgrColor, type Ui } from "../mod/atlas-ui";
import { bandText, paintMission, spawnText, type PanelModel } from "./mission-panel";

const mocha: Ui = { theme: "mocha", ascii: false, color: "truecolor" };
const RST = "\x1b[0m";
const esc = (s: string) => s.replace(/[[\]]/g, "\\$&");
// Wide (two-cell) glyphs make a row shorter than the panel in code points: that is the one way a painted row gets the fill tail.
const wide = (ui: Ui) => paintMission(worldModel(80, ui, { rich: true, maxRows: 3, project: "漢字漢字漢字", workers: [{ name: "漢字-0001", state: "running", secs: 0 }, { name: "実装-0002", state: "done", secs: 0 }] }));

test("with colour a short row ends in the panel background, its blanks, then the reset", () => {
	const fill = `\x1b[${sgrColor(PALETTES.mocha.panel, 48, "truecolor")}m`;
	const tail = new RegExp(`${esc(RST)}${esc(fill)} +${esc(RST)}$`);
	expect(wide(mocha).some((l) => tail.test(l))).toBe(true);
});

test("NO_COLOR: the fill tail is plain blanks, with no empty SGR (`ESC[m`) and no background code anywhere", () => {
	const lines = wide({ ...mocha, color: "none" });
	expect(lines.length).toBeGreaterThan(0);
	for (const l of lines) {
		expect(l).not.toContain("\x1b[m");
		expect(l).not.toMatch(/\x1b\[[0-9;]*4[89];/);
	}
	expect(lines.some((l) => new RegExp(`${esc(RST)} +${esc(RST)}$`).test(l))).toBe(true);
});

test("spawnText resolves with the command's stdout and rejects on a nonzero exit", async () => {
	expect(await spawnText(["sh", "-c", "printf gates-out"])).toBe("gates-out");
	await expect(spawnText(["sh", "-c", "exit 3"])).rejects.toThrow("gates exit 3");
});

test("bandText returns the band rows as trimmed plain text", () => {
	const m: PanelModel = {
		width: 140, maxLines: 12, phase: "implement", spin: "◆", laneSpin: "⠋", tick: 0, done: 0, total: 0,
		workers: [{ name: "implementer-0001", secs: 30, role: "implementer", tool: { tool: "edit", target: "a.ts", active: true } }], notes: [], gates: [], channel: "demo@master/lead-1", ui: mocha,
	};
	const rows = bandText(m, 140);
	expect(Array.isArray(rows)).toBe(true);
	expect(rows.length).toBeGreaterThan(0);
	expect(rows[0]).toContain("◖ ◆ ATLAS ◗  ⠋ working");
	expect(rows[0]).toContain("implement");
	for (const r of rows) {
		expect(r).toBe(r.trimEnd());
		expect(r).not.toContain("\x1b");
	}
});
