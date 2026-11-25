// Truths of the old side panel tests that the redesigned panel (tabs health / status / gates / channel) still shows, each asserted against the new rendering.
// The table of every removed test, with its class and where it is re-expressed: .atlas/evidence/2026-11-20_mod-redesign/removed-tests.md
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../../../contracts/panel-world';
import { cells, type Ui } from '../../design/atlas-ui';
import type { Health } from '../../data/idle-health';
import { ctxLevel, latencyLevel } from '../band/band-frame';
import { bodyLines, lineText, panelLines, panelText, tabRule, type PanelModel, type PanelTab } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const live = (tab: PanelTab, cols = 62, over: Partial<PanelModel> = {}, ui: Ui = mocha): PanelModel =>
  panelWorld(tab, cols, ui, { rows: 40, run: { kind: 'working', secs: 5, startMs: 0, frame: 0 }, ...over });
const body = (m: PanelModel): string[] => bodyLines(m).map((l) => lineText(l).trimEnd());
const phaseHead = (m: PanelModel): string => body(m).find((l) => l.startsWith(' PHASE')) ?? '';
const stopRefused = { id: 'stop-verdict', label: 'Last Stop blocked', ok: true, detail: 'Team gate' };
const teamGateOpen = { id: 'g', label: 'Team gate', ok: false, fix: 'run spawn-team' };
const refusedGates = [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'a', label: 'Evidence captured', ok: true }, teamGateOpen, stopRefused] }, { id: 'routing', title: 'Tool routing', lines: [{ id: 'denied', label: 'Policy denies', ok: true }] }] as never;
const failingNotRefused = [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'a', label: 'Evidence captured', ok: true }, teamGateOpen] }] as never;

describe('the run word at the head of PHASE', () => {
  test('a refused Stop reads `blocked` whatever the run last said, and the blocked stepper lights no `done`', () => {
    for (const kind of ['working', 'done', 'idle'] as const) {
      const m = live('route', 62, { gates: refusedGates, run: { kind, secs: 46, startMs: 0, frame: 0 } });
      expect(phaseHead(m)).toMatch(/▲ blocked$/);
      expect(phaseHead(m)).not.toMatch(/done/);
    }
  });
  test('a failing check with Stop allowed leaves the run as it was: working stays working, done stays done', () => {
    expect(phaseHead(live('route', 62, { gates: failingNotRefused }))).toMatch(/working$/);
    expect(phaseHead(live('route', 62, { gates: failingNotRefused, run: { kind: 'done', secs: 46, startMs: 0, frame: 0 } }))).toMatch(/✓ done$/);
  });
  test('the head is the word alone: no `n/m` beside it and no clock (the band owns the run clock)', () => {
    for (const kind of ['working', 'done', 'blocked'] as const) {
      expect(phaseHead(live('route', 62, { run: { kind, secs: 46, startMs: 0, frame: 0 } }))).toMatch(/^ PHASE +[◐✓▲] \w+$/);
    }
  });
  test('a run that carries its frame turns that frame on the phase head, whatever the render tick is', () => {
    const glyph = (frame: number, tick: number): string => phaseHead(live('route', 62, { tick, run: { kind: 'working', secs: 5, startMs: 0, frame } })).trim().split(/\s+/).at(-2)!;
    expect(glyph(0, 7)).toBe(glyph(0, 3));
    expect(new Set([0, 1, 2, 3].map((f) => glyph(f, 0))).size).toBeGreaterThan(1);
  });
});

describe('the stepper tells which phases the run entered', () => {
  const dots = (m: PanelModel): string => body(m).find((l) => /[●◉○▲–]─/.test(l) || /^ [●◉○▲–] /.test(l))!.replace(/[─ ]+/g, '');
  const entered = (list: string[], over: Partial<PanelModel>) => live('route', 62, { entered: list, ...over });
  test('a finished run greens only the phases it entered', () => {
    expect(dots(entered(['plan', 'research'], { run: { kind: 'done', secs: 30, startMs: 0, frame: 0 } }))).toBe('●●○○');
    expect(dots(entered(['plan', 'research', 'build', 'verify'], { run: { kind: 'done', secs: 30, startMs: 0, frame: 0 } }))).toBe('●●●●');
  });
  test('a blocked run keeps the phases it entered green and lights the blocked one with `▲`', () => {
    expect(dots(entered(['plan', 'research'], { run: { kind: 'blocked', secs: 30, startMs: 0, frame: 0 } }))).toBe('●▲○○');
  });
  test('a working run lights its current phase and a phase it skipped stays empty', () => {
    expect(dots(entered(['plan', 'build'], { phase: 'build' }))).toBe('●–◉○');
  });
});

