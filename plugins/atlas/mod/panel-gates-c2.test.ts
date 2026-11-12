// Design rev 5, slice C2: the gates tab is grouped by check. Every group row is a bold title with its count (`n/m`, right aligned on one column, warn only while the group fails);
// the group's checks sit indented under the title, their mark under the title's first letter, never in the title's mark column.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import { cells, uiFromEnv } from './atlas-ui';
import { bodyLines, lineText, type PanelGate, type PanelModel } from './panel-layout';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const gates: PanelGate[] = [
  { id: 'completion', title: 'Completion gate', lines: [{ id: 'verify', label: 'verification coverage', ok: false, fix: 'run the suite' }, { id: 'docs', label: 'docs updated', ok: true }, { id: 'ev', label: 'evidence recorded', ok: true }] },
  { id: 'dispatch', title: 'Dispatch tripwire', lines: [{ id: 'name', label: 'named dispatch', ok: true }, { id: 'scope', label: 'scope declared', ok: true }] },
  { id: 'header', title: 'Header contract', lines: [{ id: 'header-matched', label: 'header matched', ok: true, detail: '8 of 8' }] },
];
const body = (cols: number, over: Partial<PanelModel> = {}) => bodyLines(panelWorld('gates', cols, ui, { rows: 40, gates, ...over }));

describe('C2: gates grouped by check', () => {
  for (const cols of [38, 49, 80]) {
    test(`${cols}: every group row carries its n/m count in one right-aligned column, the title is bold`, () => {
      const rows = body(cols).filter((l) => l.press?.key.startsWith('group:'));
      expect(rows).toHaveLength(3);
      const texts = rows.map((l) => lineText(l).trimEnd());
      expect(texts[0]).toMatch(/2\/3$/);
      expect(texts[1]).toMatch(/2\/2$/);
      expect(texts[2]).toMatch(/8\/8$/);
      const ends = new Set(texts.map((t) => cells(t)));
      expect(ends.size).toBe(1); // one value column: the counts end on the same cell
      for (const l of rows) expect(l.runs.some((x) => x.bold && /gate|tripwire|contract/.test(x.t))).toBe(true);
    });
  }
  test('a passing group count is dim, a failing one warn', () => {
    const rows = body(80).filter((l) => l.press?.key.startsWith('group:'));
    const tone = (l: (typeof rows)[number]) => l.runs.find((x) => /\d+\/\d+/.test(x.t))!.tone;
    expect([tone(rows[0]!), tone(rows[1]!)]).toEqual(['warn', 'muted']);
  });
  test('the checks of an open group are indented under the title: their mark sits at the title text column', () => {
    const rows = body(80, { expanded: 'group:completion' });
    const at = rows.findIndex((l) => lineText(l).includes('Completion gate'));
    const title = lineText(rows[at]!);
    const child = lineText(rows[at + 1]!);
    expect(child).toContain('verification coverage');
    const markCol = child.search(/\S/);
    expect(markCol).toBe(title.indexOf('Completion'));
    expect(child.indexOf('verification')).toBe(markCol + 2);
  });
});
