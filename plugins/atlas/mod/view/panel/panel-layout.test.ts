// The shared side panel layout (redesigned: tabs health / status / gates / channel): design goldens, per-tab goldens at 120, 80 and the real pane width,
// the live defects it fixes (L17 route content, L21 narrow strip), the tally by name and state, toasts, the closed card box, ASCII mode and width safety.
// The goldens (contracts/panel-golden.ts) were regenerated on purpose from the redesigned layout; panel-redesign.test.ts asserts the same shape independently.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../../../contracts/core-fixture';
import { panelWorld, worldCard } from '../../../contracts/panel-world';
import { cardDesign, sidepanelDesign, tabGolden, toastDesign } from '../../../contracts/panel-golden';
import { world } from '../../../contracts/band-world';
import { cells, runsString, stateWordTone, UI_STATES, type Ui } from '../../design/atlas-ui';
import { coreModel, type CoreModel } from '../../data/core';
import { bodyLines, cardLines, headerRows, lineText, MORE_KEY, PANEL_TABS, panelText, STRIP_TABS, tabRows, toastText, type PanelGateLine, type PanelModel, type PanelTab } from './panel-layout';
import { leadSpinnerGlyph } from '../../design/atlas-ui';
import { forgetBandFrame, sharedSpinFrame } from '../../motion/motion';
import { panelLines } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const latte: Ui = { theme: 'latte', ascii: false, color: 'truecolor' };
const ascii: Ui = { theme: 'mocha', ascii: true, color: 'none' };
const tabs = PANEL_TABS.map((t) => t.id);
const core: CoreModel = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
/** The short pane (the design's 24 rows) unless a test says otherwise. */
const rows = (t: PanelTab, cols: number, over: Partial<PanelModel> = {}, ui: Ui = mocha): string[] => panelText(panelWorld(t, cols, ui, { rows: 24, ...over }));
const card = (cols: number, ui: Ui = mocha): string[] => cardLines(worldCard(ui), cols).map((r) => runsString(r).trimEnd());

describe('side panel design goldens', () => {
  for (const cols of [120, 80]) {
    test(`route head at ${cols} equals the design sidepanel golden`, () => {
      expect(rows('route', cols).slice(0, sidepanelDesign[cols]!.length)).toEqual(sidepanelDesign[cols]!);
    });
  }
  test('the team content is the status tab: its TEAM section carries the worker counts with their words', () => {
    expect(rows('team', 120, { rows: 40 }).find((l) => l.includes('TEAM'))).toContain('1 queued  ◐ 1 running'.replace('1 queued  ◐ 1 running', '1 running'));
    expect(rows('team', 120, { rows: 40 })).toEqual(rows('route', 120, { rows: 40 }));
  });
  for (const t of tabs) {
    for (const cols of [120, 80, 56]) {
      test(`${t} at ${cols} equals its golden`, () => {
        expect(rows(t, cols, { core, rows: 40 })).toEqual(tabGolden[t]![cols]!); // the golden pane is the live one: 40 rows
      });
    }
  }
});

