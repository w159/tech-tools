// Critique 6, slice B: one blocker and one identity everywhere. Each test was written to fail on 17.7.0 before the change.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { panelWorld } from '../contracts/panel-world';
import { cells, type Ui } from './atlas-ui';
import { clipWords, lastText } from './data/lasttext';
import { EMPTY_ORCH, onSpawn } from './data/orchestration';
import { blockReasons, gateTally } from './data/runstate';
import { agentRows, type AgentRow } from './hud-surface';
import { agentName } from './hud';
import { coreReport } from './core-row';
import { coreModel } from './data/core';
import { bodyLines, lineText, panelText, type PanelModel } from './panel-layout';
import { bandLines, missionLines, runsText, type MissionModel } from './mission-layout';
import type { GateGroup } from './pane/sidebar-types';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const PHASES = ['plan', 'research', 'build', 'verify', 'ship'] as const;
const mission = (over: Partial<MissionModel> = {}): MissionModel => ({
  cols: 120, maxRows: 12, tick: 0, project: 'p', phases: PHASES, phase: 'done', done: 5, total: 5, workers: [], checks: null, ui, ...over,
});
const body = (m: PanelModel): string[] => bodyLines(m).map(lineText).map((l) => l.trimEnd());
const worker = (name: string, over: Record<string, unknown> = {}) => ({ name, role: 'explorer', state: 'done' as const, detail: 'finished', model: 'haiku', task: 'T1', secs: 20, tools: 3, ...over });

// ---- B1: one blocker, one name ---------------------------------------------------------------------------------------

describe('B1: the blocker has one name on the band, the gates tab and the tally', () => {
  const teamGate: GateGroup[] = [
    { id: 'completion', title: 'Completion gate', lines: [{ id: 'a', label: 'Evidence captured', ok: true }, { id: 'g', label: 'Team gate', ok: false, fix: 'run atlas_mux.py spawn-team' }] },
    { id: 'routing', title: 'Tool routing', lines: [{ id: 'denied', label: 'Policy denies', ok: true }] },
  ];
  test('the failing check is named by its failing line, not its group', () => {
    const t = gateTally(teamGate);
    expect(t.names).toEqual(['team gate']);
    expect(blockReasons(false, t.names).long).toBe('team gate');
  });
  test('a failing line whose label is long falls back to the group id', () => {
    const t = gateTally([{ id: 'tripwire', title: 'Dispatch tripwire', lines: [{ id: 'inline', label: 'Inline ops since last dispatch', ok: false }] }]);
    expect(t.names).toEqual(['tripwire']);
  });
  test('the band header reads the team gate and the gates tab lists a Team gate row', () => {
    const t = gateTally(teamGate);
    const head = runsText(bandLines(mission({ checks: t.checks }))[0]!.runs);
    expect(head).toContain('▲ team gate warning'); // a failing check alone, Stop not refused
    expect(head).not.toContain('blocked');
    expect(runsText(bandLines(mission({ checks: t.checks, stopGates: t.names }))[0]!.runs)).toContain('blocked · team gate'); // the Stop gate refused
    const rows = body(panelWorld('gates', 120, ui, { rows: 40, gates: teamGate as never })).join('\n');
    expect(rows).toContain('Team gate');
  });
  test('the checks row counts n/m, the figure the gates tab header prints, from one snapshot', () => {
    const t = gateTally(teamGate);
    const row = missionLines(mission({ checks: t.checks })).map((l) => runsText(l.runs)).find((l) => l.includes('checks'))!;
    const tab = body(panelWorld('gates', 120, ui, { rows: 40, gates: teamGate as never })).join('\n');
    expect(row).toContain('1/2');
    expect(tab).toContain('1/2');
    expect(row).not.toMatch(/\d of \d green/);
    const pass = missionLines(mission({ checks: [{ id: 'a', ok: true }, { id: 'b', ok: true }, { id: 'c', ok: true }] })).map((l) => runsText(l.runs)).find((l) => l.includes('checks'))!;
    expect(pass).toContain('3/3 green');
    expect(pass).not.toContain('all 3 pass');
  });
});

