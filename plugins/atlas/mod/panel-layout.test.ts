// The shared side panel layout (design system rev 4): design goldens, per-tab goldens at 120, 80 and the real pane width,
// the live defects it fixes (L17 route content, L16 seat drift, L21 narrow strip), subagents by name and state,
// toasts, the closed card box, ASCII mode and width safety.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { panelWorld, worldCard } from '../contracts/panel-world';
import { padStrip } from './golden-pad';
import { cardDesign, sidepanelDesign, subagentsDesign, tabGolden, toastDesign } from '../contracts/panel-golden';
import { world } from '../contracts/band-world';
import { cells, runsString, stateWordTone, UI_STATES, type Ui } from './atlas-ui';
import { coreModel, type CoreModel } from './data/core';
import { bodyLines, cardLines, headerRows, lineText, PANEL_TABS, panelText, STRIP_TABS, stripLayout, toastText, type PanelModel, type PanelTab } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const latte: Ui = { theme: 'latte', ascii: false, color: 'truecolor' };
const ascii: Ui = { theme: 'mocha', ascii: true, color: 'none' };
const tabs = PANEL_TABS.map((t) => t.id);
const core: CoreModel = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
/** The short pane (the design's 24 rows) unless a test says otherwise: a pane of 30 rows or more fills its spare rows (mod/panel-side.test.ts, the tall goldens). */
const rows = (t: PanelTab, cols: number, over: Partial<PanelModel> = {}, ui: Ui = mocha): string[] => panelText(panelWorld(t, cols, ui, { rows: 24, ...over }));
const card = (cols: number, ui: Ui = mocha): string[] => cardLines(worldCard(ui), cols).map((r) => runsString(r).trimEnd());

describe('side panel design goldens', () => {
  for (const cols of [120, 80]) {
    test(`route head at ${cols} equals the design sidepanel golden`, () => {
      expect(rows('route', cols).slice(0, sidepanelDesign[cols]!.length)).toEqual(padStrip(sidepanelDesign[cols]!));
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
        expect(rows(t, cols, { core, rows: 40 })).toEqual(padStrip(tabGolden[t]![cols]!)); // the golden pane is the live one: 40 rows
      });
    }
  }
});

describe('tab strip', () => {
  test('lists route team channel gates core board by name; the lit tab is ruled and bold', () => {
    for (const t of tabs) {
      const [strip, rule] = headerRows(panelWorld(t, 120, mocha)).slice(2, 4);
      expect(lineText(strip!).trim()).toBe('route  team  channel  gates  core  board');
      const lit = strip!.runs.find((x) => x.bold)!;
      expect(lit.t).toBe(t);
      expect(lineText(rule!).trim()).toBe('━'.repeat(t.length));
      expect(lineText(rule!).indexOf('━')).toBe(lineText(strip!).indexOf(t));
    }
  });
  test('L21: the strip keeps every tab, in order, at every width from 29 to 140 and never overflows (it wraps)', () => {
    for (let cols = 29; cols <= 140; cols++) {
      const rowsOut = headerRows(panelWorld('route', cols, mocha)).slice(2).map(lineText).filter((l) => /^ (route|team|channel|gates|core|board)/.test(l));
      for (const l of rowsOut) expect(cells(l)).toBeLessThanOrEqual(cols);
      expect(rowsOut.join(' ').split(/\s+/).filter(Boolean).join(' ')).toBe('route team channel gates core board'); // C1: names only, in order, wrapped whole when the pane is narrower than the row
    }
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
    expect(text).toContain('0/2');
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
    expect(rows('route', 120, { todos: [], workers: [], gates: [] })).toContain('    add one with /todo add'); // critique 14: the `todo` row above says `no tasks yet`; the hint does not say it twice
  });
  test('an open task row shows its evidence line, or says there is none', () => {
    const done = { id: 'd1', label: 'wire it', state: 'done' as const, evidence: 'tests green' };
    expect(rows('route', 100, { todos: [done], expanded: 'task:d1' }).join('\n')).toContain('tests green');
    expect(rows('route', 100, { todos: [{ ...done, evidence: null }], expanded: 'task:d1' }).join('\n')).toContain('no evidence yet');
  });
  test('critique 22: a done task title is dim in the panel and never struck through (the HUD draws no strikethrough)', () => {
    const todos = [{ id: 'd1', label: 'read alpha.py', state: 'done' as const }, { id: 'q1', label: 'read gamma.py', state: 'queued' as const }];
    const runs = bodyLines(panelWorld('route', 100, mocha, { todos })).flatMap((l) => l.runs);
    expect(runs.filter((x) => x.strike)).toEqual([]);
    expect(runs.find((x) => x.t.includes('read alpha.py'))?.tone).toBe('sub');
  });
  test('a plan longer than the row budget folds into a counted more row', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, label: `task ${i}`, state: 'queued' as const }));
    const out = rows('route', 80, { todos: many, rows: 20 });
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out.some((l) => /\d+ more tasks on the board$/.test(l))).toBe(true);
  });
  test('names that do not fit the gates row fold to a labelled count', () => {
    expect(rows('route', 30).find((l) => l.startsWith(' gates '))).toContain('2/3 green');
  });
});

