// The shared side panel layout (design system rev 4): design goldens, per-tab goldens at 120, 80 and the real pane width,
// the live defects it fixes (L17 route content, L16 seat drift, L21 narrow strip), subagents by name and state,
// toasts, the closed card box, ASCII mode and width safety.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { panelWorld, worldCard } from '../contracts/panel-world';
import { cardDesign, sidepanelDesign, subagentsDesign, tabGolden, toastDesign } from '../contracts/panel-golden';
import { world } from '../contracts/band-world';
import { cells, runsString, UI_STATES, type Ui } from './atlas-ui';
import { coreModel, type CoreModel } from './data/core';
import { bodyLines, cardLines, headerRows, lineText, PANEL_TABS, panelText, tabGap, toastText, type PanelModel, type PanelTab } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const latte: Ui = { theme: 'latte', ascii: false, color: 'truecolor' };
const ascii: Ui = { theme: 'mocha', ascii: true, color: 'none' };
const tabs = PANEL_TABS.map((t) => t.id);
const core: CoreModel = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
const rows = (t: PanelTab, cols: number, over: Partial<PanelModel> = {}, ui: Ui = mocha): string[] => panelText(panelWorld(t, cols, ui, over));
const card = (cols: number, ui: Ui = mocha): string[] => cardLines(worldCard(ui), cols).map((r) => runsString(r).trimEnd());

describe('side panel design goldens', () => {
  for (const cols of [120, 80]) {
    test(`route head at ${cols} equals the design sidepanel golden`, () => {
      expect(rows('route', cols).slice(0, sidepanelDesign[cols]!.length)).toEqual(sidepanelDesign[cols]!);
    });
    test(`team body at ${cols} equals the design subagents golden`, () => {
      expect(rows('team', cols).slice(cols >= 100 ? 5 : 4)).toEqual(subagentsDesign[cols]!);
    });
  }
  test('the team ribbon carries the worker counts with their words', () => {
    expect(rows('team', 120)[0]).toContain('1 queued · 1 running · 2 done · 1 failed');
  });
  for (const t of tabs) {
    for (const cols of [120, 80, 56]) {
      test(`${t} at ${cols} equals its golden`, () => {
        expect(rows(t, cols, { core })).toEqual(tabGolden[t]![cols]!);
      });
    }
  }
});

describe('tab strip', () => {
  test('lists route team channel gates core; the lit tab is ruled and bold', () => {
    for (const t of tabs) {
      const [strip, rule] = headerRows(panelWorld(t, 120, mocha)).slice(2, 4);
      expect(lineText(strip!).trim().split(/\s+/)).toEqual(['route', 'team', 'channel', 'gates', 'core']);
      const lit = strip!.runs.find((x) => x.bold)!;
      expect(lit.t).toBe(t);
      expect(lineText(rule!).trim()).toBe('━'.repeat(t.length));
      expect(lineText(rule!).indexOf('━')).toBe(lineText(strip!).indexOf(t));
    }
  });
  test('L21: the strip fits every width from 29 to 140 and never runs labels together', () => {
    for (let cols = 29; cols <= 140; cols++) {
      const [strip] = headerRows(panelWorld('route', cols, mocha)).slice(2);
      const text = lineText(strip!);
      expect(cells(text)).toBeLessThanOrEqual(cols);
      expect(text.trim().split(/\s+/)).toEqual(['route', 'team', 'channel', 'gates', 'core']);
    }
    expect(tabGap(110)).toBe(3);
    expect(tabGap(38)).toBe(2);
  });
});