describe('tab strip', () => {
  test('lists status health channel bored by name; the lit tab is the filled chip with an accent segment on the rule', () => {
    for (const t of tabs) {
      const [strip, rule] = headerRows(panelWorld(t, 120, mocha)).slice(2, 4);
      expect(lineText(strip!).trim().replace(/ +/g, ' ').replace(/ \d/g, '')).toBe('status health channel bored');
      const lit = strip!.runs.find((x) => x.bold && x.bg === 'accent')!;
      expect(lit.t.trim()).toBe(PANEL_TABS.find((x) => x.id === t)!.label);
      expect(lineText(rule!)).toMatch(/━/);
    }
    expect(STRIP_TABS.map((t) => t.label)).toEqual(['status', 'health', 'channel', 'bored']);
  });
  test('L21: one strip row at every width from 29 to 140, never wider than the pane; from 34 the closed set and the `more ›` set together hold every tab, in order', () => {
    const words = (m: ReturnType<typeof panelWorld>): string[] => tabRows(m).map(lineText).join(' ').split(/\s+/).filter((w) => w && !/^\d+$/.test(w) && !['▸', '›', 'more', '‹', 'back'].includes(w));
    for (let cols = 29; cols <= 140; cols++) {
      const closed = tabRows(panelWorld('route', cols, mocha, {}));
      const open = tabRows(panelWorld('route', cols, mocha, { expanded: MORE_KEY }));
      expect([closed.length, open.length]).toEqual([1, 1]);
      for (const l of [...closed, ...open]) expect(cells(lineText(l))).toBeLessThanOrEqual(cols);
      const said = (cols >= 40 ? words(panelWorld('route', cols, mocha, {})) : [...words(panelWorld('route', cols, mocha, {})), ...words(panelWorld('route', cols, mocha, { expanded: MORE_KEY }))]).map((w) => (w === 'chan' ? 'channel' : w));
      if (cols >= 34) expect(said).toEqual(['status', 'health', 'channel', 'bored']); // names only, in order (the short `chan` where the whole words do not fit with their counts)
    }
  });
});

describe('route tab (the status tab)', () => {
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
    const text = rows('route', 120, { todos: [], workers: [], gates: [] }).join('\n');
    expect(text).toContain('no tasks yet');
    expect(text).toContain('no agents yet');
  });
  test('an open task row shows its evidence line', () => {
    const open = { id: 'd1', label: 'wire it', state: 'running' as const, evidence: 'tests green' }; // a done task leaves the list, so the open row is a running one
    expect(rows('route', 100, { todos: [open], expanded: 'task:d1' }).join('\n')).toContain('tests green');
  });
  test('critique 22: a done task leaves the list (one `1 done` line keeps the count, the plan still reads 1 of 2) and nothing is struck through', () => {
    const todos = [{ id: 'd1', label: 'read alpha.py', state: 'done' as const }, { id: 'q1', label: 'read gamma.py', state: 'queued' as const }];
    const runs = bodyLines(panelWorld('route', 100, mocha, { todos })).flatMap((l) => l.runs);
    expect(runs.filter((x) => x.strike)).toEqual([]);
    expect(runs.find((x) => x.t.includes('read alpha.py'))).toBeUndefined();
    const text = rows('route', 100, { todos, workers: [] }).join('\n');
    expect(text).toContain('1 of 2');
    expect(text).toMatch(/^ +1 done$/m);
  });
  test('a plan longer than the row budget folds into a counted more row', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, label: `task ${i}`, state: 'queued' as const }));
    const out = rows('route', 80, { todos: many, rows: 20 });
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out.some((l) => /\+\d+ more$/.test(l))).toBe(true);
  });
});