describe('team tab lists the subagents by name and state', () => {
  test('every worker row names the worker and one of the six state words', () => {
    const body = bodyLines(panelWorld('team', 80, mocha, { rows: 24 })).map(lineText); // the short pane: one row per worker
    expect(body).toHaveLength(world.workers.length);
    const byTask = ['implementer-layout', 'implementer-gates', 'implementer-band', 'runner-land', 'implementer-live'].map((n) => world.workers.find((w) => w.name === n)!); // critique 11 A3: by task, not by state
    byTask.forEach((w, i) => {
      expect(body[i]).toContain(w.name);
      expect(body[i]).toContain(w.state);
      expect(UI_STATES).toContain(w.state);
    });
  });
  test('by task: T1, T3, T4, T5, T6 (a worker keeps its row whatever its state)', () => {
    expect(bodyLines(panelWorld('team', 80, mocha, { rows: 24 })).map((l) => lineText(l).slice(4).split(' ')[0])).toEqual(
      ['implementer-layout', 'implementer-gates', 'implementer-band', 'runner-land', 'implementer-live']);
  });
  test('the recipient takes the focus marker; without one the first running worker does', () => {
    const marked = (r: string | null): string[] => bodyLines(panelWorld('team', 80, mocha, { recipient: r })).map(lineText).filter((l) => l.startsWith('▸'));
    expect(marked(null)).toEqual([expect.stringContaining('implementer-band')]);
    expect(marked('runner-land')).toEqual([expect.stringContaining('runner-land')]);
  });
  test('an open worker row adds what it is doing and how long it has run', () => {
    const open = bodyLines(panelWorld('team', 80, mocha, { expanded: 'worker:implementer-band' })).map(lineText);
    const at = open.findIndex((l) => l.includes('implementer-band'));
    expect(open[at + 1]).toMatch(/^ {4}task {2}T4/); // wave 24: a row is one line; the rows under it open on a press
    expect(open.slice(at + 1, at + 6).join('\n')).toContain('read runs.ts:17');
    expect(open.slice(at + 1, at + 6).join('\n')).toContain('running 42s');
    expect(bodyLines(panelWorld('team', 80, mocha, {})).map(lineText).filter((l) => l.includes('runs.ts'))).toHaveLength(0); // closed at 80: the one row, no detail (the 120-column row adds its last step)
  });
  test('critique 15 C5: a project-directory slug in an agent\'s last step never reaches the team rows', () => {
    // live-110-95c4a588-1/tab-team.png: `last  run -home-user-tech-t`
    for (const cols of [37, 80, 120]) {
      const all = rows('team', cols, { workers: [{ name: 'gamma-explorer', state: 'done', detail: 'run -home-user-tech-tools-claude-worktrees-atlas-x', secs: 14, model: 'haiku', goal: 'read gamma.py' }], rows: 40 }).join('\n');
      expect([cols, all.includes('-home-')]).toEqual([cols, false]);
      expect([cols, /last\s+run\s*$/m.test(all)]).toEqual([cols, false]); // and no verb left alone to stand for the step
    }
  });
  test('nobody dispatched is the design empty state', () => {
    expect(rows('team', 80, { workers: [] }).at(-1)).toBe(' '.repeat(29) + 'nobody dispatched yet'); // design rev 5 C2: one dim centred line
    expect(rows('team', 37, { workers: [] }).every((l) => cells(l) <= 37)).toBe(true);
  });
  test('rows are pressable and select the worker', () => {
    const l = bodyLines(panelWorld('team', 80, mocha)).find((x) => x.press?.name === 'implementer-band')!;
    expect(l.press).toEqual({ kind: 'worker', key: 'worker:implementer-band', name: 'implementer-band' });
  });
});

