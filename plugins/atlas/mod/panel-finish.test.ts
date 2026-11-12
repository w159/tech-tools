// Side panel and Board finish (critique 5, side panel and board sections): whole tab labels, no middle ellipsis, one `N of M` unit,
// sections labelled by what they list, a plain core tab, rows that use the pane height, and a Board with owner and state columns.
// Each test was written to fail before the layout changed.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { panelWorld } from '../contracts/panel-world';
import type { Ui } from './atlas-ui';
import { boardBody, boardText, type BoardRow } from './board-model';
import { coreModel } from './data/core';
import { bodyLines, lineText, panelText, tabRows, type PanelModel, type PanelTab } from './panel-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const core = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
const model = (tab: PanelTab, cols: number, over: Partial<PanelModel> = {}): PanelModel => panelWorld(tab, cols, ui, { core, ...over });
const body = (tab: PanelTab, cols: number, over: Partial<PanelModel> = {}): string[] => bodyLines(model(tab, cols, over)).map((l) => lineText(l).trimEnd());
const MIDDLE = /[A-Za-z0-9]\.\.\.[A-Za-z0-9]/;

describe('1: the tab strip never blanks a label', () => {
  for (const cols of [26, 30, 40, 60]) {
    test(`at ${cols} every key keeps a word`, () => {
      const rows = tabRows(model('route', cols)).map((l) => lineText(l));
      const text = rows.join('\n');
      const bare = !/\b[rtcgko]: /.test(text); // A1: 36 cells and up draw the words alone (the keys stay bound by the host layer)
      if (bare) for (const w of ['route', 'team', 'channel', 'gates', 'core', 'board']) expect(text).toContain(w);
      else for (const k of ['r', 't', 'c', 'g', 'k', 'o']) expect(text).toMatch(new RegExp(`${k}: [a-z]{2,}`));
      expect(text).not.toMatch(/[a-z]: {2,}/);
      expect(text).not.toMatch(/[a-z]: *$/m);
      for (const l of rows) expect(l.length).toBeLessThanOrEqual(cols);
    });
  }
});

describe('2: no middle ellipsis on a name the panel owns', () => {
  const long = 'board-auditor-open-items';
  const workers = [{ name: long, state: 'running' as const, model: 'opus', task: 'T1', detail: 'listing the board', secs: 5 }, { name: 'alpha-explorer', state: 'done' as const, detail: 'read alpha.py', secs: 9 }];
  test('team tab at 150: the whole name shows', () => {
    expect(body('team', 150, { workers }).join('\n')).toContain(long);
  });
  for (const cols of [150, 110, 60, 45, 38]) {
    test(`no tab has a middle cut at ${cols}`, () => {
      const gates = [{ id: 'g1', title: 'Completion gate', lines: [{ id: 'a', label: 'x', ok: false, fix: 'run the thing' }, { id: 'b', label: 'y', ok: true }] }, { id: 'g2', title: 'Dispatch required', lines: [{ id: 'c', label: 'z', ok: true }] }];
      const todos = [{ id: 'a', label: 'List the function names defined in alpha.py', state: 'running' as const, owner: 'implementer-board-with-long-name' }];
      for (const t of ['route', 'team', 'channel', 'gates', 'core'] as PanelTab[]) {
        for (const l of body(t, cols, { workers, gates, todos })) expect(l).not.toMatch(MIDDLE);
      }
    });
  }
  test('gates at 45 keep the whole name and put the failing count in the row below', () => {
    const gates = [{ id: 'g1', title: 'Completion gate', lines: [{ id: 'a', label: 'x', ok: false }, { id: 'b', label: 'y', ok: true }] }];
    const rows = body('gates', 45, { gates });
    expect(rows[0]).toContain('Completion gate');
    expect(rows.join('\n')).toContain('1/2 green');
  });
});

describe('3: one count format, `n/m`, inside the panel (critique 12 B3)', () => {
  for (const cols of [150, 80, 60, 45, 38]) {
    test(`no \`n of m\` on the route tab at ${cols}`, () => {
      const rows = body('route', cols);
      expect(rows.filter((l) => /^ (phase|gates|todo) /.test(l)).join('\n')).not.toMatch(/\b\d+ of \d+\b/);
      expect(rows.find((l) => l.startsWith(' gates'))).toMatch(/\d\/\d green/);
    });
  }
  test('the phase row is the phase word alone, never an `n/m` beside it (critique 17 A5: it shared the todo format and went stale beside the chip)', () => {
    expect(body('route', 80).find((l) => l.startsWith(' phase'))).toMatch(/^ phase {2}[a-z]+$/);
  });
});

describe('4: each route section is labelled by what it lists', () => {
  test('the agents row comes before the tasks and a todo row heads the tasks', () => {
    const rows = body('route', 100);
    const agents = rows.findIndex((l) => l.startsWith(' agents'));
    const todo = rows.findIndex((l) => l.startsWith(' todo'));
    const first = rows.findIndex((l) => /^[▸ ] [◐◓◑◒◇●■▣▲◉] /.test(l));
    expect(agents).toBeGreaterThan(-1);
    expect(agents).toBeLessThan(todo);
    expect(todo).toBeLessThan(first);
  });
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
    test(`${t} uses more of a tall pane than a short one, and fits it`, () => {
      const tall = panelText(model(t, 80, { rows: 60 }));
      const short = panelText(model(t, 80, { rows: 14 }));
      expect(tall.length).toBeGreaterThan(short.length);
      expect(tall.length).toBeLessThanOrEqual(60);
    });
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
      const bodyRows = text.filter((l) => /^[▸ ] [◐◓◑◒◇●■▣▲◉] /.test(l));
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
