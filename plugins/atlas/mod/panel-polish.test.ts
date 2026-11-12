// Side panel polish (critique-3 changes 6, 7, 9, 10): the route tab as the Board's compact form, the core tab in plain words
// with whole numbers, one row grammar on all five tabs, one tab strip on both hosts, and the card and toast marks.
// Each test was written to fail on b94309da (the strip, grid and toast helpers did not exist) before the layout was changed.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { panelWorld, worldCard } from '../contracts/panel-world';
import * as UI from './atlas-ui';
import { cells, contrast, PALETTES, UI_STATES, type Ui } from './atlas-ui';
import { coreModel, type CoreModel } from './data/core';
import * as L from './panel-layout';
import { bodyLines, cardLines, lineText, panelText, type PanelModel, type PanelTab } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const latte: Ui = { theme: 'latte', ascii: false, color: 'truecolor' };
const ascii: Ui = { theme: 'mocha', ascii: true, color: 'none' };
const core: CoreModel = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
const TABS: PanelTab[] = ['route', 'team', 'channel', 'gates', 'core'];
const G = '[◐◓◑◒◐◓◑◒◐◓◐◓◑◒◐◓◇●■▲▲◉]';
const WORD = '(queued|running|done|failed|blocked|waiting)';
const body = (t: PanelTab, cols: number, over: Partial<PanelModel> = {}, ui: Ui = mocha): string[] => bodyLines(panelWorld(t, cols, ui, { core, ...over })).map(lineText).map((l) => l.trimEnd());
const taskRows = (rows: readonly string[]): string[] => rows.filter((l) => new RegExp(`^[▸ ] ${G} `).test(l));

const plan = [
  { id: 'd', label: 'Shipped first on purpose', state: 'done' as const, owner: 'implementer-layout' },
  { id: 'a', label: 'Wire the band to the host and verify every width of the layout from the narrowest pane to the widest terminal until the very end', state: 'running' as const, owner: 'implementer-band', detail: 'read runs.ts:17' },
  { id: 'b', label: 'Gate tests', state: 'queued' as const, owner: 'runner-land-with-a-very-long-owner-name', detail: 'after Subagents block' },
  { id: 'c', label: 'Changelog', state: 'failed' as const, owner: 'implementer-live', detail: 'tests red 3' },
];

describe('clipMiddle (atlas-ui)', () => {
  test('keeps both ends and exactly n cells, `...` in the middle', () => {
    const f = (UI as unknown as { clipMiddle: (t: string, n: number) => string }).clipMiddle;
    expect(f('abcdefghij', 7)).toBe('ab...ij');
    expect(f('abcdefghij', 8)).toBe('abc...ij');
    expect(f('short', 9)).toBe('short');
    expect(f('abcdefghij', 3)).toBe('abc');
    expect(f('', 5)).toBe('');
  });
});

describe('change 6: the route tab is the Board compact form', () => {
  // 38 is the 110-column pane: a title that cannot sit beside its state word is drawn whole there and its state follows (A4, mod/panel-a4.test.ts)
  test('at 38 a long title is drawn whole over its rows and the state word follows it, never pushed off', () => {
    const rows = body('route', 38, { todos: plan });
    const text = rows.join(' ').replace(/\s+/g, ' ');
    expect(text).toContain('Wire the band to the host and verify');
    expect(text).toMatch(/running/);
    for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(38);
    expect(taskRows(rows)).toHaveLength(4);
  });
  for (const cols of [120, 80, 56, 38]) {
    test(`at ${cols} every task row has its state word in one column, long titles and owners included`, () => {
      if (cols < 50) return; // the narrow pane spills long titles (above)
      const rows = taskRows(body('route', cols, { todos: plan }));
      expect(rows).toHaveLength(4);
      const at = rows.map((l) => l.search(new RegExp(` ${WORD}( |$)`)));
      expect(at.every((n) => n > 0)).toBe(true);
      expect(new Set(at).size).toBe(1);
    });
    // critique 4 (panel B2) replaces "cut in the middle, its end survives": the label is clipped at its end and the owner column stays whole.
    test(`at ${cols} a long title is clipped at its end: its start survives, the state word is never pushed off`, () => {
      if (cols < 50) return; // the narrow pane spills long titles (above)
      const row = taskRows(body('route', cols, { todos: plan }))[1]!;
      expect(row).toMatch(/Wire the band .*\S… +running/); // one `…` marks the cut (wave 24), never the ASCII `...`
      expect(row).not.toMatch(/\S…\S|\.\.\./);
      expect(row).toContain('running');
    });
    test(`at ${cols} rows keep the Board's item order (no done-last reshuffle)`, () => {
      const rows = taskRows(body('route', cols, { todos: plan }));
      expect(rows.map((l) => /Shipped|Wire|Gate|Changelog/.exec(l)?.[0])).toEqual(['Shipped', 'Wire', 'Gate', 'Changelog']);
    });
  }
  for (const cols of [120, 80, 56]) {
    test(`at ${cols} the owner is the right-aligned value column of every row`, () => {
      const rows = taskRows(body('route', cols, { todos: plan }));
      expect(rows.map((l) => cells(l))).toEqual(rows.map(() => cols));
      expect(rows[3]).toMatch(/implementer-live$/);
    });
  }
  test('B2: a label that carries its owner in brackets is clipped at the end, never in the middle', () => {
    const todos = [{ id: 'T1', label: 'T1 read alphabetical.py and report every function in it, then compare the two lists line by line (alpha-explorer)', state: 'done' as const }];
    for (const cols of [110, 80, 56]) {
      const row = taskRows(body('route', cols, { todos }))[0]!;
      expect(row).toContain('T1 read alph');
      expect(row).not.toMatch(/\S…\S|\.\.\./);
      expect(row).toMatch(/… +done/);
    }
  });
  test('B2: the owner column is whole whenever it was given room, at every width the column exists', () => {
    const todos = [{ id: 'a', label: 'Wire the band to the host and verify every width of the layout until the end', state: 'running' as const, owner: 'implementer-band' }];
    for (const cols of [120, 100, 80, 56]) expect(taskRows(body('route', cols, { todos }))[0]!).toMatch(/ implementer-band$/);
  });
  test('the detail is one fixed column from 100 cells; below that it moves to the open row instead of a ragged third column', () => {
    const wide = taskRows(body('route', 120, { todos: plan })).filter((l) => l.includes('tests red 3') || l.includes('read runs.ts') || l.includes('blocked:'));
    expect(wide.length).toBeGreaterThan(0);
    const at = wide.map((l) => cells(l.slice(0, l.search(/tests red 3|read runs\.ts|blocked:/))));
    expect(new Set(at).size).toBe(1); // every detail starts in the same cell
    expect(taskRows(body('route', 80, { todos: plan })).join('\n')).not.toContain('tests red 3');
    expect(body('route', 80, { todos: plan, expanded: 'task:c' }).join('\n')).toContain('tests red 3');
  });
});