describe('gates tab', () => {
  const long = 'the completion gate found that verification coverage is missing for the changed modules and the docs tree';
  const g = (over: object = {}) => [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'verify', label: 'verification coverage', ok: false, detail: 'no verified finding', fix: 'run the hooks suite' }, { id: 'docs', label: 'docs updated', ok: true }], ...over }];
  test('a group says how many fail in words and shows the first fix', () => {
    const row = rows('gates', 100, { gates: g() }).at(-1)!;
    expect(row).toMatch(/^ {2}▲ Completion gate {2}warning run the hooks suite +1\/2$/);
    expect(cells(row)).toBe(100); // the failing count is the right-aligned value
  });
  test('D8: a long tail wraps onto muted rows and is never cut mid-word', () => {
    const out = rows('gates', 40, { gates: g({ lines: [{ id: 'verify', label: long, ok: false }] }) });
    expect(out.join(' ')).toContain('verification coverage');
    expect(out.every((l) => cells(l) <= 40)).toBe(true);
  });
  test('an open group lists its lines; an open failing line shows the fix and copies it on a second press', () => {
    const open = bodyLines(panelWorld('gates', 100, mocha, { gates: g(), expanded: 'gate:verify' })).map((l) => ({ t: lineText(l), p: l.press }));
    expect(open.map((x) => x.t)).toContain('    ▲ verification coverage');
    expect(open.map((x) => x.t)).toContain('      fix: run the hooks suite (press to copy)');
    expect(open.find((x) => x.p?.key === 'gate:verify')?.p?.copy).toBe('run the hooks suite');
  });
  test('an unavailable source says so', () => {
    expect(rows('gates', 100, { gates: [{ id: 'header', title: 'Header contract', lines: [], error: 'findings.json unreadable' }] }).at(-1)).toContain('unavailable: findings.json unreadable');
  });
  test('no gate data is the design empty state', () => {
    expect(rows('gates', 100, { gates: [] }).at(-1)).toBe(' '.repeat(39) + 'no gates reported yet');
  });
});

