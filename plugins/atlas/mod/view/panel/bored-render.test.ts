// The bored tab body: crop to the pane, distinct connecting and error rows, xterm-256 to hex by formula.
import { describe, expect, test } from 'claude-code/testing';
import { boredRows, xtermHex } from './bored-render';
import type { BoredView } from './bored-types';
import { createBoredVt } from './bored-vt';
import type { PanelModel } from './panel-shared';

const model = (bored: BoredView | undefined, cols = 10, rows = 3): PanelModel => ({ cols, rows, bored }) as unknown as PanelModel;
const text = (l: { runs: readonly { t: string }[] }): string => l.runs.map((x) => x.t).join('');

const screenOf = (feed: string): BoredView => {
	const vt = createBoredVt();
	vt.feed(feed);
	return { status: 'streaming', screen: vt.snapshot(), seq: 1 };
};

describe('boredRows', () => {
	test('connecting and error rows are distinct', () => {
		const connecting = boredRows(model({ status: 'connecting', screen: null, seq: 0 }), 5).map(text);
		const failed = boredRows(model({ status: 'error', error: 'ssh exited with code 255', screen: null, seq: 0 }), 5).map(text);
		expect(connecting).toEqual(['connecting to ascii.theater...']);
		expect(failed[0]).toContain('ssh exited with code 255');
		expect(failed[1]).toContain('leave this tab and open it again to retry');
		expect(failed).not.toEqual(connecting);
	});

	test('crops to the pane columns and the room', () => {
		const feed = ['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30), 'd'.repeat(30)].join('\r\n');
		const rows = boredRows(model(screenOf(feed), 10), 2);
		expect(rows.length).toBe(2);
		expect(rows.map(text)).toEqual(['a'.repeat(10), 'b'.repeat(10)]);
	});

	test('cells with the same colours merge, colours map to hex', () => {
		const rows = boredRows(model(screenOf('\u001b[38;5;196mab\u001b[48;5;21mc')), 3);
		const runs = rows[0]!.runs;
		expect(runs.map((x) => x.t)).toEqual(['ab', 'c']);
		expect(runs[0]!.fg).toBe(xtermHex(196));
		expect(runs[1]!.bgHex).toBe(xtermHex(21));
	});

	test('a streaming view with no frame yet reads as connecting; closed says so', () => {
		expect(boredRows(model({ status: 'streaming', screen: null, seq: 0 }), 3).map(text)).toEqual(['connecting to ascii.theater...']);
		const closed = boredRows(model({ ...screenOf('hi'), status: 'closed' }), 5).map(text);
		expect(closed[closed.length - 1]).toContain('stream ended');
	});
});

describe('xtermHex', () => {
	test('known points of the xterm-256 palette', () => {
		expect(xtermHex(196)).toBe(`#${'ff'}${'00'}${'00'}`);
		expect(xtermHex(21)).toBe(`#${'00'}${'00'}${'ff'}`);
		expect(xtermHex(16)).toBe(`#${'00'}${'00'}${'00'}`);
		expect(xtermHex(231)).toBe(`#${'ff'}${'ff'}${'ff'}`);
		expect(xtermHex(232)).toBe(`#${'08'}${'08'}${'08'}`);
		expect(xtermHex(255)).toBe(`#${'ee'}${'ee'}${'ee'}`);
	});
});