describe('change 7: the core tab in plain words, numbers whole', () => {
  test('no inner heading collides with the route tab name, and the jargon words are gone', () => {
    for (const cols of [120, 80, 38]) {
      const out = body('core', cols);
      expect(out.filter((l) => /^route\b/.test(l))).toEqual([]);
      for (const jargon of [/\bkept\b/, /\bback\b/, /\(\d+x\)/, /in tmux/]) expect(out.join('\n')).not.toMatch(jargon);
    }
  });
  test('the offload section says in words what the figures are', () => {
    const out = body('core', 120).join('\n');
    expect(out).toMatch(/read by workers/);
    expect(out).toMatch(/returned to the lead/);
  });
  for (const cols of [80, 56, 38]) {
    test(`at ${cols} no figure is ever cut: the label column gives way`, () => {
      const out = body('core', cols);
      expect(out.join('\n')).not.toMatch(/[\d.]k?\.\.\./);
      const worker = out.filter((l) => /\d\.\dk|\$0\.\d\d|\b\d{3}\b/.test(l) && /(impl|veri)/.test(l));
      expect(worker.length).toBeGreaterThanOrEqual(3);
      for (const l of worker) expect(l).toMatch(/\b\d+(\.\d)?k?\b/);
    });
  }
  test('at 38 a worker name is cut at its end, its figures stay whole', () => {
    const row = body('core', 38).find((l) => /impl/.test(l) && /\d\.\dk|\$0/.test(l))!;
    expect(row).toBeDefined();
    expect(row).toMatch(/impl\S*…/);
  });
  test('the figures are the right-aligned value column', () => {
    for (const cols of [120, 80]) {
      const rows = body('core', cols).filter((l) => /(implementer|verifier)-[0-9a-f]{4}/.test(l));
      expect(rows).toHaveLength(3);
      expect(rows.map((l) => cells(l))).toEqual(rows.map(() => cols));
    }
  });
});