describe('core tab', () => {
  test('contract, verdicts, offload and route sections with words on every figure', () => {
    const out = rows('core', 120, { core }).join('\n');
    for (const w of ['    done items  0 of 7', '    verdicts  1 verified · 1 refuted', '    reading  17.9k tokens read by workers, 608 returned to the lead, 3% of what they read', '    teams  3 this session']) expect(out).toContain(w);
  });
  test('L16: three explorers on a one-seat route read ran 3 / planned 1 and drift, not 1x as planned', () => {
    const c = JSON.parse(JSON.stringify(core)) as CoreModel;
    c.routes = [{ teamId: 't1', name: 'audit', cls: 'audit', effort: 'low', isolation: 'shared', maxParallel: 3, drift: ['explorer ran 3, seat plans 1'], transport: 'in-process', seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['haiku', 'haiku', 'haiku'] }] }];
    const out = rows('core', 120, { core: c }).join('\n');
    expect(out).toContain('3 explorers ran, the plan said 1'); // B4 and critique 18 A5: plain words, not `ran 3 / planned 1 (haiku) haiku/low` nor `3 ran, plan said 1 (haiku)`
    expect(out).not.toMatch(/too many/); // critique 21: the count is said once, in the heading; a second `3 explorers too many` row said it twice
    expect(out.match(/3 explorers/g)).toHaveLength(1);
    expect(out).not.toContain('ran 3 / planned 1');
    expect(out).not.toContain('as planned');
  });
  test('L16: the heading counts the agents that ran (4), once, and no seat row repeats the count', () => {
    const c = JSON.parse(JSON.stringify(core)) as CoreModel;
    c.routes = [{ teamId: 't1', name: 'audit', cls: 'audit', effort: 'low', isolation: 'shared', maxParallel: 4, drift: ['explorer ran 4, seat plans 1'], transport: 'in-process', seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['haiku', 'haiku', 'haiku', 'haiku'] }] }];
    const out = rows('core', 120, { core: c }).join('\n');
    expect(out).toContain('4 explorers ran, the plan said 1');
    expect(out).not.toMatch(/too many/);
    expect(out).not.toContain('1x explorer');
  });
  // critique 12 B1/B6: live-150-8271cfc8-1 core tab: the plan is 5/5 done, the rows carry no evidence and no finding verifies them
  const planDone = Array.from({ length: 5 }, (_, i) => ({ id: `t${i + 1}`, label: `T${i + 1}`, state: 'done' as const, evidence: null }));
  const zeroCore = { ...core, verdicts: [], claims: [], ledger: { verified: 0, refuted: 0, pending: 0, claimed: 0, unchecked: 0 }, contract: { ...core.contract, evidence: { ok: 0, total: 5 }, verifiedDone: { ok: 0, total: 5 } } } as CoreModel;
  test('B1: a zero beside a full plan is explained, never bare', () => {
    for (const cols of [150, 110, 80, 56]) {
      const out = rows('core', cols, { core: zeroCore, todos: planDone, rows: 40 }).join('\n');
      expect([cols, out]).toEqual([cols, expect.stringMatching(/evidence +0\/5 +5 done without evidence/)]);
      expect([cols, out]).toEqual([cols, expect.stringMatching(/verified +0\/5 +0 verified findings so far/)]);
    }
  });
  test('B6: the verdict line carries the verified count against the plan denominator whether or not a done item has evidence', () => {
    for (const ev of [{ ok: 0, total: 5 }, { ok: 5, total: 5 }]) {
      const c = { ...zeroCore, contract: { ...zeroCore.contract, evidence: ev } } as CoreModel;
      expect(rows('core', 150, { core: c, todos: planDone, rows: 40 }).join('\n')).toMatch(/verified +0\/5/);
    }
  });
  // gates-tab metric 66.7 at 95c4a588: both gates a and b passed, so both rows read `not required for this run` and no `N verified` figure was left on the gates or core tab
  test('B7: a verified row waived by its gate still carries the true verified count; the evidence row keeps `not required for this run`', () => {
    const gates = [{ id: 'g', title: 'Completion gate', lines: [{ id: 'a', label: 'Evidence captured', ok: true }, { id: 'b', label: 'Verified finding recorded', ok: true }] }];
    for (const cols of [150, 110, 80, 56]) {
      const out = rows('core', cols, { core: zeroCore, todos: planDone, rows: 40, gates }).join('\n');
      const flat = out.replace(/\s+/g, ' '); // a narrow pane wraps the sentence under its row
      expect([cols, flat]).toEqual([cols, expect.stringContaining('evidence 0/5 not required for this run')]);
      expect([cols, flat]).toEqual([cols, expect.stringContaining('verified 0/5 0 verified findings so far, not required for this run')]);
      expect(out).toMatch(/(\d+) verified|verified \d+ of \d+/); // the live scorer's verdict-line pattern (tools/live_capture.py)
    }
  });
  test('B3: the gates figure is n/m in the route tab and on the group row, as the header has it', () => {
    const gates = [{ id: 'lint', title: 'Lint', lines: [{ id: 'l1', label: 'style', ok: true }] }, { id: 'doctor', title: 'Doctor', lines: [{ id: 'd1', label: 'x', ok: false }, { id: 'd2', label: 'y', ok: true }] }];
    for (const cols of [150, 110, 80]) {
      const route = rows('route', cols, { gates }).join('\n');
      expect([cols, route]).toEqual([cols, expect.stringContaining('1/2 green')]);
      expect(route).not.toMatch(/\d+ of \d+ green/);
      expect(rows('gates', cols, { gates }).join('\n')).not.toMatch(/\d+ of \d+ green/);
    }
  });
  test('B2: a drifted dispatch route makes the routing group warn on the gates tab, the verdict the core row states', () => {
    const c = JSON.parse(JSON.stringify(core)) as CoreModel;
    c.routes = [{ teamId: 'in-process:audit/low', name: 'in-process', cls: 'audit', effort: 'low', isolation: '', maxParallel: 3, drift: ['explorer ran 3, seat plans 1'], transport: 'in-process', seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['haiku', 'haiku', 'haiku'] }] }];
    const gates = [{ id: 'routing', title: 'Tool routing', lines: [{ id: 'native-Read', label: 'Native Read calls', ok: true }] }];
    expect(rows('gates', 150, { gates, core: { ...c, routes: [] } }).join('\n')).toMatch(/Tool routing +passing/);
    const out = rows('gates', 150, { gates, core: c }).join('\n');
    expect(out).toMatch(/Tool routing +warning/);
    expect(out).toContain('Dispatches followed the plan');
    const open = bodyLines(panelWorld('gates', 150, mocha, { gates, core: c, expanded: 'gate:dispatch-plan' })).map(lineText).join('\n');
    expect(open).toContain('3 explorers ran, the plan said 1'); // the line's detail is the core row's own sentence
    expect(rows('core', 150, { core: c }).join('\n')).toContain('3 explorers ran, the plan said 1'); // the same sentence, once
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
    expect(rows('core', 120, { core: null }).at(-1)).toBe(' '.repeat(43) + 'no verdicts, workers or gates yet');
  });
});

