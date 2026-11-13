// Design rev 5, slice C2: a pane with nothing to show says so in one dim centred line and uses the rest of the space for nothing (no wrapped hint, no `(no state)` lead-in).
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import { cells, uiFromEnv } from './atlas-ui';
import { bodyLines, lineText, type PanelModel, type PanelTab } from './panel-layout';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const body = (t: PanelTab, cols: number, over: Partial<PanelModel> = {}) => bodyLines(panelWorld(t, cols, ui, { rows: 24, ...over }));

const CASES: { tab: PanelTab; over: Partial<PanelModel>; said: string; head: number; left?: boolean }[] = [ // `left`: wave 32 (critique 30) moved the empty channel's line from the pane's middle to the left edge, under the head
  { tab: 'team', over: { workers: [], mates: [], lead: undefined }, said: 'nobody dispatched yet', head: 0 },
  { tab: 'channel', over: { notes: [], workers: [], mates: [], lead: undefined }, said: '○ no messages', head: 1, left: true },
  { tab: 'gates', over: { gates: [] }, said: 'no gates reported yet', head: 0 },
  { tab: 'core', over: { core: null }, said: 'no verdicts, workers or gates yet', head: 0 },
];

describe('C2: an empty pane is one dim centred line', () => {
  for (const cols of [38, 49, 80]) {
    for (const c of CASES) {
      test(`${c.tab} at ${cols}: ${c.said}`, () => {
        const rows = body(c.tab, cols, c.over);
        const sayRow = rows.filter((l) => lineText(l).includes(c.said));
        expect(sayRow).toHaveLength(1);
        const text = lineText(sayRow[0]!);
        expect(text).not.toContain('(no state)');
        expect(sayRow[0]!.runs.filter((x) => x.t.trim()).every((x) => (x.tone === 'muted' || x.tone === 'dim') && !x.bold)).toBe(true);
        const left = text.length - text.trimStart().length;
        const right = cols - left - cells(text.trim());
        if (c.left) expect(left).toBe(4); // wave 32: left-aligned on the rows' indent, not centred
        else expect(Math.abs(left - right)).toBeLessThanOrEqual(1); // centred in the pane
        expect(rows.filter((l) => lineText(l).trim()).length).toBe(1 + c.head); // nothing else: the channel keeps its head row (name, people)
      });
    }
  }
});
