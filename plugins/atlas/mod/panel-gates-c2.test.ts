// Design rev 5, slice C2: the gates tab is grouped by check. Every group row is a bold title with its count (`8 pass · 0 deny`, right aligned on one column, warn only while the group fails);
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
    test(`${cols}: every group row carries its N pass · M deny count in one right-aligned column, the title is bold`, () => {
      const all = body(cols);
      const rows = all.filter((l) => l.press?.key.startsWith('group:'));
      expect(rows).toHaveLength(3);
      // 38 cells: the figure does not fit the group row, so it is the first indented row under it (a named row, never bare dots)
      const figure = (l: (typeof rows)[number]): string => { const t = lineText(l).trimEnd(); return /pass · \d+ deny$/.test(t) ? t : lineText(all[all.indexOf(l) + 1]!).trimEnd(); };
      const texts = rows.map(figure);
      expect(texts[0]).toMatch(/2 pass · 1 deny$/);
      expect(texts[1]).toMatch(/2 pass · 0 deny$/);
      expect(texts[2]).toMatch(/8 pass · 0 deny$/);
      if (cols >= 49) expect(new Set(rows.map((l) => cells(lineText(l).trimEnd()))).size).toBe(1); // one value column: the counts end on the same cell
      for (const l of rows) expect(l.runs.some((x) => x.bold && /gate|tripwire|contract/.test(x.t))).toBe(true);
    });
  }
  test('a passing group count is dim, a failing one warn', () => {
    const rows = body(80).filter((l) => l.press?.key.startsWith('group:'));
    const tone = (l: (typeof rows)[number]) => l.runs.find((x) => /\d+ pass/.test(x.t))!.tone;
    expect([tone(rows[0]!), tone(rows[1]!)]).toEqual(['warn', 'muted']);
  });
  test('the checks of an open group are indented under the title: their mark sits at the title text column', () => {
    const rows = body(80, { expanded: 'group:completion' });
    const at = rows.findIndex((l) => lineText(l).includes('Completion gate'));
    const title = lineText(rows[at]!);
    const child = lineText(rows[at + 1]!);
    expect(child).toContain('verification coverage');
    const markCol = child.replace(/^[▸▾]/, ' ').search(/\S/); // the row's own chevron is not its mark
    expect(markCol).toBe(title.indexOf('Completion'));
    expect(child.indexOf('verification')).toBe(markCol + 2);
  });
});