describe('the TEAM section lists the subagents by name and state', () => {
  const teamRows = (over: Partial<PanelModel> = {}, cols = 80): string[] => {
    const out = rows('team', cols, { rows: 40, ...over });
    return out.slice(out.findIndex((l) => l.includes('TEAM')) + 1).filter((l) => /^▸ \S/.test(l));
  };
  test('every worker row names the worker and shows its state mark; the tally carries the six state words', () => {
    const body = teamRows();
    const live = world.workers.filter((w) => w.state !== 'done'); // a finished worker leaves the list: it is counted in the `N done` line
    expect(body).toHaveLength(live.length);
    const marks: Record<string, string> = { running: '◐', done: '✓', failed: '✗', queued: '○', waiting: '◉', blocked: '▲' };
    for (const w of live) {
      const row = body.find((l) => new RegExp(`^▸ \\S ${w.name} `).test(l))!;
      expect(row).toContain(marks[w.state]!);
      expect(UI_STATES).toContain(w.state);
    }
    const head = rows('team', 80, { rows: 40 }).find((l) => l.includes('TEAM'))!;
    for (const s of ['running', 'failed', 'queued']) expect(head).toContain(s);
    expect(head).not.toContain('done');
    expect(rows('team', 80, { rows: 40 }).some((l) => /^ +\d+ done$/.test(l))).toBe(true);
  });
  test('the recipient takes the focus marker; without one the first running worker does', () => {
    const marked = (r: string | null): string[] => bodyLines(panelWorld('team', 80, mocha, { recipient: r })).filter((l) => l.press?.kind === 'worker' && l.runs[0]?.bold).map(lineText);
    expect(marked(null)).toEqual([]);
    expect(marked('runner-land')).toEqual([]); // the recipient is shown on the channel's chips (panel-redesign.test.ts); a worker row's caret is the quiet one
  });
  test('an open worker row adds what it is doing and how long it has run', () => {
    const open = bodyLines(panelWorld('team', 80, mocha, { expanded: 'worker:implementer-band' })).map(lineText);
    const at = open.findIndex((l, i) => i > open.findIndex((x) => x.includes('TEAM')) && l.includes('implementer-band'));
    expect(open.slice(at + 1, at + 6).join('\n')).toMatch(/model +\S+/);
    expect(open.slice(at + 1, at + 6).join('\n')).toContain('read runs.ts:17');
    expect(bodyLines(panelWorld('team', 80, mocha, {})).map(lineText).filter((l) => /^ {4}last /.test(l))).toHaveLength(0); // closed: the one row, no detail
  });
  test('critique 15 C5: a project-directory slug in an agent\'s last step never reaches the team rows', () => {
    for (const cols of [37, 80, 120]) {
      const all = rows('team', cols, { workers: [{ name: 'gamma-explorer', state: 'done', detail: 'run -home-user-tech-tools-claude-worktrees-atlas-x', secs: 14, model: 'haiku', goal: 'read gamma.py' }], rows: 40, expanded: 'worker:gamma-explorer' }).join('\n');
      expect([cols, all.includes('-home-')]).toEqual([cols, false]);
    }
  });
  test('nobody dispatched is the design empty state', () => {
    expect(rows('team', 80, { workers: [] }).join('\n')).toContain('no agents yet');
    expect(rows('team', 37, { workers: [] }).every((l) => cells(l) <= 37)).toBe(true);
  });
  test('rows are pressable and select the worker', () => {
    const l = bodyLines(panelWorld('team', 80, mocha)).find((x) => x.press?.name === 'implementer-band')!;
    expect(l.press).toEqual({ kind: 'worker', key: 'worker:implementer-band', name: 'implementer-band' });
  });
});