describe('route tab', () => {
  const planned = [
    { id: 'p1', label: 'write the report', state: 'queued' as const, owner: 'alpha-explorer' },
    { id: 'p2', label: 'check the numbers', state: 'queued' as const, owner: 'beta-explorer' },
  ];
  test('L17: plan items show while three explorers run, whatever phase they belong to', () => {
    const running = ['alpha', 'beta', 'gamma'].map((n) => ({ name: `${n}-explorer`, state: 'running' as const, detail: 'Grep', secs: 12 }));
    const text = rows('route', 80, { todos: planned, workers: running, phase: 'research' }).join('\n');
    expect(text).toContain('write the report');
    expect(text).toContain('check the numbers');
    expect(text).toContain('0 of 2');
    expect(text).toContain('3 running');
    expect(text).not.toContain('nothing planned');
  });
  test('L17: with no plan but running workers, the route lists them instead of saying nothing is planned', () => {
    const running = [{ name: 'alpha-explorer', state: 'running' as const, detail: 'Grep', secs: 3 }];
    const text = rows('route', 80, { todos: [], workers: running }).join('\n');
    expect(text).toContain('alpha-explorer');
    expect(text).toContain('1 running');
    expect(text).not.toContain('nothing planned');
    expect(text).not.toContain('(no state)');
  });
  test('an empty board and nobody running is the design empty state', () => {
    expect(rows('route', 120, { todos: [], workers: [], gates: [] })).toContain('(no state)  no tasks yet · add one with /todo add');
  });
  test('an open task row shows its evidence line, or says there is none', () => {
    const done = { id: 'd1', label: 'wire it', state: 'done' as const, evidence: 'tests green' };
    expect(rows('route', 100, { todos: [done], expanded: 'task:d1' }).join('\n')).toContain('tests green');
    expect(rows('route', 100, { todos: [{ ...done, evidence: null }], expanded: 'task:d1' }).join('\n')).toContain('no evidence yet');
  });
  test('a plan longer than the row budget folds into a counted more row', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, label: `task ${i}`, state: 'queued' as const }));
    const out = rows('route', 80, { todos: many, rows: 20 });
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.at(-1)).toMatch(/\d+ more tasks on the board$/);
  });
  test('names that do not fit the gates row fold to a labelled count', () => {
    expect(rows('route', 30)[5]).toContain('2/3 green');
  });
});

describe('team tab lists the subagents by name and state', () => {
  test('every worker row names the worker and one of the six state words', () => {
    const body = bodyLines(panelWorld('team', 80, mocha)).map(lineText);
    expect(body).toHaveLength(world.workers.length);
    world.workers.forEach((w, i) => {
      expect(body[i]).toContain(w.name);
      expect(body[i]).toContain(w.state);
      expect(UI_STATES).toContain(w.state);
    });
  });
  test('running first, then failed, queued, done (as the design lists them)', () => {
    expect(bodyLines(panelWorld('team', 80, mocha)).map((l) => lineText(l).slice(4).split(' ')[0])).toEqual(
      ['implementer-band', 'implementer-live', 'runner-land', 'implementer-layout', 'implementer-gates']);
  });
  test('the recipient takes the focus marker; without one the first running worker does', () => {
    const marked = (r: string | null): string[] => bodyLines(panelWorld('team', 80, mocha, { recipient: r })).map(lineText).filter((l) => l.startsWith('▸'));
    expect(marked(null)).toEqual([expect.stringContaining('implementer-band')]);
    expect(marked('runner-land')).toEqual([expect.stringContaining('runner-land')]);
  });
  test('an open worker row adds what it is doing and how long it has run', () => {
    const open = bodyLines(panelWorld('team', 80, mocha, { expanded: 'worker:implementer-band' })).map(lineText);
    expect(open[1]).toContain('read runs.ts:17');
    expect(open[2]).toContain('running 42s');
  });
  test('nobody dispatched is the design empty state', () => {
    expect(rows('team', 80, { workers: [] }).at(-1)).toBe('(no state)  nobody dispatched yet, ask the lead to start a worker');
  });
  test('rows are pressable and select the worker', () => {
    const l = bodyLines(panelWorld('team', 80, mocha))[0]!;
    expect(l.press).toEqual({ kind: 'worker', key: 'worker:implementer-band', name: 'implementer-band' });
  });
});