describe('one row grammar on all five tabs', () => {
  const grid = new RegExp(`^[▸ ] (${G}| ) `);
  for (const cols of [120, 80, 38]) {
    test(`at ${cols} the state glyph sits in cell 3 and names start in cell 5 on every tab row`, () => {
      const pick: Record<PanelTab, string[]> = {
        route: taskRows(body('route', cols)),
        team: body('team', cols).filter((l) => /^[▸ ] /.test(l)),
        channel: body('channel', cols).slice(1),
        gates: body('gates', cols, { gates: [{ id: 'lint', title: 'lint', lines: [{ id: 'l', label: 'lint', ok: true }] }, { id: 'doctor', title: 'doctor', lines: [{ id: 'd', label: 'doctor', ok: false, fix: 'run the doctor' }] }] }),
        core: body('core', cols).filter((l) => l && !/^\S/.test(l) && !/^ \S/.test(l)),
      };
      for (const t of TABS) {
        expect(pick[t].length).toBeGreaterThan(0);
        for (const l of pick[t]) expect([t, l, grid.test(l)]).toEqual([t, l, true]);
      }
    });
  }
  test('channel and gates carry a right-aligned value column (time, failing count)', () => {
    const ch = body('channel', 120).slice(1);
    expect(ch.map((l) => cells(l))).toEqual(ch.map(() => 120));
    expect(ch[0]).toMatch(/10:02$/);
    const gates = body('gates', 80, { gates: [{ id: 'doctor', title: 'doctor', lines: [{ id: 'd', label: 'doctor', ok: false, fix: 'run it' }] }] });
    expect(cells(gates[0]!)).toBe(80);
    expect(gates[0]).toMatch(/0\/1$/);
  });
  test('rows never pass the panel width, in ASCII and both themes, 10 to 160 columns', () => {
    for (const ui of [mocha, latte, ascii]) for (const t of TABS) for (const cols of [10, 24, 38, 56, 80, 100, 120, 160])
      for (const l of panelText(panelWorld(t, cols, ui, { core }))) expect([ui.ascii, t, cols, cells(l) <= cols]).toEqual([ui.ascii, t, cols, true]);
  });
});

// ---- change 10 --------------------------------------------------------------------------------------------------------

describe('change 10: the card and the toast', () => {
  test('the toast reads bar, ATLAS mark, state, name, fact', () => {
    const t = L.toastText('failed', 'implementer-live', 'tests red 3', mocha);
    expect(t.startsWith('▌ ')).toBe(true);
    expect(t).toContain('◆ ATLAS');
    expect([t.indexOf('ATLAS'), t.indexOf('failed'), t.indexOf('implementer-live'), t.indexOf('tests red 3')]).toEqual([...[t.indexOf('ATLAS'), t.indexOf('failed'), t.indexOf('implementer-live'), t.indexOf('tests red 3')]].sort((a, b) => a - b));
    expect(L.toastText('done', 'a', '', ascii).startsWith('| ')).toBe(true);
    expect(L.toastText('done', 'a', '', ascii)).toMatch(/^[\x20-\x7e]*$/);
  });
  test('the left bar and the state word carry the state tone; the rest keeps its own', () => {
    const tones: Record<string, string> = { running: 'run', done: 'ok', failed: 'bad', blocked: 'block', waiting: 'info' };
    for (const s of Object.keys(tones) as UI.UiState[]) {
      const runs = L.toastRuns(s, 'name', 'fact', mocha);
      expect(runs[0]!.t.trim()).toBe('▌');
      expect(runs[0]!.tone).toBe(tones[s]);
      const word = runs.find((x) => x.t.trim() === s)!;
      expect(word.tone).toBe(tones[s]);
      expect(word.bold).toBe(true);
    }
    const q = L.toastRuns('queued', 'name', '', mocha);
    expect(q.find((x) => x.t.trim() === 'queued')!.tone).toBe('muted');
  });
  test('every state word tone reaches 4.5:1 on the panel in both themes (a token that cannot falls back to text)', () => {
    for (const theme of ['mocha', 'latte'] as const) {
      const ui: Ui = { theme, ascii: false, color: 'truecolor' };
      for (const s of UI_STATES) {
        const word = L.toastRuns(s, 'n', '', ui).find((x) => x.t.trim() === s)!;
        expect(contrast(UI.toneHex(word.tone, theme), PALETTES[theme].panel)).toBeGreaterThanOrEqual(4.5);
      }
      expect(UI.emittedPairs(theme).filter((p) => p.what.startsWith('state word')).length).toBe(UI_STATES.length);
    }
  });
  test('the card top carries the ATLAS mark and a state word in the state tone', () => {
    const top = cardLines(worldCard(mocha), 120)[0]!;
    expect(top.some((x) => x.t.includes('◆'))).toBe(true);
    const word = top.find((x) => x.t === 'running')!;
    expect(word.tone).toBe('run');
    expect(cardLines({ ...worldCard(mocha), state: 'failed' }, 120)[0]!.find((x) => x.t === 'failed')!.tone).toBe('bad');
  });
  for (const cols of [120, 80]) {
    test(`at ${cols} the card's two gauges are the same width and never touch row on row (no stepped block)`, () => {
      const rows = cardLines(worldCard(mocha), cols).map((r) => r.map((x) => x.t).join(''));
      const gaugeRows = rows.map((r, i) => (/[█▏▎▍▌▋▊▉░]/.test(r) ? i : -1)).filter((i) => i >= 0);
      expect(gaugeRows).toHaveLength(2);
      expect(gaugeRows[1]! - gaugeRows[0]!).toBeGreaterThan(1);
      const width = (r: string): number => [...r].filter((c) => '█▏▎▍▌▋▊▉░'.includes(c)).length;
      expect(width(rows[gaugeRows[0]!]!)).toBe(width(rows[gaugeRows[1]!]!));
    });
  }
});
