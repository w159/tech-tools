// bored-vt.ts: a pure screen buffer for the ASCII Theater stream (watch.ascii.theater).
// The stream uses only ESC[2J, ESC[H, ESC[row;colH, ESC[0m, ESC[38;5;Nm, ESC[48;5;Nm and text. The remote pty size is
// unknown, so the grid grows on demand up to MAX_COLS x MAX_ROWS and the renderer crops to the pane.
import type { BoredCell, BoredScreen } from './bored-types';

export const MAX_COLS = 200;
export const MAX_ROWS = 80;
const ESC = '\u001b';
const BLANK_CELL: BoredCell = { ch: ' ', fg: null, bg: null };

export type BoredVt = { feed(chunk: string): void; snapshot(): BoredScreen };

/** Params of a CSI sequence as numbers; an empty field is 0 (the VT default the callers then map). */
const numsOf = (params: string): number[] => params.split(';').map((p) => (p === '' ? 0 : Number.parseInt(p, 10) || 0));

export function createBoredVt(): BoredVt {
	let grid: BoredCell[][] = [];
	let cols = 0; // the extent ever written: it only grows, so a redraw from home never shrinks the frame
	let rows = 0;
	let row = 0;
	let col = 0;
	let fg: number | null = null;
	let bg: number | null = null;
	let pending = ''; // an escape cut by the chunk boundary, completed by the next feed

	const put = (ch: string): void => {
		if (row >= MAX_ROWS || col >= MAX_COLS) return; // past the cap: dropped, never wrapped
		while (grid.length <= row) grid.push([]);
		const line = grid[row]!;
		while (line.length < col) line.push(BLANK_CELL);
		line[col] = { ch, fg, bg };
		col += 1;
		cols = Math.max(cols, col);
		rows = Math.max(rows, row + 1);
	};

	const sgr = (params: string): void => {
		const n = numsOf(params);
		for (let i = 0; i < n.length; i++) {
			const p = n[i]!;
			if (p === 0) { fg = null; bg = null; }
			else if (p === 39) fg = null;
			else if (p === 49) bg = null;
			else if (p === 38 || p === 48) {
				const mode = n[i + 1];
				if (mode === 5) {
					const v = n[i + 2];
					if (v !== undefined) { if (p === 38) fg = v; else bg = v; }
					i += 2;
				} else if (mode === 2) i += 4; // truecolor is not in the stream; skip its three components
			}
		}
	};

	const csi = (params: string, final: string): void => {
		if (final === 'm') return sgr(params);
		if (final === 'H' || final === 'f') {
			const [r = 0, c = 0] = numsOf(params);
			row = Math.max(1, r) - 1; // row and col may be 0: treat as 1
			col = Math.max(1, c) - 1;
		} else if (final === 'J' && numsOf(params)[0] === 2) {
			grid = []; // the extent stays so the frame does not jump
		}
	};

	const feed = (chunk: string): void => {
		const s = pending + chunk;
		pending = '';
		let i = 0;
		while (i < s.length) {
			if (s[i] === ESC) {
				if (i + 1 >= s.length) { pending = s.slice(i); return; }
				if (s[i + 1] !== '[') { i += 2; continue; } // a non-CSI escape: ignored
				let j = i + 2;
				while (j < s.length && s.charCodeAt(j) >= 0x20 && s.charCodeAt(j) <= 0x3f) j++;
				if (j >= s.length) { pending = s.slice(i); return; } // no final byte yet: wait for the next chunk
				csi(s.slice(i + 2, j).replace(/[^0-9;]/g, ''), s[j]!);
				i = j + 1;
				continue;
			}
			const cp = s.codePointAt(i)!;
			const g = String.fromCodePoint(cp);
			i += g.length;
			if (g === '\n') { row += 1; col = 0; }
			else if (g === '\r') col = 0;
			else if (cp >= 0x20 && cp !== 0x7f) put(g);
		}
	};

	const snapshot = (): BoredScreen => ({
		cols,
		rows,
		cells: Array.from({ length: rows }, (_, r) => {
			const line = grid[r] ?? [];
			return Array.from({ length: cols }, (_, c) => line[c] ?? BLANK_CELL);
		}),
	});

	return { feed, snapshot };
}
