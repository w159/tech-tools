// omp parity for the ATLAS side panel, worker card and toast: the painter draws the shared layout (mod/panel-layout.ts), so
// its plain text must equal the same goldens the Claude Code pane is held to (mod/panel-layout.test.ts, mod/pane/*).
import { expect, test } from "bun:test";
import { coreFixture, coreMatrix } from "../contracts/core-fixture";
import { cardDesign, tabGolden, toastDesign } from "../contracts/panel-golden";
import { panelWorld, worldCard } from "../contracts/panel-world";
import { type Ui } from "../mod/atlas-ui";
import { coreModel } from "../mod/data/core";
import { headerRows, PANEL_TABS } from "../mod/panel-layout";
import { goldenModel, goldenText } from "../mod/pane/sidebar.golden-cases";
import { panelModelOf } from "../mod/pane/sidebar-model";
import { paintCard, paintPanel, paintToast } from "./panel-view";

const mocha: Ui = { theme: "mocha", ascii: false, color: "truecolor" };
const mono: Ui = { theme: "mocha", ascii: true, color: "none" };
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips SGR
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const core = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });

for (const t of PANEL_TABS.map((x) => x.id)) {
	for (const cols of [120, 80, 56]) {
		test(`omp ${t} at ${cols} equals the golden the Claude pane is held to`, () => {
			expect(paintPanel(panelWorld(t, cols, mocha, { core })).map((r) => plain(r).trimEnd())).toEqual(tabGolden[t]![cols]!);
		});
	}
}

test("every omp row is exactly the panel width and sits on the rev 4 panel token #181825", () => {
	for (const cols of [120, 80, 56]) {
		for (const row of paintPanel(panelWorld("route", cols, mocha))) {
			expect([...plain(row)].length).toBe(cols);
			expect(row).toContain("48;2;24;24;37");
			expect(row).not.toContain("48;2;17;17;27"); // the legacy #11111b
		}
	}
});

test("NO_COLOR and ASCII: no escapes, no non-ASCII glyph", () => {
	for (const row of paintPanel(panelWorld("team", 80, mono, { core }))) {
		expect(row.replace(/\x1b\[[01]m/g, "")).not.toContain("\x1b"); // NO_COLOR keeps bold and strike, never a colour
		expect(plain(row)).toMatch(/^[\x20-\x7e]*$/);
	}
});

test("omp paints the same rows as the Claude tree for the same model: ribbon and body match, tab strip aside", () => {
	for (const k of ["route", "team", "channel", "gates", "core", "cols38"]) {
		const m = goldenModel(k);
		const ui = mocha;
		const pm = panelModelOf(m, ui, Math.max(10, m.columns - 1));
		const omp = paintPanel(pm).map((r) => plain(r).trimEnd());
		const cc = goldenText(k).split("\n").map((r) => r.trimEnd());
		const head = headerRows(pm).length;
		// the Claude tree adds the message input row after the body and draws `k: ` before each hotkey tab
		expect(omp[0]).toBe(cc[0]!);
		const body = omp.slice(head).filter(Boolean);
		expect(body.length).toBeGreaterThan(0);
		expect(cc).toEqual(expect.arrayContaining(body));
	}
});

test("omp card equals the design card at 44, 80 and 120 columns, closed box", () => {
	for (const cols of [120, 80]) expect(paintCard(worldCard(mocha), cols).map((r) => plain(r).trimEnd())).toEqual(cardDesign[cols]!);
	expect(paintCard(worldCard(mocha), 44).map((r) => plain(r).trimEnd())).toEqual(cardDesign[80]!); // always 44 wide, whatever the room
	for (const r of paintCard(worldCard(mocha), 44)) expect([...plain(r)].length).toBe(44);
});

test("omp toast: state first, then the name, then one fact", () => {
	expect(plain(paintToast("done", "implementer-layout", "9 of 9 steps", mocha))).toBe(toastDesign[0]!);
	expect(plain(paintToast("failed", "implementer-live", "tests red 3", mocha))).toBe(toastDesign[1]!);
});
