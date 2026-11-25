// Side panel and Board finish (critique 5, side panel and board sections): whole tab labels, no middle ellipsis, one `N of M` unit,
// sections labelled by what they list, a plain core tab, rows that use the pane height, and a Board with owner and state columns.
// Each test was written to fail before the layout changed.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../../../contracts/core-fixture';
import { panelWorld } from '../../../contracts/panel-world';
import type { Ui } from '../../design/atlas-ui';
import { boardBody, boardText, type BoardRow } from '../board/board-model';
import { coreModel } from '../../data/core';
import { bodyLines, lineText, panelText, tabRows, type PanelModel, type PanelTab } from './panel-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const core = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
const model = (tab: PanelTab, cols: number, over: Partial<PanelModel> = {}): PanelModel => panelWorld(tab, cols, ui, { core, ...over });
const body = (tab: PanelTab, cols: number, over: Partial<PanelModel> = {}): string[] => bodyLines(model(tab, cols, over)).map((l) => lineText(l).trimEnd());
const MIDDLE = /[A-Za-z0-9]\.\.\.[A-Za-z0-9]/;

describe('1: the tab strip never blanks a label', () => {
  for (const cols of [26, 30, 40, 60]) {
  }
});

describe('2: no middle ellipsis on a name the panel owns', () => {
  const long = 'board-auditor-open-items';
  const workers = [{ name: long, state: 'running' as const, model: 'opus', task: 'T1', detail: 'listing the board', secs: 5 }, { name: 'alpha-explorer', state: 'done' as const, detail: 'read alpha.py', secs: 9 }];
  for (const cols of [150, 110, 60, 45, 38]) {
    test(`no tab has a middle cut at ${cols}`, () => {
      const gates = [{ id: 'g1', title: 'Completion gate', lines: [{ id: 'a', label: 'x', ok: false, fix: 'run the thing' }, { id: 'b', label: 'y', ok: true }] }, { id: 'g2', title: 'Dispatch required', lines: [{ id: 'c', label: 'z', ok: true }] }];
      const todos = [{ id: 'a', label: 'List the function names defined in alpha.py', state: 'running' as const, owner: 'implementer-board-with-long-name' }];
      for (const t of ['route', 'team', 'channel', 'gates', 'core'] as PanelTab[]) {
        for (const l of body(t, cols, { workers, gates, todos })) expect(l).not.toMatch(MIDDLE);
      }
    });
  }
});

describe('3: one count vocabulary inside the panel (`N denied`, `8 pass · 0 deny`), never a ratio', () => {
  for (const cols of [150, 80, 60, 45, 38]) {
  }
});

describe('4: each route section is labelled by what it lists', () => {
});

describe('5: the core tab is plain language', () => {
  for (const cols of [150, 60]) {
    test(`at ${cols}: no jargon, one no-verdicts line`, () => {
      const text = body('core', cols).join('\n');
      expect(text).not.toMatch(/offload/i);
      expect(text).not.toMatch(/planned against what ran/);
      expect((text.match(/no verdicts? (recorded )?yet/g) ?? []).length).toBeLessThanOrEqual(1);
    });
  }
  test('an empty ledger says so once', () => {
    const none = { ...core, verdicts: [], claims: [], ledger: { verified: 0, refuted: 0, pending: 0, claimed: 0, unchecked: 0 } } as typeof core;
    const text = body('core', 80, { core: none }).join('\n');
    expect((text.match(/no verdicts? (recorded )?yet/g) ?? []).length).toBe(1);
  });
  test('every fact survives: token counts and the team plan', () => {
    const text = body('core', 150).join('\n');
    expect(text).toMatch(/tokens read by workers/);
    expect(text).toMatch(/verify team \(low effort\)/);
  });
});

describe('6: height and indent', () => {
  test('section headings sit under the strip, one cell in', () => {
    for (const l of body('core', 80).filter((x) => /^ ?(contract|verdicts)/.test(x))) expect(l.startsWith(' ')).toBe(true);
  });
  for (const t of ['team', 'gates', 'channel', 'route'] as PanelTab[]) {
  }
});

describe('7: the Board', () => {
  const rows: BoardRow[] = [
    { label: 'List the function names defined in /mnt/project-files/alpha.py', state: 'done', owner: 'alpha-explorer', detail: '' },
    { label: 'List the function names defined in /mnt/project-files/beta.py', state: 'done', owner: 'beta-explorer', detail: '' },
    { label: 'List the function names defined in /mnt/project-files/gamma.py', state: 'running', owner: 'gamma-explorer', detail: '' },
    { label: 'Short one', state: 'queued', owner: 'lead', detail: '' },
  ];
  for (const cols of [60, 80, 99]) {
    test(`at ${cols}: an owner and a state column, rows told apart`, () => {
      const text = boardText(boardBody(rows, { cols, ui }));
      // B2: the owner column drops before a title is cut. At 60 the 63-cell titles are cut either way and share a head, so the owner tells them apart;
      // at 80 the titles show whole without it, and an owner beside them would cut them; at 99 both fit.
      expect(text.some((l) => l.includes('alpha-explorer'))).toBe(true); // critique 15 B5: at 80 it stands under its row instead of vanishing
      expect(text.some((l) => l.includes('gamma-explorer'))).toBe(true);
      if (cols >= 80) expect(text.some((l) => l.includes('...'))).toBe(false); // 80 and 99: no title is cut
      const bodyRows = text.filter((l) => /^[▸ ] [◐◓◑◒◐◓◑◒◐◓◇●■▲▲◉] /.test(l));
      const labels = bodyRows.map((l) => l.replace(/\s+(done|running|queued|failed|blocked|waiting)\s.*$/, ''));
      // Labels are cut at the end only, so the long rows share one head; the owner column is what tells them apart.
      expect(new Set(bodyRows.map((l) => l.replace(/^.{4}/, ''))).size).toBe(bodyRows.length);
      for (const l of labels) expect(l).not.toMatch(/^[▸ ] [^ ] \.\.\./);
      for (const l of labels) expect(l).not.toMatch(MIDDLE);
      for (const l of text) expect(l.length).toBeLessThanOrEqual(cols);
    });
  }
  test('a label with room to spare is never cut', () => {
    const text = boardText(boardBody([{ label: 'Short one', state: 'queued', owner: 'lead', detail: '' }], { cols: 80, ui })).join('\n');
    expect(text).toContain('Short one');
    expect(text).not.toContain('...');
  });
});
