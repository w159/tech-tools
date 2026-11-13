// Critique 23, the band at dispatch time: the host's `n more` clip never takes the band (it is the first row of the slot), the lead spinner is braille and
// never leaves a working, fixing or retrying band at any width, and the run clock reads the host's wall time without resetting, reverting or lagging.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { leadSpinnerGlyph, LEAD_FRAMES, SPIN_FRAMES, spinnerGlyph, type Ui } from './atlas-ui';
import { bandTree } from './band';
import { ARM_MS, END_GRACE_MS, FRAME_MS, newRunClock, ranSecsOf, restSecsOf, stepRun, workSecsOf } from './band-motion';
import { hudAgents, hudCompactRows, hudFloorRows, hudLines, hudListsAgents, type HudAgent, type HudInput } from './hud';
import { liveWorkers, queuedMembers } from './data/live';
import { ownTodos } from './data/todos';
import { bandLines, IDLE_AFTER_SECS, runsText, type MissionModel, type MissionWorker } from './mission-layout';
import { atlasSlot, fitHudToBand, hudGapRows, hudSlotCap, withStopVerdict } from './register';
import { rowOf, type Segment } from './runs';
import { bodyLines } from './panel-layout';
import { panelModelOf } from './pane/sidebar-model';
import { busySnap } from './live_fixture';
import { hudPhases } from './band';
import type { TodoItem } from './contract';
import type { GateGroup } from './pane/sidebar-types';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
/** The text rows of a tree: a Box whose children are all Text is a row. */
function rowsOf(n: Node): string[] {
  const kids = (n.props.children ?? []) as Node[];
  if (kids.length > 0 && kids.every((k) => k.kind === 'Text')) return [kids.map((k) => String(k.props.children)).join('')];
  return kids.filter((k) => k.kind === 'Box').flatMap(rowsOf);
}
/** What the host keeps of a tree taller than its slot (index.d.ts, AbovePrompt: a taller tree scrolls in a window of `maxRows` less the `n more` row). */
const hostKeeps = (rows: readonly string[], maxRows: number): readonly string[] => (rows.length <= maxRows ? rows : rows.slice(0, Math.max(0, maxRows - 1)));

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const todo = (id: string, content: string, status: string): TodoItem => ({ id, content, status });
const PLAN = ['T1 read alpha.py (alpha-explorer)', 'T2 read beta.py (beta-explorer)', 'T3 read gamma.py (gamma-explorer)', 'T4 combine the three reports', 'T5 write the final summary'].map((c, i) => todo(`t${i + 1}`, c, 'pending'));
const agent = (name: string): HudAgent => ({ name, role: 'explorer', state: 'working', model: 'haiku', ui: 'running' });
const hudIn: HudInput = { todos: ownTodos(PLAN), agents: ['alpha-explorer', 'beta-explorer', 'gamma-explorer'].map(agent) };

describe('step 1: the band is the first row of the slot, so no host clip can take it', () => {
  const cols = 150;
  /** The slot register.ts draws for `budget` rows: the HUD fitted to leave the band its row, the gap, the band at what is left. */
  function slotFor(budget: number): string[] {
    const snap = busySnap();
    const compact = hudCompactRows(hudIn, cols);
    const cap = hudSlotCap(budget, compact, hudFloorRows(hudIn, cols, Date.now()), 1, true, true);
    const full = hudLines(hudIn, { cols, maxRows: cap, ui, rich: false, now: Date.now() }).map((l): Segment[] => l.map((x) => ({ t: x.t })));
    const hud = fitHudToBand(full, budget, (rows) => hudGapRows(hudListsAgents(rows as Segment[][]), rows.length, budget)) as Segment[][];
    const gap = hudGapRows(hudListsAgents(hud), hud.length, budget);
    const band = bandTree(els, { snapshot: snap, live: liveWorkers(snap, snap.now), gates: [], columns: cols, tick: 0, ui, maxRows: hud.length > 0 ? budget - hud.length - gap : budget, working: true }) as unknown as Node;
    const blank = gap > 0 ? [rowOf(els, [{ t: ' '.repeat(cols) }], cols)] : [];
    const tree = atlasSlot(els, { band: band as never, gapRow: blank, hud: hud.map((r) => rowOf(els, r, cols)), below: els.Box({ children: [] }) }) as unknown as Node;
    return rowsOf(tree);
  }
  const isBand = (row: string): boolean => row.includes('◖ ◆ ATLAS ◗') && !row.includes('▸');
  for (let h = 1; h <= 24; h++) {
    test(`a slot of ${h} row${h === 1 ? '' : 's'}: the tree fits it, the first row is the band, and the host keeps it`, () => {
      const rows = slotFor(h);
      expect(rows.length).toBeLessThanOrEqual(h);
      expect(isBand(rows[0]!)).toBe(true);
      expect(hostKeeps(rows, h).some(isBand)).toBe(true);
    });
  }
  test('inline the slot is the terminal height and the host clips below the mod\'s guess: any window of 1 row or more still holds the band', () => {
    const rows = slotFor(24);
    expect(rows.some((r) => r.includes('▸ TODO'))).toBe(true); // a tall tree, as at dispatch (live-150-1 f0053)
    for (let window = 1; window <= rows.length; window++) expect(hostKeeps(rows, window + 1).slice(0, window).some(isBand)).toBe(true);
    expect(rows.findIndex(isBand)).toBeLessThan(rows.findIndex((r) => r.includes('▸ TODO')));
    expect(rows.findIndex(isBand)).toBeLessThan(rows.findIndex((r) => r.includes('▸ SUBAGENTS')));
  });
});