describe('gates tab', () => {
  const long = 'the completion gate found that verification coverage is missing for the changed modules and the docs tree';
  const g = (over: object = {}) => [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'verify', label: 'verification coverage', ok: false, detail: 'no verified finding', fix: 'run the hooks suite' }, { id: 'docs', label: 'docs updated', ok: true }], ...over }];
  test('a group says how many fail in words and shows the first fix', () => {
    expect(rows('gates', 100, { gates: g() }).at(-1)).toBe('■ Completion gate  1 failing  run the hooks suite');
  });
  test('D8: a long tail wraps onto muted rows and is never cut mid-word', () => {
    const out = rows('gates', 40, { gates: g({ lines: [{ id: 'verify', label: long, ok: false }] }) });
    expect(out.join(' ')).toContain('verification coverage');
    expect(out.every((l) => cells(l) <= 40)).toBe(true);
  });
  test('an open group lists its lines; an open failing line shows the fix and copies it on a second press', () => {
    const open = bodyLines(panelWorld('gates', 100, mocha, { gates: g(), expanded: 'gate:verify' })).map((l) => ({ t: lineText(l), p: l.press }));
    expect(open.map((x) => x.t)).toContain('  ■ verification coverage');
    expect(open.map((x) => x.t)).toContain('     fix: run the hooks suite (press to copy)');
    expect(open.find((x) => x.p?.key === 'gate:verify')?.p?.copy).toBe('run the hooks suite');
  });
  test('an unavailable source says so', () => {
    expect(rows('gates', 100, { gates: [{ id: 'header', title: 'Header contract', lines: [], error: 'findings.json unreadable' }] }).at(-1)).toContain('unavailable: findings.json unreadable');
  });
  test('no gate data is the design empty state', () => {
    expect(rows('gates', 100, { gates: [] }).at(-1)).toBe('(no state)  no gates reported yet');
  });
});

describe('core tab', () => {
  test('contract, verdicts, offload and route sections with words on every figure', () => {
    const out = rows('core', 120, { core }).join('\n');
    for (const w of ['contract  header 3/4', 'verdicts  1 verified · 1 refuted', 'offload  17.9k kept in tmux, 608 back (30x)', 'route  class/effort']) expect(out).toContain(w);
  });
  test('L16: three explorers on a one-seat route read ran 3 / planned 1 and drift, not 1x as planned', () => {
    const c = JSON.parse(JSON.stringify(core)) as CoreModel;
    c.routes = [{ teamId: 't1', name: 'audit', cls: 'audit', effort: 'low', isolation: 'shared', maxParallel: 3, drift: ['explorer ran 3, seat plans 1'], transport: 'in-process', seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['haiku', 'haiku', 'haiku'] }] }];
    const out = rows('core', 120, { core: c }).join('\n');
    expect(out).toContain('ran 3 / planned 1 (haiku)');
    expect(out).toContain('■ drift');
    expect(out).not.toContain('as planned');
  });
  test('an empty ledger reads no verdicts yet, never 0 verified', () => {
    const c = { ...core, verdicts: [], ledger: { verified: 0, refuted: 0, pending: 0, claimed: 0, unchecked: 0 } } as CoreModel;
    const out = rows('core', 120, { core: c }).join('\n');
    expect(out).toContain('verdicts  no verdicts yet');
    expect(out).not.toContain('0 verified');
  });
  test('an open verdict row shows which claim it checked and its evidence', () => {
    const v = core.verdicts[1]!;
    const open = bodyLines(panelWorld('core', 120, mocha, { core, expanded: `core:v:${v.id}` })).map(lineText).join('\n');
    expect(open).toContain('no worker claim before it');
    expect(open).toContain('evidence:');
  });
  test('no core data is the design empty state', () => {
    expect(rows('core', 120, { core: null }).at(-1)).toBe('(no state)  no verdicts, workers or gates yet');
  });
});

describe('channel tab', () => {
  test('header counts people and unread in words; blocked and handoff notes carry the state glyph and word', () => {
    const out = bodyLines(panelWorld('channel', 120, mocha)).map(lineText);
    expect(out[0]).toBe('#atlas-board-mod  6 people · 1 unread');
    expect(out[2]).toContain('▲ blocked');
    expect(out[3]).toContain('● handoff');
  });
  test('the log keeps the newest rows - 4 notes', () => {
    const notes = Array.from({ length: 40 }, (_, i) => ({ at: '10:00', from: 'lead', text: `note ${i}` }));
    expect(bodyLines(panelWorld('channel', 120, mocha, { notes, rows: 20 }))).toHaveLength(1 + 16);
  });
});