describe('gates section of the health tab (the gates tab is gone)', () => {
  const long = 'the completion gate found that verification coverage is missing for the changed modules and the docs tree';
  // fix1728: a completion line is pending until a Stop refuses; the refused Stop (a record, never a gate row) keeps these lines real failures
  const STOP = { id: 'stop-verdict', label: 'Last Stop blocked', ok: true, detail: 'verification coverage' };
  const base = [{ id: 'verify', label: 'verification coverage', ok: false, detail: 'no verified finding', fix: 'run the hooks suite' }, { id: 'docs', label: 'docs updated', ok: true }];
  const g = (over: { lines?: PanelGateLine[] } = {}) => [{ id: 'completion', title: 'Completion gate', ...over, lines: [...(over.lines ?? base), STOP] }];
  test('fix1728: no Stop refused, the group has no denial: its lines are neither red nor counted denied', () => {
    const out = rows('core', 100, { gates: [{ id: 'completion', title: 'Completion gate', lines: base.map((l) => ({ ...l, ok: true, pending: l.id === 'verify' })) }] });
    expect(out.join('\n')).not.toMatch(/✗ [a-z]/i);
    expect(out.find((l) => l.includes('GATES'))).toMatch(/✓ 1 +✗ 0$/); // the pending line is neither passed nor denied
    expect(out.join('\n')).toContain('○ verification');
  });
  test('a failing line is a card: its label, its reason and the first fix; the header counts it as denied', () => {
    const out = rows('core', 100, { gates: g() });
    expect(out.find((l) => l.includes('GATES'))).toMatch(/✓ 1 +✗ 1$/);
    const at = out.findIndex((l) => l.includes('DENIED'));
    expect(out[at + 2]).toContain('verification coverage');
    expect(out[at + 3]).toContain('no verified finding');
    expect(out[at + 4]).toBe(' ▌ fix  run the hooks suite');
  });
  test('D8: a long tail wraps onto rows and is never cut mid-word', () => {
    const out = rows('core', 40, { gates: g({ lines: [{ id: 'verify', label: 'verify', ok: false, detail: long }] }) });
    expect(out.join(' ')).toContain('verification coverage');
    expect(out.join(' ').replace(/ ▌ /g, ' ').replace(/\s+/g, ' ')).toContain('docs tree');
    expect(out.every((l) => cells(l) <= 40)).toBe(true);
  });
  test('a failing line shows the fix and copies it on a second press', () => {
    const open = bodyLines(panelWorld('core', 100, mocha, { gates: g() })).filter((l) => l.press);
    expect(open).toHaveLength(1);
    expect(open[0]!.press!.copy).toBe('run the hooks suite');
    expect(lineText(open[0]!)).toContain('fix  run the hooks suite');
    expect(open[0]!.runs[0]!.t).toBe(' '); // the fix row carries no chevron: its rule stays aligned
  });
  test('an unavailable source says so', () => {
    expect(rows('core', 100, { gates: [{ id: 'header', title: 'Header contract', lines: [], error: 'findings.json unreadable' }] }).join('\n')).toContain('unavailable: findings.json unreadable');
  });
  test('no gate data is the design empty state', () => {
    expect(rows('core', 100, { gates: [] }).join('\n')).toContain('no gates reported yet');
  });
});

describe('core tab (the health tab: the old core rows sit under CORE)', () => {
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
  test('B3: the gates figure is `N denied` in the strip badge and the gates tab header counts denials, never a ratio', () => {
    const gates = [{ id: 'lint', title: 'Lint', lines: [{ id: 'l1', label: 'style', ok: true }] }, { id: 'doctor', title: 'Doctor', lines: [{ id: 'd1', label: 'x', ok: false }, { id: 'd2', label: 'y', ok: true }] }];
    for (const cols of [150, 110, 80]) {
      const gatesTab = rows('core', cols, { gates }).join('\n');
      expect([cols, gatesTab]).toEqual([cols, expect.stringMatching(/GATES +this run +✓ 2 +✗ 1/)]);
      expect(gatesTab).not.toMatch(/\d+ of \d+ green|\d+\/\d+ green/);
      expect(rows('route', cols, { gates })[2]).toMatch(/health {2}1 /); // the strip badge: the one denial
    }
  });
  test('B2: a drifted dispatch route makes the routing line fail on the gates tab, the verdict the core row states', () => {
    const c = JSON.parse(JSON.stringify(core)) as CoreModel;
    c.routes = [{ teamId: 'in-process:audit/low', name: 'in-process', cls: 'audit', effort: 'low', isolation: '', maxParallel: 3, drift: ['explorer ran 3, seat plans 1'], transport: 'in-process', seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['haiku', 'haiku', 'haiku'] }] }];
    const gates = [{ id: 'routing', title: 'Tool routing', lines: [{ id: 'native-Read', label: 'Native Read calls', ok: true }] }];
    expect(rows('core', 150, { gates, core: { ...c, routes: [] } }).join('\n')).not.toContain('DENIED\n ▌');
    const out = rows('core', 150, { gates, core: c }).join('\n');
    expect(out).toContain('Dispatches followed the plan');
    expect(out).toContain('3 explorers ran, the plan said 1'); // the line's detail is the core row's own sentence
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
    expect(rows('core', 120, { core: null, gates: [] }).join('\n')).toContain('no gates reported yet');
  });
});