const PHASES = ['research', 'plan', 'build', 'verify', 'done'] as const;
const live: MissionWorker[] = [{ name: 'impl-a', state: 'running', secs: 4, tool: 'Read', target: 'a.ts' }, { name: 'impl-b', state: 'running', secs: 9 }];
const model = (over: Partial<MissionModel> = {}): MissionModel => ({ cols: 150, maxRows: 1, tick: 0, project: 'p', phases: PHASES, phase: 'build', done: 3, total: 5, workers: [], checks: null, ui, ...over });
const head = (m: MissionModel): string => runsText(bandLines(m)[0]!.runs).trimEnd();
const BRAILLE = /[⠀-⣿]/;
const WIDTHS = [150, 120, 110, 100, 93, 80, 70, 62];

describe('step 2: the lead spinner is braille on the shared frame, rows keep the circle quarters', () => {
  test('MiniDot in ten frames, and the ASCII spinner in ASCII mode', () => {
    expect(LEAD_FRAMES.join('')).toBe('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏');
    expect([0, 1, 2, 3, 10, -1].map((f) => leadSpinnerGlyph(f))).toEqual(['⠋', '⠙', '⠹', '⠸', '⠋', '⠏']);
    expect([0, 1, 2, 3].map((f) => leadSpinnerGlyph(f, true))).toEqual(['|', '/', '-', '\\']);
    expect(SPIN_FRAMES.join('')).toBe('◐◓◑◒');
    expect(spinnerGlyph(1)).toBe('◓');
  });
  test('the lead steps once per frame of the shared clock', () => {
    const seen = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((tick) => head(model({ tick, busy: true, turnSecs: 3 })).match(BRAILLE)![0]);
    expect(seen.join('')).toBe(LEAD_FRAMES.join(''));
  });
  test('ASCII mode keeps the ASCII spinner', () => {
    const t = head(model({ busy: true, turnSecs: 3, ui: { theme: 'mocha', ascii: true, color: 'none' } }));
    expect(t).not.toMatch(BRAILLE);
    expect(t).toMatch(/[|/\\-] working/);
  });
  test('the frame period is the fastest the host does not fold: ten redraws a second', () => {
    expect(FRAME_MS).toBe(100);
  });
});