describe('B1: the gates tab never says a thing twice or parts a label from its value', () => {
  const groups = [
    { id: 'tripwire', title: 'Dispatch tripwire', lines: [{ id: 'armed', label: 'Orchestration armed', ok: true, detail: 'armed' }, { id: 'inline', label: 'Inline ops since last dispatch', ok: false, detail: '4 of 4' }] },
    { id: 'routing', title: 'Tool routing', lines: [{ id: 'lean', label: 'lean-ctx calls', ok: true, detail: '0 as of the last ingest' }, { id: 'denied', label: 'Policy denies', ok: true, detail: '0 as of the last ingest' }] },
  ];
  for (const rows of [24, 40]) {
    for (const cols of [80, 110, 150]) {
      test(`${cols} cols, ${rows} rows`, () => {
        const text = body(panelWorld('gates', cols, ui, { rows, gates: groups as never }));
        expect(text.filter((l) => l.includes('Inline ops since last dispatch')).length).toBeLessThanOrEqual(1);
        // a group row never carries the first line's detail: `0 as of the last ingest` belongs to its own row, shown open
        expect(text.filter((l) => /^\s*\S? ?Tool routing/.test(l)).join('')).not.toContain('as of the last ingest');
        expect(text.filter((l) => /^\s*\S? ?Dispatch tripwire/.test(l)).join('')).not.toMatch(/\barmed\b/);
      });
    }
  }
  test('a closed failing group still says why, once', () => {
    const text = body(panelWorld('gates', 110, ui, { rows: 24, gates: groups as never })).join('\n');
    expect(text.match(/Inline ops since last dispatch/g)?.length).toBe(1);
  });
  test('the group figure is the bare n/m', () => {
    const text = body(panelWorld('gates', 150, ui, { rows: 24, gates: groups as never })).join('\n');
    expect(text).toMatch(/warning .*1\/2\n/);
    expect(text).not.toMatch(/\d+ of \d+ failing/);
  });
});

describe('B1: the contract and core report use the same n of m unit', () => {
  const m = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 0 });
  test('/atlas-core reads 3 of 4, never 3/4', () => {
    const t = coreReport(m);
    expect(t).toContain('3 of 4 replies opened with the ATLAS header');
    expect(t).not.toMatch(/\d+\/\d+ replies/);
  });
});

// ---- B2: no false calm -----------------------------------------------------------------------------------------------

describe('B2: no calm word beside a block', () => {
  const lastRun = { workers: 3, secs: 70, failed: 0 };
  test('last run is not `all ok` while the lead declared the band blocked', () => {
    const t = missionLines(mission({ blocked: true, phase: 'blocked', lastRun })).map((l) => runsText(l.runs)).join('\n');
    expect(t).not.toContain('all ok');
  });
  const lead = worker('lead', { role: 'lead', state: 'done', detail: 'done' });
  test('the lead does not read done on the team tab when the Stop gate refused the stop', () => {
    const gates = [{ id: 'completion', title: 'Completion gate', lines: [{ id: 's', label: 'Team gate', ok: false }, { id: 'stop-verdict', label: 'Last Stop blocked', ok: true, detail: 'Team gate' }] }];
    const rows = body(panelWorld('team', 120, ui, { rows: 24, lead, workers: [worker('alpha-explorer')], gates: gates as never }));
    const row = rows.find((l) => /\blead\b/.test(l) && !l.includes('running'))!;
    expect(row).not.toMatch(/\bdone\b/);
    expect(row).toMatch(/blocked/);
    expect(row).toContain('team gate');
    expect(rows.join('\n')).not.toContain('Last Stop'); // the verdict is a record, not a gate row
  });
  test('a failing check with Stop allowed leaves the lead done (the band says warning)', () => {
    for (const stop of [[], [{ id: 'stop-verdict', label: 'Last Stop allowed', ok: true }]]) {
      const gates = [{ id: 'completion', title: 'Completion gate', lines: [{ id: 's', label: 'Team gate', ok: false }, ...stop] }];
      const rows = body(panelWorld('team', 120, ui, { rows: 24, lead, workers: [worker('alpha-explorer')], gates: gates as never }));
      const row = rows.find((l) => /\blead\b/.test(l) && !l.includes('running'))!;
      expect(row).toMatch(/\bdone\b/);
      expect(row).not.toMatch(/blocked/);
    }
  });
  test('the lead reads done when nothing is blocked', () => {
    const rows = body(panelWorld('team', 120, ui, { rows: 24, lead, workers: [worker('alpha-explorer')], gates: [] }));
    expect(rows.find((l) => /\blead\b/.test(l) && !l.includes('running'))!).toMatch(/\bdone\b/);
  });
  test('the reading line never says nothing returned once workers have returned', () => {
    const core = coreModel({ ...coreFixture, matrix: coreMatrix, logs: {}, todos: [], header: { ok: 1, total: 1 }, openGates: 0 });
    const done = body(panelWorld('core', 120, ui, { rows: 40, core, workers: [worker('alpha-explorer'), worker('beta-explorer')] })).join('\n');
    expect(done).not.toContain('returned nothing yet');
    expect(done).toMatch(/2 workers finished/);
    const none = body(panelWorld('core', 120, ui, { rows: 40, core, workers: [] })).join('\n');
    expect(none).toContain('returned nothing yet');
  });
});

// ---- B3: one canonical name ------------------------------------------------------------------------------------------

