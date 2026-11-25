// The ASCII Theater screen buffer: the escapes the stream uses, a split escape, unknown sequences, the size cap.
import { describe, expect, test } from 'claude-code/testing';
import { createBoredVt, MAX_COLS, MAX_ROWS } from './bored-vt';

const E = '\u001b';
const SAMPLE = `${E}[2J${E}[H${E}[3;5H${E}[38;5;196mx${E}[48;5;21my${E}[0mz`;

describe('bored-vt', () => {
	test('positions text and applies 256-colour sgr', () => {
		const vt = createBoredVt();
		vt.feed(SAMPLE);
		const s = vt.snapshot();
		expect(s.rows).toBe(3);
		expect(s.cols).toBe(7);
		expect(s.cells[2]![4]).toEqual({ ch: 'x', fg: 196, bg: null });
		expect(s.cells[2]![5]).toEqual({ ch: 'y', fg: 196, bg: 21 }); // fg carries until reset; the bg is new
		expect(s.cells[2]![6]).toEqual({ ch: 'z', fg: null, bg: null }); // ESC[0m resets both
	});

	test('an escape split across two chunks parses the same, at every cut point', () => {
		const whole = createBoredVt();
		whole.feed(SAMPLE);
		for (let cut = 1; cut < SAMPLE.length; cut++) {
			const vt = createBoredVt();
			vt.feed(SAMPLE.slice(0, cut));
			vt.feed(SAMPLE.slice(cut));
			expect(vt.snapshot()).toEqual(whole.snapshot());
		}
	});

	test('row and col 0 mean 1, a bare home is 1;1', () => {
		const vt = createBoredVt();
		vt.feed(`${E}[0;0Ha${E}[Hb`);
		expect(vt.snapshot().cells[0]![0]!.ch).toBe('b');
	});

	test('ESC[2J clears the cells but the frame keeps its size', () => {
		const vt = createBoredVt();
		vt.feed(`${E}[2;3Hq${E}[2J${E}[Hw`);
		const s = vt.snapshot();
		expect([s.cols, s.rows]).toEqual([3, 2]);
		expect(s.cells[1]![2]!.ch).toBe(' ');
		expect(s.cells[0]![0]!.ch).toBe('w');
	});

	test('unknown sequences are ignored and do not leak into the text', () => {
		const vt = createBoredVt();
		vt.feed(`${E}[?25l${E}[1;4mA${E}=${E}[Kb${E}[38;2;1;2;3mc`);
		expect(vt.snapshot().cells[0]!.map((c) => c.ch).join('')).toBe('Abc');
	});

	test('the grid stops at 200 columns and 80 rows', () => {
		const vt = createBoredVt();
		vt.feed(`${E}[1;1H${'a'.repeat(500)}${E}[200;1Hz`);
		const s = vt.snapshot();
		expect(s.cols).toBe(MAX_COLS);
		expect(s.rows).toBeLessThanOrEqual(MAX_ROWS);
	});
});
