// bored-render.ts: the bored tab body. Crops the ASCII Theater screen buffer to the pane (cols x room) and draws
// connecting and error states. Colours: xterm-256 index to #rrggbb by formula, so no hex literal lives here
// (tree-guards M5 allows hex only in design/atlas-ui.ts).
import type { Run } from '../../design/atlas-ui';
import type { BoredCell } from './bored-types';
import { type PanelLine, type PanelModel, r } from './panel-shared';

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const rgbHex = (red: number, green: number, blue: number): string => `#${hex2(red)}${hex2(green)}${hex2(blue)}`;

/** The xterm-256 palette by formula: 0-15 system colours, 16-231 a 6x6x6 cube, 232-255 a grey ramp. */
export function xtermHex(index: number): string {
	const n = Math.max(0, Math.min(255, Math.trunc(index)));
	if (n < 16) {
		const base = n & 7;
		if (base === 7 && n < 8) return rgbHex(229, 229, 229); // 7: light grey, the one system colour that is not a pure channel mix
		if (n === 8) return rgbHex(127, 127, 127); // 8: dark grey
		const level = n > 7 ? 255 : 205;
		return rgbHex((base & 1) * level, ((base >> 1) & 1) * level, ((base >> 2) & 1) * level);
	}
	if (n < 232) {
		const c = n - 16;
		const step = (k: number): number => (k === 0 ? 0 : 55 + 40 * k);
		return rgbHex(step(Math.floor(c / 36)), step(Math.floor(c / 6) % 6), step(c % 6));
	}
	const grey = 8 + 10 * (n - 232);
	return rgbHex(grey, grey, grey);
}

/** One screen row as runs: neighbours with the same colours merge into one run. */
function rowRuns(cells: readonly BoredCell[], cols: number): Run[] {
	const runs: Run[] = [];
	let cur: { text: string; fg: number | null; bg: number | null } | null = null;
	const flush = (): void => {
		if (cur === null) return;
		runs.push(r(cur.text, 'text', { ...(cur.fg !== null ? { fg: xtermHex(cur.fg) } : {}), ...(cur.bg !== null ? { bgHex: xtermHex(cur.bg) } : {}) }));
		cur = null;
	};
	for (const cell of cells.slice(0, cols)) {
		if (cur !== null && cur.fg === cell.fg && cur.bg === cell.bg) cur.text += cell.ch;
		else { flush(); cur = { text: cell.ch, fg: cell.fg, bg: cell.bg }; }
	}
	flush();
	return runs;
}

const RETRY_HINT = 'leave this tab and open it again to retry';

/** The bored tab: the live screen cropped to `m.cols` and `room` rows, or the connecting and error rows. */
export function boredRows(m: PanelModel, room: number): PanelLine[] {
	const view = m.bored;
	const fit = (rows: PanelLine[]): PanelLine[] => rows.slice(0, Math.max(0, room));
	if (view === undefined || view.status === 'connecting' || (view.screen === null && view.status === 'streaming')) {
		return fit([{ runs: [r('connecting to ascii.theater...', 'muted')] }]);
	}
	if (view.status === 'error') {
		const why = (view.error ?? 'the stream failed').replace(/\s+/g, ' ').trim();
		return fit([{ runs: [r(`ascii.theater: ${why}`, 'bad')] }, { runs: [r(RETRY_HINT, 'muted')] }]);
	}
	const screen = view.screen;
	const shown: PanelLine[] = screen === null ? [] : screen.cells.map((cells) => ({ runs: rowRuns(cells, m.cols) }));
	if (view.status === 'closed') shown.push({ runs: [r(`stream ended: ${RETRY_HINT}`, 'muted')] });
	return fit(shown);
}