describe('B3: the requested name wins', () => {
  test('the spawn records the description prefix as the name when the call gave none', () => {
    const o = onSpawn(EMPTY_ORCH, 'a7dc862718b43d3d9', 'explorer-board: list open Atlas todo items', 1, { type: 'atlas:explorer' });
    expect(o.meta['a7dc862718b43d3d9']?.name).toBe('explorer-board');
  });
  test('the Agent call name wins over the description prefix', () => {
    const o = onSpawn(EMPTY_ORCH, 'a1', 'explorer-board: list open Atlas todo items', 1, { type: 'atlas:explorer', name: 'board-reader' });
    expect(o.meta['a1']?.name).toBe('board-reader');
  });
  test('prose with a colon is not a name', () => {
    expect(onSpawn(EMPTY_ORCH, 'a1', 'Map it: all of it', 1).meta['a1']?.name).toBeUndefined();
  });
  test('a derived `type-slug` name gives way to the description prefix on every surface', () => {
    expect(agentName('explorer-list-open-atlas', 'explorer', 'explorer-board: list open Atlas todo items')).toBe('explorer-board');
    expect(agentName('explorer-list-open-atlas', 'explorer', 'list open Atlas todo items')).toBe('explorer-list-open-atlas');
    expect(agentName('alpha-explorer', 'explorer', 'beta-explorer: read beta.py')).toBe('alpha-explorer'); // a real name stays
  });
});

// ---- B4: the LAST text -----------------------------------------------------------------------------------------------

describe('B4: lastText and clipWords', () => {
  test('list markers, backticks and absolute paths are stripped', () => {
    expect(lastText('1. `atlas_todo.py list` -> first 3 lines')).toBe('atlas_todo.py list -> first 3 lines');
    expect(lastText('Read /mnt/attach/project-files/atlas-ui-redesign/round2/alpha.py')).toBe('Read alpha.py');
    expect(lastText('- 2) done: see /a/b/c.ts:12 and /x/y/z.md')).toBe('done: see c.ts:12 and z.md');
    expect(lastText('a 1. b')).toBe('a 1. b');
  });
  test('B4: a doubled leading verb reads once, keeping the first spelling', () => {
    expect(lastText('read Read gamma.py')).toBe('read gamma.py');
    expect(lastText('Read read /a/b/gamma.py')).toBe('Read gamma.py');
    expect(lastText('read gamma.py')).toBe('read gamma.py');
    expect(lastText('read reader.py')).toBe('read reader.py');
  });
  test('B4: clipWords cuts before an unclosed bracket and off a dangling connector', () => {
    expect(clipWords('lines 1-7 (7 lines, def beta_sum(a, b))', 22)).toBe('lines 1-7...');
    expect(clipWords('bash Post result line to the lead now', 28)).toBe('bash Post result line...');
    expect(clipWords('Read beta.py -> lines 1-7: def beta', 20)).toBe('Read beta.py...');
    expect(cells(clipWords('lines 1-7 (7 lines, def beta_sum(a, b))', 22))).toBeLessThanOrEqual(22);
  });
  test('clipWords never cuts mid-word', () => {
    expect(clipWords('read the whole board now', 15)).toBe('read...'); // the cut falls off the dangling `the`
    expect(clipWords('read whole board now', 17)).toBe('read whole...');
    expect(clipWords('read the whole board now', 40)).toBe('read the whole board now');
    expect(clipWords('sidebar-paint.tsx', 8)).toBe('');
    expect(cells(clipWords('read the whole board now', 15))).toBeLessThanOrEqual(15);
  });
  const row = (over: Partial<AgentRow> = {}): AgentRow => ({ name: 'beta-explorer', state: 'done', model: 'haiku', tasks: [], tool: '1. ToolSearch select:mcp__lean-ctx__ctx_read,mcp__lean-ctx__ctx_search', ctx: null, focus: false, task: 'read beta.py', ...over });
  const text = (cols: number, rows: AgentRow[]): string[] => agentRows(rows, { cols, ui }, { spacers: true, extras: true }).map((r) => r.map((x) => x.t).join(''));
  test('the LAST column shows sanitized text and ends on a whole word', () => {
    for (const cols of [90, 100, 110, 150]) {
      const line = text(cols, [row()]).find((l) => l.includes('beta-explorer'))!;
      expect(line).not.toMatch(/\b1\. /);
      expect(line).not.toContain('`');
      expect(line.trimEnd()).toMatch(/(ctx_search|ToolSearch\.\.\.|returned)$/); // the whole text, or (critique 18) a finished agent's `returned` where it does not fit
    }
  });
  test('LAST then MODEL drop before a TASK id is cut or a name is cut (critique 19 B2: TASK is the plan id, 7 cells at every width)', () => {
    for (const cols of [80, 90, 100, 110, 120, 150]) {
      const lines = text(cols, [row({ name: 'explorer-board', tasks: [1] })]);
      const l = lines.find((x) => x.includes('explorer-board'))!;
      expect(l).toContain('explorer-board');
      if (/haiku/.test(l)) expect(l).toContain('T1'); // the model only stays when the task id fits beside it
      expect(l).not.toContain('list every');
    }
  });
});