describe('channel tab', () => {
  test('header counts people and unread in words; blocked and handoff notes carry the state glyph and word', () => {
    const out = bodyLines(panelWorld('channel', 120, mocha)).map(lineText);
    expect(out[0]).toBe('    #atlas-board-mod  5 people · 2 unread');
    expect(out[2]).toMatch(/^ {2}▲ implementer-live +blocked /);
    expect(out[3]).toMatch(/^ {2}● implementer-layout +handoff /);
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
    expect(route).toContain('3/7');
    expect(route).toMatch(/phase +research\n/); // the phase word alone, no n/m beside it (critique 17 A5)
    expect(route).toContain('2/3 green');
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
      expect(runsString(top)).toContain(` ◆ ${s} implementer-band `);
      expect(top.find((x) => x.t === s)?.tone).toBe(stateWordTone(s, mocha));
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
  test('order is bar, ATLAS mark, state, name, fact (design golden, with the round 3 bar and mark)', () => {
    expect([toastText('done', 'implementer-layout', '9 of 9 steps', mocha), toastText('failed', 'implementer-live', 'tests red 3', mocha)]).toEqual(toastDesign);
  });
  test('ASCII mode uses the ASCII state mark', () => {
    expect(toastText('failed', 'a', 'b', ascii)).toBe('| ATLAS  x failed   a  b');
  });
});

describe('route tab names the running agents (live round2: `agents ◒ 3 running` and no name)', () => {
  const plan = [{ id: 'T1', label: 'T1 read alpha.py (alpha-explorer)', state: 'queued' as const }, { id: 'T2', label: 'T2 combine the reports', state: 'queued' as const }]; // host-spawned agents: the plan rows have no owner
  const running = ['alpha', 'beta', 'gamma'].map((n) => ({ name: `${n}-explorer`, state: 'running' as const, detail: 'Read', secs: 12 }));
  test('each agent that holds no plan row is listed by name with its state word, at 80 and 120 columns', () => {
    for (const cols of [80, 120]) {
      const text = rows('route', cols, { todos: plan, workers: running }).filter((l) => /^ {4}\S/.test(l)).join('\n');
      for (const n of ['alpha', 'beta', 'gamma']) expect(text).toMatch(new RegExp(`[◐◓◑◒◐◓◑◒◐◓] ${n}-explorer\\s+running`));
    }
  });
  test('an agent that owns a plan row is named by that row, not listed twice; finished and parked ones are not listed', () => {
    const owned = [{ ...plan[0]!, label: 'T1 read alpha.py', owner: 'alpha-explorer' }, plan[1]!];
    const text = rows('route', 80, { todos: owned, workers: [...running, { name: 'delta-explorer', state: 'done' as const, detail: 'finished' }, { name: 'eps-explorer', state: 'queued' as const, detail: 'parked' }] }).join('\n');
    expect(text.match(/alpha-explorer/g)).toHaveLength(1);
    expect(text).toMatch(/beta-explorer\s+running/);
    expect(text).not.toContain('delta-explorer');
    expect(text).not.toContain('eps-explorer');
  });
  test('a long group folds into `+N more`, and a failed agent reads failed', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `w${i}-explorer`, state: i === 0 ? ('failed' as const) : ('running' as const), detail: 'x' }));
    const out = rows('route', 80, { todos: plan, workers: many, rows: 40 });
    expect(out.join('\n')).toMatch(/w0-explorer\s+failed/);
    expect(out.join('\n')).toContain('3 more on the team tab');
  });
});