describe('gate marks and the header figure say one thing', () => {
  const grid = (m: PanelModel): string => body(m).slice(0, 12).join('\n');
  test('the header counts the passed and the denied gates, and the grid marks add up to it', () => {
    const m = live('gates', 62, { gates: refusedGates });
    const text = grid(m);
    expect(text).toMatch(/GATES +this run +✓ 2 +✗ 1/);
    expect(text.match(/✓ [A-Z]/g)).toHaveLength(2);
    expect(text.match(/✗ [A-Z]/g)).toHaveLength(1);
  });
  test('a line only Stop decides is pending: drawn `○`, never counted as a pass, so figure and marks agree', () => {
    const pending = [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'a', label: 'Evidence captured', ok: true }, { id: 'i', label: 'Todos drained', ok: true, pending: true }] }] as never;
    const text = grid(live('gates', 62, { gates: pending }));
    expect(text).toContain('○ Todos drained');
    expect(text).toMatch(/✓ 1 +✗ 0/);
    expect(text.match(/✓ [A-Z]/g)).toHaveLength(1);
  });
  test('a failing gate is listed under DENIED with its fix', () => {
    const rows = body(live('gates', 62, { gates: refusedGates }));
    expect(rows.slice(rows.indexOf(' DENIED')).join('\n')).toMatch(/Team gate[\s\S]*fix +run spawn-team/);
  });
  test('the strip and the gates header never print the gates as a ratio', () => {
    const all = panelText(live('gates', 62, { gates: refusedGates })).join('\n') + panelText(live('route', 62, { gates: refusedGates })).join('\n');
    expect(all).not.toMatch(/\bgates?\b[^\n]*\d+\/\d+/);
  });
});