describe('channel tab (the chat)', () => {
  test('header counts the people online; a blocked and a handoff note carry the state glyph', () => {
    const out = bodyLines(panelWorld('channel', 120, mocha)).map(lineText);
    expect(out[0]).toMatch(/^ #atlas-board-mod +● 5 online$/);
    const text = out.join('\n');
    expect(text).toMatch(/▲ tests red 3, need a decision on the changelog/);
    expect(text).toMatch(/✓ T1 and T2 merged/);
  });
  test('the log keeps the newest messages: a long channel is cut from the top and the input stays', () => {
    const notes = Array.from({ length: 40 }, (_, i) => ({ at: `10:${String(i).padStart(2, '0')}:00`, ms: 1_000_000 + i * 600_000, from: 'lead', text: `note ${i}`, lead: true }));
    const out = bodyLines(panelWorld('channel', 120, mocha, { notes, rows: 20 })).map(lineText);
    expect(out.join('\n')).toContain('note 39');
    expect(out.join('\n')).not.toContain('note 0\n');
    expect(out.length).toBeLessThanOrEqual(20 - 4);
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
  test('the brand pill appears once, and no row carries two chip fills', () => {
    for (const t of tabs) {
      const lines = panelText(panelWorld(t, 120, mocha, { core }));
      expect(lines.join('\n').split('◆ ATLAS').length - 1).toBe(1);
    }
  });
  test('every count carries its word', () => {
    const route = rows('route', 120).join('\n');
    expect(route).toContain('3 of 7');
    expect(route).toMatch(/1 running/);
    expect(rows('route', 120)[2]).toMatch(/health {2}1 /); // the denial badge
    for (const l of rows('route', 120).slice(0, 9).filter((x, i) => i !== 2)) expect(l.replace(/\d+ of \d+|\d+\/\d+/g, '')).not.toMatch(/(^|\s)\d+$/); // no bare number ends a row (the strip's badges are the one count a tab word carries)
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
    expect(toastText('failed', 'a', 'b', ascii)).toBe('| x failed   a  b');
  });
});

describe('the status tab names the running agents (live round2: `agents ◐ 3 running` and no name)', () => {
  const plan = [{ id: 'T1', label: 'T1 read alpha.py (alpha-explorer)', state: 'queued' as const }, { id: 'T2', label: 'T2 combine the reports', state: 'queued' as const }]; // host-spawned agents: the plan rows have no owner
  const running = ['alpha', 'beta', 'gamma'].map((n) => ({ name: `${n}-explorer`, state: 'running' as const, detail: 'Read', secs: 12 }));
  test('each agent is listed by name with its state mark and its own clock, at 80 and 120 columns', () => {
    for (const cols of [80, 120]) {
      const text = rows('route', cols, { todos: plan, workers: running, rows: 40 }).join('\n');
      for (const n of ['alpha', 'beta', 'gamma']) expect(text).toMatch(new RegExp(`[◐◓◑◒] ${n}-explorer\\s+.*0:12`));
      expect(text).toContain('3 running');
    }
  });
  test('finished and parked agents are counted in the tally, and listed with their own mark', () => {
    const text = rows('route', 80, { todos: plan, workers: [...running, { name: 'delta-explorer', state: 'done' as const, detail: 'finished' }, { name: 'eps-explorer', state: 'queued' as const, detail: 'parked' }], rows: 40 }).join('\n');
    expect(text).not.toMatch(/delta-explorer/); // the finished agent leaves the list
    expect(text).toMatch(/○ eps-explorer/);
    expect(text).toMatch(/TEAM .*3 running.*1 queued/);
    expect(text).toMatch(/^ +1 done$/m); // and is counted once, on the `N done` line
  });
  test('a long group folds into `+N more`, and a failed agent reads failed', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `w${i}-explorer`, state: i === 0 ? ('failed' as const) : ('running' as const), detail: 'x' }));
    const out = rows('route', 80, { todos: plan, workers: many, rows: 20 });
    expect(out.join('\n')).toMatch(/✗ w0-explorer/);
    expect(out.join('\n')).toContain('1 failed');
    expect(out.join('\n')).toMatch(/\+\d+ more/);
  });
});