describe('critique 12 A2: the route tab drops the owner column before it cuts a title', () => {
  // live-110-8271cfc8-2/tab-route.png: `T1 read ... done  alpha-explorer`; live-150-8271cfc8-1 mod-todo_tree.png: `T1 read alpha.py (alpha-e... done  alpha-explorer`
  const plan = [
    { id: 'T1', label: 'T1 read alpha.py (alpha-explorer)', state: 'done' as const, owner: 'alpha-explorer' },
    { id: 'T2', label: 'T2 read beta.py (beta-explorer)', state: 'done' as const, owner: 'beta-explorer' },
    { id: 'T4', label: 'T4 combine the three reports', state: 'done' as const },
  ];
  const taskRows = (cols: number): string[] => rows('route', cols, { todos: plan, workers: [] }).filter((l) => /\bT\d /.test(l));
  test('at 55 columns every title shows whole and the owner is not printed a second time', () => {
    const out = taskRows(55);
    expect(out.length).toBe(3);
    expect(out[0]).toContain('T1 read alpha.py (alpha-explorer)');
    expect(out[1]).toContain('T2 read beta.py (beta-explorer)');
    for (const l of out) { expect(cells(l)).toBeLessThanOrEqual(55); expect(l.match(/alpha-explorer|beta-explorer/g)?.length ?? 0).toBeLessThanOrEqual(1); }
  });
  test('at 37 columns (the 110-column pane) every row is one line: the title without its `(owner)`, then its state; no `...`, no owner anywhere (critique 17 B5)', () => {
    const all = rows('route', 37, { todos: plan, workers: [] });
    for (const l of all) expect(cells(l)).toBeLessThanOrEqual(37);
    const text = all.join('\n').replace(/\s+/g, ' ');
    expect(all.find((l) => l.includes('T1 read alpha.py'))).toMatch(/T1 read alpha\.py\s+done$/); // live: `T1 read alpha.py` / `(alpha-explorer) done` was a staircase
    expect(all.find((l) => l.includes('T2 read beta.py'))).toMatch(/T2 read beta\.py\s+done$/);
    expect(text).not.toContain('...');
    expect(text).not.toContain('-explorer');
  });
  test('critique 15 C2: at 37 columns no row is a state word alone: the title wraps, the word stays on its last line', () => {
    // live-110-95c4a588-1/tab-route.png: `T1 read alpha.py (alpha-explorer)` over a lone `done`
    for (const state of ['done', 'running', 'blocked'] as const) {
      const all = rows('route', 37, { todos: plan.map((t) => ({ ...t, state })), workers: [] });
      for (const l of all) expect([l, /^\s+(done|running|blocked|failed|queued|returned)$/.test(l)]).toEqual([l, false]);
      for (const l of all) expect(cells(l)).toBeLessThanOrEqual(37);
      const t1 = all.findIndex((l) => l.includes('T1 read'));
      expect(all.slice(t1, t1 + 2).join(' ')).toMatch(new RegExp(`alpha.py\\s.*${state}`));
      expect(all.join('\n')).toContain('T1 read alpha.py'); // the title is still whole; the owner is the team tab's (critique 17 B5)
    }
  });
  test('a row whose title does not name its owner keeps the owner column; one that does never prints it twice, at any width', () => {
    const mixed = [...plan.slice(0, 1), { id: 'T4', label: 'T4 combine the three reports', state: 'done' as const, owner: 'lead-agent' }];
    for (const cols of [120, 80, 55]) {
      const out = rows('route', cols, { todos: mixed, workers: [] }).filter((l) => /\bT\d /.test(l));
      expect(out[0]!.match(/alpha-explorer/g)).toHaveLength(1);
      if (cols >= 80) expect(out[1]).toMatch(/done\s+lead-agent$/);
      else expect(out[1]).not.toContain('lead-agent'); // the column gives way before a title that names its owner is cut
    }
  });
});