describe('workers and their states', () => {
  const team = (workers: PanelModel['workers']): string[] => body(live('route', 62, { workers, todos: [] })).filter((l) => /^▸ [◐○✓✗▲] \S+ +\S+/.test(l));
  const w = (name: string, state: 'running' | 'done' | 'failed' | 'queued', over = {}) => ({ name, role: 'implementer', state, detail: 'step', secs: 13, ...over }) as never;
  test('a failed worker is `failed` once, in the error tone, and nothing says `killed`', () => {
    const m = live('route', 62, { workers: [w('a-impl', 'done'), w('b-impl', 'failed', { detail: 'tests red 3' })] });
    const tally = bodyLines(m).find((l) => lineText(l).includes(' TEAM'))!;
    expect(lineText(tally)).toMatch(/✓ 1 done +✗ 1 failed/);
    expect(tally.runs.find((x) => x.t.includes('failed'))?.tone).toBe('bad');
    const row = bodyLines(m).find((l) => lineText(l).includes('b-impl'))!;
    expect(lineText(row)).toMatch(/✗ b-impl/);
    expect(row.runs.find((x) => x.t.includes('✗'))?.tone).toBe('bad');
    for (const tab of ['route', 'core', 'gates', 'channel'] as PanelTab[]) expect(panelText(live(tab, 62, { workers: [w('b-impl', 'failed')] })).join('\n')).not.toMatch(/killed|worker killed/i);
  });
  test('a plan row that failed says why on the line under it, once', () => {
    const rows = body(live('route', 62, { todos: [{ id: 'T1', label: 'Changelog', state: 'failed', owner: 'b-impl', detail: 'tests red 3' }] as never, workers: [] }));
    const at = rows.findIndex((l) => /✗ Changelog/.test(l));
    expect(rows[at + 1]).toMatch(/^ +failed · tests red 3$/);
    expect(rows.join('\n').match(/tests red 3/g)).toHaveLength(1);
  });
  test('the tally names a state only when a worker is in it', () => {
    const tally = (ws: PanelModel['workers']): string => lineText(bodyLines(live('route', 62, { workers: ws })).find((l) => lineText(l).includes(' TEAM'))!).trim();
    expect(tally([w('a', 'done'), w('b', 'done')])).toBe('TEAM  ✓ 2 done');
    expect(tally([w('a', 'running'), w('b', 'queued')])).toBe('TEAM  ◐ 1 running  ○ 1 queued');
  });
  test('a parked worker keeps its row as queued, with a dash for its time', () => {
    const rows = team([w('parked-impl', 'queued', { secs: undefined, detail: 'waits on a' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^▸ ○ parked-impl +implementer +waits on a +-$/);
  });
  test('one row per worker however tall the pane is', () => {
    const ws = [w('a', 'running'), w('b', 'done'), w('c', 'failed')];
    for (const rows of [24, 40, 80]) expect(body(live('route', 62, { workers: ws, todos: [], rows })).filter((l) => /^▸ [◐✓✗] [abc] /.test(l))).toHaveLength(3);
  });
});

describe('clocks are frozen by the data, never the render clock', () => {
  test('a finished worker prints its own seconds at any render time', () => {
    const ws = [{ name: 'a-impl', role: 'implementer', state: 'done', detail: 'finished', secs: 13 }] as never;
    const at = (now: number) => body(live('route', 62, { workers: ws, now })).filter((l) => l.includes('a-impl') && l.startsWith('▸'));
    expect(at(1_000)[0]).toMatch(/0:13$/);
    expect(at(9_000_000)).toEqual(at(1_000));
  });
  test('the plan time column is the one the model carries, in every state', () => {
    for (const kind of ['working', 'done', 'blocked'] as const) {
      const rows = body(live('route', 62, { run: { kind, secs: 46, startMs: 0, frame: 0 } })).filter((l) => /^▸ [✓◐✗] /.test(l) && l.includes('implementer-'));
      expect(rows.length).toBeGreaterThan(0);
      for (const l of rows) expect(l).toMatch(/0:42$/);
    }
  });
});

describe('the plan keeps the Board order and the owner whole', () => {
  test('rows come in the order the Board lists them, done rows included (no done-last reshuffle)', () => {
    const todos = [{ id: 'T1', label: 'Zeta', state: 'running' }, { id: 'T2', label: 'Alpha', state: 'done' }, { id: 'T3', label: 'Mid', state: 'queued' }] as never;
    const rows = body(live('route', 62, { todos, workers: [] })).filter((l) => /^▸ [✓◐○] (Zeta|Alpha|Mid)/.test(l));
    expect(rows.map((l) => l.match(/Zeta|Alpha|Mid/)![0])).toEqual(['Zeta', 'Alpha', 'Mid']);
  });
  test('a long title is cut with one `…` and never `...`; the owner is whole where it is shown and never cut, and the time keeps its column', () => {
    const owner = 'implementer-layout';
    const todos = [{ id: 'T1', label: 'A very long title that cannot possibly fit the narrow pane', state: 'done', owner }] as never;
    let shown = 0;
    for (let cols = 40; cols <= 110; cols += 5) {
      const row = body(live('route', cols, { todos, workers: [] })).find((l) => l.includes('A very'))!;
      if (!row.includes('narrow pane')) expect(row).toContain('…'); // cut only when it does not fit
      expect(row).not.toContain('...');
      expect(row).toMatch(/ -$/);
      expect(cells(row)).toBeLessThanOrEqual(cols);
      if (/implementer/.test(row)) { expect(row).toContain(owner); shown++; }
    }
    expect(shown).toBeGreaterThan(0);
  });
});

describe('every tab at every width', () => {
  test('no row is wider than the pane and a cut is the one-cell `…`, never `...`', () => {
    for (const tab of ['route', 'core', 'gates', 'channel'] as PanelTab[]) {
      for (const cols of [30, 37, 45, 62, 80, 110, 150]) {
        for (const l of panelText(live(tab, cols, { health: HEALTH }))) {
          expect([tab, cols, l, cells(l) <= cols]).toEqual([tab, cols, l, true]);
          expect([tab, cols, l.includes('...')]).toEqual([tab, cols, false]);
        }
      }
    }
  });
  test('the pane is exactly its rows tall, on every tab, in every run state', () => {
    for (const tab of ['route', 'core', 'gates', 'channel'] as PanelTab[]) {
      for (const rows of [24, 30, 40, 60]) {
        for (const kind of ['working', 'idle', 'done', 'blocked'] as const) {
          const n = panelLines(live(tab, 62, { rows, run: { kind, secs: 5, startMs: 0, frame: 0 }, health: HEALTH })).length;
          expect([tab, rows, kind, n <= rows]).toEqual([tab, rows, kind, true]);
        }
      }
    }
  });
});

describe('colour', () => {
  test('the divider rule under the strip is one colour in every run state; only the lit tab segment is the accent', () => {
    const seen = new Set<string>();
    for (const kind of ['working', 'idle', 'done', 'blocked'] as const) {
      for (const tab of ['route', 'core', 'gates', 'channel'] as PanelTab[]) {
        for (const x of tabRule(live(tab, 62, { run: { kind, secs: 5, startMs: 0, frame: 0 }, health: HEALTH })).runs.filter((y) => /─/.test(y.t))) seen.add(`${x.tone}/${x.fg ?? ''}`);
      }
    }
    expect([...seen]).toEqual(['dim/']);
  });
  test('context and hook latency use the band ramp: amber from 70% and over 100 ms, red from 90% and over 500 ms', () => {
    const toneOf = (h: Partial<Health>, key: string): string | undefined => {
      const line = bodyLines(live('core', 110, { health: { ...HEALTH, ...h } })).find((l) => lineText(l).includes(key))!;
      return line.runs.find((x) => /^\d+(%|ms)$/.test(x.t.trim()))?.tone ?? line.runs.find((x) => /\d+%/.test(x.t))?.tone;
    };
    expect(ctxLevel(69)).toBe('ok');
    expect(ctxLevel(70)).toBe('warn');
    expect(ctxLevel(90)).toBe('bad');
    expect(latencyLevel(100)).toBe('ok');
    expect(latencyLevel(101)).toBe('warn');
    expect(latencyLevel(501)).toBe('bad');
    const bar = (pct: number) => bodyLines(live('core', 110, { health: { ...HEALTH, ctxPct: pct } })).find((l) => lineText(l).trimStart().startsWith('context'))!.runs.find((x) => /^━+$/.test(x.t))!.tone;
    expect([bar(50), bar(75), bar(95)]).toEqual(['ok', 'warn', 'bad']);
    const hook = (ms: number) => toneOf({ hooks: { ...HEALTH.hooks!, latency: { n: 60, p50: ms, p95: ms } } }, 'hook p50');
    expect([hook(50), hook(300), hook(900)]).toEqual(['ok', 'warn', 'bad']);
  });
  test('a degraded session says so: a hot context or a slow hook, in amber', () => {
    expect(body(live('core', 62, { health: { ...HEALTH, ctxPct: 75 } })).find((l) => l.includes('SESSION'))).toMatch(/degraded$/);
    expect(body(live('core', 62, { health: { ...HEALTH, hooks: { ...HEALTH.hooks!, latency: { n: 60, p50: 300, p95: 400 } } } })).find((l) => l.includes('SESSION'))).toMatch(/degraded$/);
  });
});

describe('the channel', () => {
  const T = 1_700_000_000_000;
  const notes = [{ at: '08:41:00', ms: T, from: 'lead', text: 'go', lead: true }];
  const chips = (over: Partial<PanelModel>) => {
    const m = live('channel', 62, { notes, people: 2, channel: 'x', workers: [{ name: 'a-impl', role: 'implementer', state: 'running', detail: 'step', secs: 3 }] as never, ...over });
    return bodyLines(m).at(-1)!.runs.filter((x) => x.press).map((x) => [x.press, x.bg === 'accent'] as const);
  };
  test('exactly one chip is filled: the recipient on the roster, the lead when none is picked', () => {
    const lit = (over: Partial<PanelModel>) => chips(over).filter(([, on]) => on).map(([p]) => p);
    expect(lit({ recipient: 'a-impl' })).toEqual(['to:a-impl']);
    expect(lit({ recipient: 'lead' })).toEqual(['to:lead']);
    expect(lit({ recipient: null })).toEqual(['to:lead']);
  });
  test('a recipient that is not on the roster is named by its own chip, never swapped for another worker', () => {
    expect(chips({ recipient: 'ghost' }).filter(([, on]) => on).map(([p]) => p)).toEqual(['to:ghost']);
  });
  test('a note to a peer shows ↳ to <peer>; a note to everyone shows no recipient', () => {
    const m = live('channel', 62, { notes: [{ at: '08:41:00', ms: T, from: 'lead', to: 'a-impl', text: 'one', lead: true }, { at: '08:42:00', ms: T + 60_000, from: 'a-impl', text: 'two' }] as never, people: 2, channel: 'x' });
    const rows = body(m).join('\n');
    expect(rows).toContain('↳ to a-impl');
    expect(rows.match(/↳ to/g)).toHaveLength(1);
  });
});

describe('row geometry and glyph vocabulary, on every tab', () => {
  const TABS = ['route', 'core', 'gates', 'channel'] as PanelTab[];
  test('a plan or team row puts the state glyph in the third cell and the name in the fifth', () => {
    const rows = body(live('route', 62)).filter((l) => /^▸ [✓◐○✗▲] /.test(l));
    expect(rows.length).toBeGreaterThan(8);
    for (const l of rows) { expect([...l][0]).toBe('▸'); expect(/[✓◐○✗▲]/.test([...l][2]!)).toBe(true); expect([...l][3]).toBe(' '); expect([...l][4]).not.toBe(' '); }
  });
  test('every body row starts in the one-cell gutter (a space, or the `▸` marker of a pressable row)', () => {
    for (const tab of TABS) for (const cols of [37, 62, 110]) for (const l of body(live(tab, cols, { health: HEALTH })).filter(Boolean)) expect([tab, cols, l, /^[ ▸▌]/.test(l)]).toEqual([tab, cols, l, true]);
  });
  test('no braille spinner, no `▹`, no `░` gauge track and no strikethrough anywhere; the plan bar is `▰▱`', () => {
    for (const tab of TABS) for (const cols of [80, 110, 150]) {
      const m = live(tab, cols, { health: HEALTH });
      const all = panelText(m).join('\n');
      expect([tab, cols, all.match(/[\u2800-\u28ff▹░]/)?.[0] ?? '']).toEqual([tab, cols, '']);
      expect(panelLines(m).flatMap((l) => l.runs).some((x) => x.strike)).toBe(false);
    }
    expect(body(live('route', 62)).join('\n')).toMatch(/PLAN +\d+ of \d+ +[▰▱]+/);
  });
  test('the phase mark wears the accent while working, and the stepper dots wear ok / accent / dim', () => {
    const lines = bodyLines(live('route', 62, { entered: ['plan'], phase: 'research' }));
    const head = lines.find((l) => lineText(l).startsWith(' PHASE'))!;
    expect(head.runs.find((x) => /[◐◓◑◒]/.test(x.t))?.tone).toBe('accent');
    const dots = lines.find((l) => /^ [●◉○]/.test(lineText(l)))!;
    expect(dots.runs.find((x) => x.t === '●')?.tone).toBe('ok');
    expect(dots.runs.find((x) => x.t === '◉')?.tone).toBe('accent');
    expect(dots.runs.find((x) => x.t === '○')?.tone).toBe('dim');
  });
  test('the stepper holds all six contract phases whole', () => {
    const six = ['research', 'theory', 'test', 'validate', 'implement', 'verify'];
    const text = body(live('route', 62, { phases: six, phase: 'test' })).slice(0, 9).join('\n');
    for (const p of six) expect(text).toContain(p);
  });
  test('a run at rest with every plan row done does not leave the stepper lit on its first phase', () => {
    const todos = [{ id: 'T1', label: 'a', state: 'done' }] as never;
    const m = live('route', 62, { run: { kind: 'idle' }, todos, workers: [], phase: 'research' });
    expect(body(m).slice(0, 9).join('\n')).not.toContain('◉');
  });
});

describe('the gates tab under stress', () => {
  const errored = [{ id: 'routing', title: 'Tool routing', error: 'route drifted', lines: [] }] as never;
  test('a gate group that errors is a failing check, never a green one', () => {
    const text = body(live('gates', 62, { gates: errored })).join('\n');
    expect(text).toMatch(/GATES +this run +✓ 0 +✗ 1/);
    expect(text).toMatch(/✗ Tool routing/);
    expect(text).toContain('route drifted');
  });
  test('a long reason wraps on its words and never past the pane; the whole fix is what a press copies', () => {
    const fix = 'run the fix command with a long enough tail to wrap onto a second row of the pane';
    const gates = [{ id: 'c', title: 'C', lines: [{ id: 'x', label: 'Long gate', ok: false, detail: 'a very long reason that goes on and on and on and on until it wraps around the pane edge more than once', fix }] }] as never;
    const m = live('gates', 50, { gates });
    const rows = body(m).filter((l) => l.startsWith(' ▌'));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const l of rows) expect(cells(l)).toBeLessThanOrEqual(50);
    expect(rows.join(' ')).toContain('on and on');
    expect(bodyLines(m).find((l) => l.press?.kind === 'toggle' && l.press.copy)?.press?.copy).toBe(fix);
  });
  test('the strip count of the gates tab is the denied figure of its header', () => {
    for (const gates of [refusedGates, errored, [] as never]) {
      const m = live('gates', 62, { gates });
      const header = body(m).find((l) => l.startsWith(' GATES'));
      const denied = header ? Number(/✗ (\d+)/.exec(header)?.[1] ?? 0) : 0;
      const strip = lineText(panelLines(m).find((l) => /health +status +gates/.test(lineText(l)))!);
      const shown = Number(/gates +(\d+)/.exec(strip)?.[1] ?? 0);
      expect([denied, shown]).toEqual([denied, denied]);
    }
  });
});

describe('the status tab, the rest of what it still says', () => {
  test('a plan that is taller than the pane says how many rows it hides, and a tall pane shows them all', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `T${i}`, label: `item ${i}`, state: 'queued' })) as never;
    const short = body(live('route', 62, { rows: 24, todos: many, workers: [] })).join('\n');
    expect(short).toMatch(/\+\d+ more/);
    const tall = body(live('route', 62, { rows: 80, todos: many, workers: [] })).join('\n');
    expect(tall).not.toMatch(/\+\d+ more/);
    expect(tall.match(/item \d+/g)).toHaveLength(30);
  });
  test('no workers reads `no agents yet`; the team tally counts exactly the rows listed', () => {
    expect(body(live('route', 62, { workers: [] })).join('\n')).toMatch(/TEAM +no agents yet/);
    const m = live('route', 62);
    const tally = lineText(bodyLines(m).find((l) => lineText(l).includes(' TEAM'))!);
    const counted = [...tally.matchAll(/[◐○✓✗▲] (\d+)/g)].reduce((n, x) => n + Number(x[1]), 0);
    expect(counted).toBe(m.workers.length);
  });
  test('the hook p95 reads a dash until 5 samples back it, and its p50 is always the figure', () => {
    const few = body(live('core', 110, { health: { ...HEALTH, hooks: { ...HEALTH.hooks!, latency: { n: 3, p50: 12, p95: 40 } } } })).find((l) => l.includes('hook p50'))!;
    expect(few).toMatch(/12ms +p95 +—/);
    const many = body(live('core', 110, { health: HEALTH })).find((l) => l.includes('hook p50'))!;
    expect(many).toMatch(/2ms +p95 +9ms/);
  });
  test('a blocked note is marked `▲` in the error colour, handoff and done `✓` in the ok green', () => {
    const notes = [{ at: '10:00:00', ms: 1, from: 'a', kind: 'blocked', text: 'b' }, { at: '10:01:00', ms: 2, from: 'b', kind: 'handoff', text: 'h' }, { at: '10:02:00', ms: 3, from: 'c', kind: 'done', text: 'd' }] as never;
    const marks = bodyLines(live('channel', 62, { notes })).flatMap((l) => l.runs).filter((x) => /^[▲✓] $/.test(x.t));
    expect(marks.map((x) => [x.t.trim(), x.tone])).toEqual([['▲', 'block'], ['✓', 'ok'], ['✓', 'ok']]);
  });
});

const HEALTH: Health = {
  gates: { total: 4, green: 3, checks: [{ id: 'completion', ok: true }, { id: 'tripwire', ok: true }], denied: 0 }, version: '17.32.0', branch: 'main', upSecs: 57_420, ctxPct: 27, tokens: 339_000, window: 1_000_000,
  last: { secs: 492, done: 5, total: 7, agents: 2, failed: 0 },
  hooks: { total: 60, byLabel: [], recent: [{ label: 'tool.call', ageSecs: 3, ms: 2 }, { label: 'tool.call', ageSecs: 9, ms: 9 }], latency: { n: 60, p50: 2, p95: 9 } },
  pulse: { events: [0, 1, 2, 3, 5, 4, 3, 2, 1, 0, 2, 3, 4, 5, 6, 3, 2, 1, 0, 2], ctx: [], runs: [{ secs: 483, ok: true, at: 1 }, { secs: 2320, ok: false, at: 2 }, { secs: 182, ok: true, at: 3 }] },
} as never;