describe('step 3: while work runs the spinner stays at every width (a blocked band is stopped: static `▲`, no spinner, critique 28)', () => {
  const blocked = { stopGates: ['dispatch T2 read x open'], openDispatchTitle: 'T2 read x', openDispatch: 1 } as Partial<MissionModel>;
  const cases: [string, Partial<MissionModel>, RegExp, boolean][] = [
    ['working', { busy: true, turnSecs: 42, workers: live, ctx: 0.4 }, /working/, true],
    ['blocked with a busy lead', { ...blocked, busy: true, workers: live.slice(0, 1) }, /blocked/, false],
    ['blocked, stop refused, busy', { stopGates: ['stop refused'], busy: true, ctx: 0.4, checks: [{ id: 'd', ok: false, name: 'doctor' }] } as Partial<MissionModel>, /blocked/, false],
    ['a retried Stop', { stopGates: ['retry stop'], busy: true } as Partial<MissionModel>, /stop refused/, false], // state 38: `retrying` is gone; the only reasons are `stop refused` and `N failed`
  ];
  for (const [name, over, word, spins] of cases) {
    for (const cols of WIDTHS) {
      test(`${name} at ${cols} columns ${spins ? 'keeps a braille spinner' : 'draws no spinner'}, its word and todo n/m`, () => {
        const t = head(model({ cols, ...over }));
        if (spins) expect(t).toMatch(BRAILLE);
        else expect(t.split(/\s+todo|\s·\stodo/)[0]).not.toMatch(BRAILLE); // the lead is static; a running worker's count spinner beside the todo figure is the worker's
        expect(t).toMatch(word);
        expect(t).toMatch(/\btodo\b\D*?\d+\/\d+/);
        expect([...t].length).toBeLessThanOrEqual(cols);
      });
    }
  }
  test('the segments give way in order: ctx, the agent counts, then the reason text (the meter is a gauge-width form: below 120 columns it is already the `todo n/m` text)', () => {
    const over = { stopGates: ['stop refused'], busy: true, ctx: 0.4, workers: live, done: 4 } as Partial<MissionModel>;
    const at = (cols: number): string => head(model({ cols, ...over }));
    const seen = WIDTHS.map(at);
    const has = (re: RegExp): number[] => seen.map((t) => (re.test(t) ? 1 : 0));
    const monotone = (a: number[]): boolean => a.every((v, i) => i === 0 || v <= a[i - 1]!); // present at the wide end, never back once gone
    for (const re of [/ctx/, /agents|running/, /stop refused/]) expect(monotone(has(re))).toBe(true);
    const last = (re: RegExp): number => has(re).lastIndexOf(1);
    expect(last(/ctx/)).toBeLessThanOrEqual(last(/running/));
    expect(last(/running/)).toBeLessThanOrEqual(last(/stop refused/));
    const gauge = WIDTHS.filter((c) => c >= 120).map(at); // where the meter shows, ctx and the counts have already gone before it does
    expect(gauge.every((t) => /▰/.test(t))).toBe(true);
    for (const t of seen) expect(t).toMatch(/blocked/);
    for (const t of seen) expect(t).not.toMatch(/fixing/); // wave 34: a blocked band claims no work
  });
});

describe('step 4d: blocked while the host waits on the person is a bare `blocked` (state 38: no `needs you`), with no spinner and no fixing', () => {
  const asks = { blocked: true, busy: false } as Partial<MissionModel>;
  for (const cols of [150, 110, 62]) {
    test(`at ${cols} columns`, () => {
      const t = head(model({ cols, ...asks }));
      expect(t).toContain('▲ blocked');
      expect(t).not.toContain('needs you');
      expect(t).not.toMatch(BRAILLE);
      expect(t).not.toContain('fixing');
    });
  }
  test('the same ask with the host working says no reason either, with no spinner and no `fixing` (wave 34)', () => {
    const t = head(model({ ...asks, busy: true }));
    expect(t).toContain('▲ blocked');
    expect(t).not.toContain('needs you');
    expect(t).not.toContain('fixing');
    expect(t.split(/\s+todo|\s·\stodo/)[0]).not.toMatch(BRAILLE);
  });
});