describe('shared invariants', () => {
  test('no row is wider than its panel at any width, theme-free and in ASCII mode', () => {
    for (const ui of [mocha, ascii]) for (const t of tabs) for (const cols of [10, 24, 38, 56, 80, 100, 120, 160])
      for (const l of panelText(panelWorld(t, cols, ui, { core }))) expect([t, cols, cells(l)]).toEqual([t, cols, Math.min(cells(l), cols)]);
  });
  test('ASCII mode draws plain ASCII only', () => {
    for (const t of tabs) expect(panelText(panelWorld(t, 120, ascii, { core })).join('\n')).toMatch(/^[\x20-\x7e\n]*$/);
    expect(card(120, ascii).join('\n')).toMatch(/^[\x20-\x7e\n]*$/);
  });
  test('no row carries two chip fills and the brand capsule appears once', () => {
    for (const t of tabs) {
      const lines = panelText(panelWorld(t, 120, mocha, { core }));
      expect(lines.join('\n').split('◆').length - 1).toBe(1);
    }
  });
  test('every count carries its word', () => {
    const route = rows('route', 120).join('\n');
    expect(route).toContain('3 of 7');
    expect(route).toContain('2/4');
    expect(route).toContain('2 of 3 green');
    expect(route).toMatch(/1 running/);
    for (const l of rows('route', 120).slice(0, 9)) expect(l.replace(/\d+ of \d+|\d+\/\d+/g, '')).not.toMatch(/(^|\s)\d+$/);
  });
  test('the latte theme changes tones only, never text', () => {
    expect(rows('team', 120, {}, latte)).toEqual(rows('team', 120, {}, mocha));
  });
});

describe('worker card', () => {
  for (const cols of [120, 80]) test(`matches the design card at ${cols} columns`, () => expect(card(cols)).toEqual(cardDesign[cols]!));
  test('is a closed box 44 wide at 120, 80 and 44 columns, and clips to a narrower terminal', () => {
    for (const cols of [120, 80, 44]) {
      const c = card(cols);
      for (const l of c) expect(cells(l)).toBe(44);
      expect(c[0]!.startsWith('┌') && c[0]!.endsWith('┐')).toBe(true);
      expect(c.slice(1, -1).every((l) => l.startsWith('│') && l.endsWith('│'))).toBe(true);
      expect(c.at(-1)!.startsWith('└') && c.at(-1)!.endsWith('┘')).toBe(true);
    }
    for (const l of card(30)) expect(cells(l)).toBe(30);
  });
  test('the border carries the state word for every state, and the frame takes the state tone', () => {
    for (const s of UI_STATES) {
      const top = cardLines({ ...worldCard(mocha), state: s }, 80)[0]!;
      expect(runsString(top)).toContain(` ${s} implementer-band `);
      expect(top.find((x) => x.t === s)?.tone).toBe('text');
      expect(top[0]!.tone).not.toBe('text');
      expect(top[0]!.tone).not.toBe('line');
    }
  });
  test('rows without data are left out; a goal row comes first', () => {
    const c = cardLines({ state: 'done', name: 'x', goal: 'map the auth flow', ui: mocha }, 80).map((r) => runsString(r).trimEnd());
    expect(c).toHaveLength(3);
    expect(c[1]).toBe('│ goal  map the auth flow                  │');
  });
});

describe('toast', () => {
  test('order is state, name, fact (design golden)', () => {
    expect([toastText('done', 'implementer-layout', '9 of 9 steps', mocha), toastText('failed', 'implementer-live', 'tests red 3', mocha)]).toEqual(toastDesign);
  });
  test('ASCII mode uses the ASCII state mark', () => {
    expect(toastText('failed', 'a', 'b', ascii)).toBe('# failed  a  b');
  });
});
