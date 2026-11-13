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
  const FILL = /▇/;
  // Wave 30: solid bars (a full block, the end exact to an eighth of a cell), one row per agent, the axis is two rows (ticks, labels).
  const bars = (t: string): { from: number; len: number } => ({ from: [...t].findIndex((c) => FILL.test(c)), len: [...t].filter((c) => FILL.test(c)).length });
  test('each bar starts at its agent start offset within the run', () => {
    const [a, g, b] = [text[0]!, text[1]!, text[2]!].map(bars); // wave 31: rows are in start order (alpha 0, gamma 5, beta 10)
    expect(a!.from).toBeLessThan(g!.from);
    expect(g!.from).toBeLessThan(b!.from);
    expect(g!.len).toBeLessThan(a!.len);
  });
  test('bars take the state colour: running 141, done 114, failed 203; the time axis closes the chart with tick marks and labels', () => {
    const tone = (i: number) => lines[i]!.runs.find((r) => FILL.test(r.t))?.tone;
    expect([tone(0), tone(1), tone(2)]).toEqual(['ok', 'bad', 'accent']); // start order
    expect(text.at(-2)).toMatch(/^ +┬[─┬]+$/);
    expect(text.at(-1)).toMatch(/0:00 +0:10 +0:20$/); // wave 38: the axis ends at the run's length (20 s) rounded up to 10 s, a tick every 10 s
  });
  test('critique 25: the axis scales to the longest bar end: no bar runs past the axis rule, and the rule ends where the longest bar does', () => {
    for (const cols of [60, 80, 120]) {
      const t = boardText(boardTimeline(agents, { cols, ui: mocha }));
      const rule = t.at(-2)!;
      const barEnds = t.slice(0, -2).map((l) => [...l].reduce((e, c, i) => (FILL.test(c) ? i : e), -1));
      expect([cols, Math.max(...barEnds) <= rule.length - 1]).toEqual([cols, true]);
      expect([cols, rule.length - 1 - Math.max(...barEnds) >= 0]).toEqual([cols, true]); // wave 31: the axis runs past the longest bar (the last tick), never short of it
      expect(t.at(-1)).toMatch(/0:00 .*0:20$/);
    }
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