describe('hud110: the route tab names the running agents in a 40 row terminal with three running (pane under 30 rows)', () => {
  const plan = ['T1 read alpha.py (alpha-explorer)', 'T2 read beta.py (beta-explorer)', 'T3 read gamma.py (gamma-explorer)', 'T4 combine the three reports', 'T5 write the final summary'].map((label, i) => ({ id: `T${i + 1}`, label, state: 'running' as const, ...(i < 3 ? { owner: ['alpha', 'beta', 'gamma'][i]! + '-explorer' } : {}) })); // the live plan: each agent owns a row, so none is loose
  const running = ['alpha', 'beta', 'gamma'].map((n) => ({ name: `${n}-explorer`, state: 'running' as const, detail: 'Read', secs: 12 }));
  test('29 pane rows (live-110: 31 beside three running agents) list each agent under the count', () => {
    for (const cols of [37, 55]) {
      const out = rows('route', cols, { todos: plan, workers: running, rows: 29 }).filter((l) => /^ {4}\S/.test(l)).join('\n');
      for (const n of ['alpha', 'beta', 'gamma']) expect(out).toMatch(new RegExp(`[◐◓◑◒◐◓◑◒◐◓] ${n}-explorer\\s+running`));
    }
  });
  test('a pane too short for the agents and the whole plan keeps the short form', () => {
    const out = rows('route', 55, { todos: plan, workers: running, rows: 18 }).filter((l) => /^ {4}\S/.test(l)).join('\n');
    expect(out).not.toMatch(/[◐◓◑◒◐◓◑◒◐◓] alpha-explorer\s+running/);
  });
});
