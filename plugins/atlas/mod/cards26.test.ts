// Critique 23, steps 5 and 6: the board's Gantt, the killed row in error red, the channel's remembered Stop refusal, and the one plan meter.
import { describe, expect, test } from 'claude-code/testing';
import { forgetRefusals, noteRefusal, refusalNotes } from './data/channels';
import { TODO_METER_W, todoMeter, type Ui } from './atlas-ui';
import { boardText, boardTimeline } from './board-model';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };

describe('the board timeline is a Gantt', () => {
  const agents = [
    { name: 'alpha-explorer', state: 'done' as const, secs: 10, startMs: 0, endMs: 10_000 },
    { name: 'beta-explorer', state: 'running' as const, secs: 10, startMs: 10_000, endMs: 20_000 },
    { name: 'gamma', state: 'failed' as const, secs: 5, startMs: 5_000, endMs: 10_000 },
  ];
  const lines = boardTimeline(agents, { cols: 60, ui: mocha });
  const text = boardText(lines);
  const bars = (t: string): { from: number; len: number } => ({ from: t.indexOf('━'), len: [...t].filter((c) => c === '━').length });
  test('each bar starts at its agent start offset within the run', () => {
    const [a, b, g] = [text[0]!, text[2]!, text[4]!].map(bars);
    expect(a!.from).toBeLessThan(g!.from);
    expect(g!.from).toBeLessThan(b!.from);
    expect(g!.len).toBeLessThan(a!.len);
  });
  test('bars take the state colour: running 141, done 114, failed 203; the time axis closes the chart', () => {
    const tone = (i: number) => lines[i]!.runs.find((r) => r.t.includes('━'))?.tone;
    expect([tone(0), tone(2), tone(4)]).toEqual(['ok', 'accent', 'bad']);
    expect(text.at(-1)).toMatch(/0s ─+ 20s$/);
  });
  test('a pane with no room for a name and a bar draws no chart', () => {
    expect(boardTimeline(agents, { cols: 20, ui: mocha })).toEqual([]);
  });
});

describe('the channel remembers a Stop refusal', () => {
  test('recorded once on the flip to blocked, kept after Stop passes, per channel', () => {
    forgetRefusals();
    const stop = { blocked: true, gates: ['team gate'] };
    noteRefusal(stop, Date.UTC(2026, 10, 11, 10, 2), 'c1');
    noteRefusal(stop, Date.UTC(2026, 10, 11, 10, 3), 'c1'); // the same verdict again records nothing
    noteRefusal({ blocked: false, gates: [] }, Date.UTC(2026, 10, 11, 10, 4), 'c1');
    expect(refusalNotes('c1').map((n) => n.text)).toEqual(['Stop refused: team gate']);
    expect(refusalNotes('c2')).toEqual([]);
    forgetRefusals();
  });
});

describe('the plan meter is the HUD figure', () => {
  test('8 cells, ok green filled, never empty once one item is done, full only when all are', () => {
    const cells = (d: number, t: number) => todoMeter(d, t, mocha).map((r) => r.t).join('');
    expect(cells(3, 7)).toHaveLength(TODO_METER_W);
    expect(todoMeter(3, 7, mocha)[0]).toMatchObject({ tone: 'ok' });
    expect(cells(1, 100)).toBe('▰▱▱▱▱▱▱▱');
    expect(cells(99, 100)).toBe('▰▰▰▰▰▰▰▱');
    expect(cells(7, 7)).toBe('▰▰▰▰▰▰▰▰');
  });
});