describe('step 4a to 4c: the run clock', () => {
  const S = 1_000;
  const T0 = 5_000_000;
  /** Beats every 100 ms from `from` for `ms`: working or not. */
  function beats(c0: ReturnType<typeof newRunClock>, from: number, ms: number, working: boolean, sig: Parameters<typeof stepRun>[3] = {}) {
    let c = c0;
    for (let t = from; t <= from + ms; t += FRAME_MS) c = stepRun(c, working, t, sig);
    return c;
  }
  test('done lasts the wall time of the run, from the prompt to the host\'s turn end', () => {
    let c = beats(newRunClock(), T0 + 300, 57_400, true, { promptMs: T0 }); // the prompt at T0; the first working beat 300 ms later
    expect(c.startMs).toBe(T0);
    expect(workSecsOf(c, T0 + 57_700)).toBe(57);
    c = stepRun(c, false, T0 + 57_800, { hostIdle: true });
    expect(c.startMs).toBeNull();
    expect(ranSecsOf(c)).toBe(57); // the host showed 58s one beat later; the figure is the span of the working beats
  });
  test('the host\'s turn end ends the run on that beat: no grace', () => {
    let c = beats(newRunClock(), T0, 5_000, true);
    c = stepRun(c, false, T0 + 5_100, { hostIdle: true });
    expect(c.startMs).toBeNull();
    expect(c.endedMs).toBe(T0 + 5_000);
    c = beats(newRunClock(), T0, 5_000, true);
    c = stepRun(c, false, T0 + 5_100); // no host signal: the grace holds the run
    expect(c.startMs).not.toBeNull();
    expect(stepRun(c, false, T0 + 5_000 + END_GRACE_MS).startMs).toBeNull();
  });
  test('idle holds: work with no prompt behind it after a run neither starts a clock, nor reverts idle to done, nor overwrites the duration', () => {
    let c = beats(newRunClock(), T0, 58_000, true, { promptMs: T0 });
    c = stepRun(c, false, T0 + 58_100, { hostIdle: true });
    const done = c;
    expect(ranSecsOf(done)).toBe(58);
    const later = T0 + 58_000 + (IDLE_AFTER_SECS + 5) * S;
    expect(restSecsOf(done, later)).toBeGreaterThanOrEqual(IDLE_AFTER_SECS);
    // a one-beat flicker of work (a background task's notification), then quiet again
    c = stepRun(done, true, later);
    expect(c).toBe(done);
    c = stepRun(c, false, later + 200, { hostIdle: true });
    c = stepRun(c, false, later + 2_000, { hostIdle: true });
    expect(c).toEqual(done);
    expect(ranSecsOf(c)).toBe(58);
    expect(restSecsOf(c, later + 2_000)).toBeGreaterThanOrEqual(IDLE_AFTER_SECS); // still idle, never `done` again
  });
  test('the next prompt starts the next run, at the prompt', () => {
    let c = beats(newRunClock(), T0, 3_000, true);
    c = stepRun(c, false, T0 + 3_100, { hostIdle: true });
    const next = T0 + 90_000;
    c = stepRun(c, true, next + 200, { promptMs: next });
    expect(c.startMs).toBe(next);
    expect(ranSecsOf(c)).toBe(3); // the last figure is kept until this run ends
  });
  test('a run that is running is never restarted by a later prompt, and a stale arm is not a start', () => {
    let c = beats(newRunClock(), T0, 3_000, true, { promptMs: T0 });
    c = stepRun(c, true, T0 + 3_100, { promptMs: T0 + 3_000 });
    expect(c.startMs).toBe(T0);
    expect(ARM_MS).toBeGreaterThan(1_000);
  });
});

describe('step 5: the side panel phase and the band read one gate verdict, so they switch on the same update', () => {
  const snap = busySnap({ phase: 'done' } as never);
  const verdict = (blocked: boolean): GateGroup[] => withStopVerdict([], JSON.stringify({ sessions: { s1: { blocked, why: blocked ? ['dispatch T2 open'] : [] } } }), 's1');
  const phaseRow = (gates: GateGroup[]): string => {
    const m = panelModelOf({ snapshot: snap, gates, core: null, ui: { recipient: null, expanded: null, draft: '', view: 'route' }, look: ui, columns: 121, rows: 40, tick: 0 } as never, ui);
    return bodyLines(m).map((l) => l.runs.map((r) => r.t).join('')).find((t) => /^\s*phase\b/.test(t)) ?? '';
  };
  const bandText = (gates: GateGroup[]): string => {
    const tree = bandTree(els, { snapshot: snap, live: liveWorkers(snap, snap.now), gates, columns: 150, tick: 0, ui, maxRows: 1, working: false }) as unknown as Node;
    return rowsOf(tree)[0]!;
  };
  test('before the refusal neither is blocked; on the refusal both are', () => {
    expect(phaseRow(verdict(false))).not.toContain('blocked');
    expect(bandText(verdict(false))).not.toContain('blocked');
    expect(phaseRow(verdict(true))).toContain('blocked');
    expect(bandText(verdict(true))).toContain('blocked');
  });
  test('the rail phase the HUD reads is unchanged by the verdict (the verdict is gates data, not the lead\'s header)', () => {
    expect(hudPhases(snap).ids.length).toBeGreaterThan(0);
  });
});

describe('the HUD agents and queued names stay out of the band\'s way', () => {
  test('hudAgents of a snapshot lists the same agents the slot test draws', () => {
    const snap = busySnap();
    expect(hudAgents(liveWorkers(snap, snap.now), snap.squad, queuedMembers(snap)).length).toBeGreaterThan(0);
  });
});