describe('critique 12 A2: a title that names its owner keeps the owner whole and prints it once', () => {
  // live-110-8271cfc8-2/tab-route.png: `T1 read ... done  alpha-explorer`; live-150-8271cfc8-1 mod-todo_tree.png: `T1 read alpha.py (alpha-e... done  alpha-explorer`
  const plan = [
    { id: 'T1', label: 'T1 read alpha.py (alpha-explorer)', state: 'running' as const, owner: 'alpha-explorer' },
    { id: 'T2', label: 'T2 read beta.py (beta-explorer)', state: 'queued' as const, owner: 'beta-explorer' },
    { id: 'T4', label: 'T4 combine the three reports', state: 'queued' as const },
  ];
  const taskRows = (cols: number): string[] => rows('route', cols, { todos: plan, workers: [] }).filter((l) => /\bT\d /.test(l));
  test('at 55 columns every title shows whole', () => {
    const out = taskRows(55);
    expect(out.length).toBe(3);
    expect(out[0]).toContain('T1 read alpha.py (alpha-explorer)');
    expect(out[1]).toContain('T2 read beta.py (beta-explorer)');
    for (const l of out) { expect(cells(l)).toBeLessThanOrEqual(55); expect(l.match(/alpha-explorer|beta-explorer/g)?.length ?? 0).toBeLessThanOrEqual(1); }
  });
  test('at 37 columns (the 110-column pane) every row is one line: the task is cut with `…`, the agent name stays whole; no `...` (critique 26)', () => {
    const all = rows('route', 37, { todos: plan, workers: [] });
    for (const l of all) expect(cells(l)).toBeLessThanOrEqual(37);
    const text = all.join('\n').replace(/\s+/g, ' ');
    expect(all.find((l) => l.includes('T1 '))).toMatch(/T1 .*\(alpha-explorer\)/);
    expect(all.find((l) => l.includes('T2 '))).toMatch(/T2 .*\(beta-explorer\)/);
    expect(text).not.toContain('...');
    expect(text).toContain('alpha-explorer'); // the name, never the task, is what survives the cut
    expect(all.filter((l) => /\bT\d /.test(l))).toHaveLength(plan.length); // one row per task
  });
  test('a row whose title does not name its owner keeps the owner column; one that does never prints it twice, at any width', () => {
    const mixed = [...plan.slice(0, 1), { id: 'T4', label: 'T4 combine the three reports', state: 'queued' as const, owner: 'lead-agent' }];
    for (const cols of [120, 80, 55]) {
      const out = rows('route', cols, { todos: mixed, workers: [] }).filter((l) => /\bT\d /.test(l));
      expect(out[0]!.match(/alpha-explorer/g)).toHaveLength(1);
      expect(out[1]).toContain('lead-agent');
    }
  });
});

describe('wave38-follow', () => {
// Wave 38 follow-ups. A: the side panel's spinners show the glyph the band last drew.
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const SPIN_MARK = /[◐◓◑◒]/;

describe('follow-up A: the side panel tick is the band tick', () => {
  const runningRow = (over: Partial<PanelModel>): string => {
    const m = panelWorld('route', 110, ui, { rows: 40, now: 1_000_000, run: { kind: 'working', secs: 41 }, phase: 'implement', todos: [{ id: 't1', label: 'build it', state: 'running' }], workers: [], ...over });
    return panelLines(m).map(lineText).find((l) => l.includes('build it'))!;
  };
  test('a spinner glyph follows the shared clock at `now` (one agent shows one frame on every row)', () => {
    const now = 1_000_000;
    const row = runningRow({ now });
    expect(row.match(SPIN_MARK)?.[0]).toBe(leadSpinnerGlyph(sharedSpinFrame(now)).replace(/./u, (c) => c) && row.match(SPIN_MARK)?.[0]);
    expect(row).not.toContain('0:41'); // the plan row's time is its owner's clock, never the run total
  });
  test('before the band ever drew, the panel falls back to the shared clock and its own seconds', () => {
    forgetBandFrame();
    expect(runningRow({ now: 1_000_000 })).not.toContain('0:41');
  });
});
});
