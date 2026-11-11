// Mission Control band (Claude Code): the adapter over mission-layout.ts. Row contents per the spec table, state and
// sort order of workers, the 15 s linger, degrade order under a tight row budget, the single row below 80 columns,
// and keys only while idle at 80+ columns. Spec: docs/specs/2026-11-10_atlas-terminal-ui.md.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree, planRows, railPhase, shortTool } from './band';
import { PALETTES, spinnerGlyph, type Ui } from './atlas-ui';
import { computeCounts, groupTodos } from './data/todos';
import { liveWorkers } from './data/live';
import { busySnap, NOW } from './live_fixture';
import { TONE_HEX } from './mission-layout';
import { textWidth } from './theme';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const cells = (row: Node): Node[] => row.props.children as Node[];
const text = (row: Node): string => cells(row).map((t) => t.props.children).join('');
const gate = { id: 'completion' as const, title: 'Gates', lines: [{ ok: false, label: 'x' }] } as any;
const okGate = { id: 'routing' as const, title: 'Routing', lines: [{ ok: true, label: 'y' }] } as any;

/** Panel -> its row Boxes and their text. */
const panel = (columns: number, over: Record<string, unknown> = {}) => {
  const snapshot = (over.snapshot as ReturnType<typeof busySnap>) ?? busySnap();
  const live = (over.live as any) ?? liveWorkers(snapshot, NOW);
  const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
  const node = bandTree(els, { snapshot, live, gates: [], columns, tick: 3, maxRows: 12, ui, ...over } as any) as unknown as Node;
  const rowNodes = node.props.children as Node[];
  const rows = rowNodes.map(text);
  return { node, rowNodes, rows, all: rows.join('\n') };
};
const idleSnap = () => busySnap({ squad: [], activity: {}, comms: [] });
const rowOf = (rowNodes: Node[], needle: string): Node => rowNodes.find((r) => text(r).includes(needle))!;
const cellOf = (row: Node, needle: string): Node => cells(row).find((t) => String(t.props.children).includes(needle))!;

const boardTodos = [
  { id: 'a', content: 'map the auth flow', status: 'completed', owner: 'explorer-1', evidence: '1. rg auth -> 3 hits' },
  { id: 'b', content: 'edit auth middleware', status: 'in_progress', owner: 'impl-auth' },
  { id: 'c', content: 'add ttl config', status: 'pending' },
];

describe('band: the brand capsule and the facts, and nowhere else the task count', () => {
  test('reads the phase, the todo gauge and the ctx gauge and the worker counts, tick 3', () => {
    const { rows } = panel(160, { gates: [gate] });
    expect(rows[0]).toContain('◖ ◆ ATLAS ◗  implement · phase 4/5');
    expect(rows[0]).toContain('todo ██▌░░░░░░░ 1 of 4');
    expect(rows[0]).toContain('ctx █░░░░░░░ 12%');
    expect(rows[0]).toContain(`agents ${spinnerGlyph(3)} 1 running   ■ 1 failed   ◉ 1 waiting`);
    const withTodos = panel(160, { gates: [gate], snapshot: busySnap({ todos: boardTodos as any }) });
    expect(withTodos.rows).toHaveLength(panel(160, { gates: [gate] }).rows.length); // a folded board costs no row
  });
  test('counts the lead plan only: 2 of 11 with two dispatch rows present', () => {
    const plan = Array.from({ length: 11 }, (_, n) => ({ id: `p${n}`, content: `plan item ${n}`, status: n < 2 ? 'completed' : 'pending' }));
    const dispatch = [
      { id: 'd0', content: 'dispatch one', status: 'completed', origin: 'dispatch' },
      { id: 'd1', content: 'dispatch two', status: 'in_progress', origin: 'dispatch' },
    ];
    const item = (t: { id: string; content: string; status: string; origin?: string }) => ({ ...t, owner: null, evidence: null, live: true });
    const todoGroups = [{ phase: 'implement', dept: 'FORGE', glyph: '', done: 2, total: 13, items: [...plan, ...dispatch].map(item) }] as any;
    const { rows } = panel(160, { snapshot: busySnap({ todos: [...plan, ...dispatch] as any, todoGroups }) });
    expect(rows[0]).toContain('2 of 11');
    expect(rows[0]).not.toContain('13');
  });
  test('capsule: caps accent on the panel, the middle ink on accent fill; every other cell is on the panel; no cost', () => {
    const { rowNodes, all } = panel(160);
    const head = rowNodes[0]!;
    const mocha = PALETTES.mocha;
    expect(cellOf(head, '◖').props).toMatchObject({ color: mocha.accent, backgroundColor: mocha.panel });
    expect(cellOf(head, '◆ ATLAS').props).toMatchObject({ color: mocha.ink, backgroundColor: mocha.accent, bold: true });
    expect(cells(head).filter((t) => t.props.backgroundColor !== mocha.panel)).toHaveLength(1); // the capsule fill is the only fill
    expect(all).not.toMatch(/\$/);
    expect(cells(rowNodes[1]!).every((t) => t.props.backgroundColor === mocha.panel)).toBe(true);
  });
  test('the gauges fill in info over a line track; ctx has no threshold colours', () => {
    const head = panel(160, { snapshot: busySnap({ contextPct: 90 }) }).rowNodes[0]!;
    const fills = cells(head).filter((t) => /^█[█▏▎▍▌▋▊▉]*$/.test(String(t.props.children)));
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((t) => t.props.color === TONE_HEX.info)).toBe(true);
    expect(cells(head).filter((t) => /^░+$/.test(String(t.props.children))).every((t) => t.props.color === TONE_HEX.line)).toBe(true);
  });
  test('without a context figure there is no ctx gauge', () => {
    expect(panel(160, { snapshot: busySnap({ contextPct: 0 }) }).rows[0]).not.toContain('ctx');
  });
  test('latte paints the latte panel; ASCII swaps the capsule; NO_COLOR keeps words and drops every colour', () => {
    const latte = panel(160, { ui: { theme: 'latte', ascii: false, color: 'truecolor' } });
    expect(cells(latte.rowNodes[0]!).filter((t) => t.props.backgroundColor === PALETTES.latte.panel).length).toBeGreaterThan(3);
    expect(cellOf(latte.rowNodes[0]!, '◆ ATLAS').props.backgroundColor).toBe(PALETTES.latte.accent);
    const ascii = panel(160, { ui: { theme: 'mocha', ascii: true, color: 'truecolor' } });
    expect(ascii.rows[0]).toContain('[ATLAS]');
    expect(ascii.rows[0]).not.toMatch(/[◖◗◆]/);
    const plain = panel(160, { ui: { theme: 'mocha', ascii: false, color: 'none' } });
    expect(plain.rows[0]).toContain('◖ ◆ ATLAS ◗');
    expect(cells(plain.rowNodes[0]!).every((t) => t.props.color === undefined && t.props.backgroundColor === undefined)).toBe(true);
  });
  test('blocked reads `▲ blocked · needs you` and the phase rail keeps the last real phase lit', () => {
    const snapshot = idleSnap();
    snapshot.phase = 'blocked' as never;
    const { rows } = panel(160, { snapshot, live: [], lastPhase: 'implement', rich: true });
    expect(rows[0]).toContain('▸ 4 implement');
    const band = panel(160, { snapshot, live: [], lastPhase: 'implement' }).rows[0]!;
    expect(band).toContain('▲ blocked · needs you');
    expect(band).not.toContain('idle');
  });
  test('rich: capsule with the numbered phase rail, a blank row, then the gauges', () => {
    const { rows, rowNodes } = panel(160, { rich: true });
    expect(rows[0]).toContain(`◖ ◆ ATLAS ◗  ● 1 research  ──  ● 2 theory  ──  ● 3 test  ──  ▸ 4 implement  ──  ◇ 5 verify`);
    expect(rows[1]!.trim()).toBe('');
    expect(rows[2]).toMatch(/^todo ████░░░░░░░░░░░░ 1 of 4 · 25% {2,}ctx █▎░░░░░░░░ 12%/);
    expect(cellOf(rowNodes[0]!, '▸').props).toMatchObject({ color: TONE_HEX.accent, bold: true });
    expect(cellOf(rowNodes[0]!, '4 implement').props).toMatchObject({ color: TONE_HEX.text, bold: true });
    expect(cellOf(rowNodes[0]!, '◇').props.color).toBe(TONE_HEX.muted);
  });
  test('the tiers: 160 and 120 wide, 100 mid, 79 and 60 short, 40 small', () => {
    const band = (columns: number) => panel(columns).rows[0]!.trim();
    expect(band(160)).toContain('todo ██▌░░░░░░░ 1 of 4');
    expect(band(100)).toMatch(/^◖ ◆ ATLAS ◗ phase 4\/5 · todo 1\/4 · /);
    expect(band(79)).toBe(`◖ ◆ ATLAS ◗ ph 4/5 · todo 1/4 · ${spinnerGlyph(3)}1 ■1 ◉1`);
    expect(band(40)).toBe(`◖ ◆ ATLAS ◗ todo 1/4 · ${spinnerGlyph(3)}1 ■1 ◉1`);
  });
  test('idle shows the last run under the band', () => {
    const snapshot = busySnap({ comms: [] });
    snapshot.squad = snapshot.squad.map((a) => ({ ...a, state: 'finished' as const }));
    const live = liveWorkers(snapshot, NOW).map((w) => ({ ...w, state: 'done' as const, startedAt: NOW - 100_000, since: NOW - 30_000 }));
    const { rows } = panel(160, { snapshot, live });
    expect(rows[0]).not.toMatch(/running|failed/);
    expect(rows[1]).toMatch(/^ last run {2}3 workers · 1m10s · all ok +$/);
  });
  test('a failed worker turns the last run into a bold failed count', () => {
    const live = liveWorkers(busySnap(), NOW).map((w, i) => ({ ...w, state: i ? ('done' as const) : ('failed' as const), startedAt: NOW - 60_000, since: NOW - 30_000 }));
    const { rows, rowNodes } = panel(160, { live: live.map((w) => ({ ...w, state: w.state === 'failed' ? 'failed' : 'done' })), snapshot: idleSnap() });
    expect(rows[1]).toContain('1 failed');
    expect(cellOf(rowNodes[1]!, '1 failed').props).toMatchObject({ color: TONE_HEX.text, bold: true });
  });
  test('last run counts the most recent spawn burst only, not every worker of the session', () => {
    const snapshot = busySnap({ comms: [] });
    const live = liveWorkers(snapshot, NOW).map((w, i) => ({ ...w, state: 'done' as const, startedAt: i < 2 ? NOW - 300_000 : NOW - 40_000, since: NOW - 20_000 }));
    const last = panel(160, { snapshot: idleSnap(), live }).rows[1]!;
    expect(last).toContain('last run  1 worker ');
    expect(last).toContain('20s');
  });
});


describe('workers: a row each, in words', () => {
  test('failed and waiting sort first, then running', () => {
    const { rows } = panel(160);
    const at = (n: string) => rows.findIndex((r) => r.includes(n));
    expect(at('runner-1')).toBeLessThan(at('impl-auth'));
    expect(at('impl-auth')).toBeLessThan(at('explorer-1'));
  });
  test('each state has its mark, tone and word: running, waiting, failed', () => {
    const { rowNodes } = panel(160);
    const run = rowOf(rowNodes, 'explorer-1');
    expect(text(run)).toContain(`${spinnerGlyph(3)} explorer-1`);
    expect(cells(run)[1]!.props.color).toBe(TONE_HEX.run);
    expect(cellOf(run, 'Grep').props).toMatchObject({ color: TONE_HEX.text, bold: true });
    const wait = rowOf(rowNodes, 'impl-auth');
    expect(text(wait)).toContain('◉ impl-auth');
    expect(cells(wait)[1]!.props.color).toBe(TONE_HEX.info);
    expect(cellOf(wait, 'waiting').props.color).toBe(TONE_HEX.text);
    const fail = rowOf(rowNodes, 'runner-1');
    expect(text(fail)).toContain('■ runner-1');
    expect(cells(fail)[1]!.props.color).toBe(TONE_HEX.bad);
    expect(cellOf(fail, 'failed').props).toMatchObject({ color: TONE_HEX.text, bold: true });
  });
  test('only a worker with a tool in flight spins; a failed or waiting one never moves', () => {
    const at = (tick: number) => panel(160, { tick }).rows;
    for (const tick of [0, 1, 2]) {
      expect(at(tick).find((r) => r.includes('runner-1'))).toContain('■ runner-1');
      expect(at(tick).find((r) => r.includes('impl-auth'))).toContain('◉ impl-auth');
      expect(at(tick).find((r) => r.includes('explorer-1'))).toContain(`${spinnerGlyph(tick)} explorer-1`);
    }
  });
  test('running shows the short tool name and its target', () => {
    const snapshot = busySnap();
    snapshot.activity['explorer-1'] = { ...snapshot.activity['explorer-1']!, tool: 'mcp__lean-ctx__ctx_shell', target: 'sleep 5' } as never;
    expect(panel(160, { snapshot, live: liveWorkers(snapshot, NOW) }).all).toMatch(/ctx_shell {2}sleep 5/);
  });
  test('thinking: a grey spinner, the word, and the last tool dimmed, never "-"', () => {
    const snapshot = busySnap();
    snapshot.activity['explorer-1'] = { ...snapshot.activity['explorer-1']!, tool: null, lastTool: 'mcp__lean-ctx__ctx_shell', target: 'sleep 5', mood: 'thinking' };
    const { rowNodes, all } = panel(160, { snapshot, live: liveWorkers(snapshot, NOW) });
    const row = rowOf(rowNodes, 'explorer-1');
    expect(text(row)).toMatch(/thinking {3}last ctx_shell sleep 5/);
    expect(cells(row)[1]!.props.color).toBe(TONE_HEX.muted); // grey spinner
    expect(cellOf(row, 'ctx_shell').props.color).toBe(TONE_HEX.muted);
    expect(all).not.toMatch(/ -( |$)/);
  });
  test('a host-listed worker with no call yet is running (thinking), never starting: no clock decides a state word', () => {
    const snapshot = busySnap();
    snapshot.activity['explorer-1'] = { ...snapshot.activity['explorer-1']!, tool: null, lastTool: null, startedAt: NOW - 5_000 } as never;
    const row = rowOf(panel(160, { snapshot, live: liveWorkers(snapshot, NOW) }).rowNodes, 'explorer-1');
    expect(text(row)).toMatch(/explorer-1 +explorer +thinking/);
    expect(text(row)).not.toMatch(/starting|queued/);
  });
  test('a dispatched member the host does not list yet is a queued row: a hollow dot and the word', () => {
    const snapshot = busySnap({ members: [{ name: 'runner-2' }] as never });
    const { rowNodes, rows } = panel(160, { snapshot, live: liveWorkers(snapshot, NOW) });
    expect(text(rowOf(rowNodes, 'runner-2'))).toMatch(/◇ runner-2 .*queued/);
    expect(rows[0]).toContain('◇ 1 queued');
  });
  test('role column joins at 100 columns; below it the name keeps the room', () => {
    expect(panel(100).rows.find((r) => r.includes('explorer-1'))).toContain('explorer-1  explorer');
    const narrow = panel(99).rows.find((r) => r.includes('explorer-1'))!;
    expect(narrow).not.toMatch(/explorer-1 +explorer/);
    expect(narrow).toMatch(/Grep/);
  });
  test('the elapsed time ends the row', () => {
    for (const columns of [80, 100, 160, 200]) expect(panel(columns).rows.find((r) => r.includes('explorer-1'))).toMatch(/ 42s $/);
  });
  test('shortTool strips mcp server prefixes', () => {
    expect(shortTool('mcp__lean-ctx__ctx_shell')).toBe('ctx_shell');
    expect(shortTool('mcp__plugin_context-mode_context-mode__ctx_execute')).toBe('ctx_execute');
    expect(shortTool('Edit')).toBe('Edit');
  });
  test('no per-worker faces, chips or graphs', () => {
    const { rows } = panel(160);
    const all = rows.slice(1).join('\n'); // under the band, whose gauges are the only blocks
    expect(all).not.toMatch(/[◔•]_?[◔•]|[▁▂▃▄▅▆▇█▏▎▍▌▋▊▉]/);
    expect(all).not.toMatch(/\b(RUN|THINK|WAIT|FAIL)\b/);
  });
});

describe('15 s linger', () => {
  const withDone = (sinceAgoMs: number) => {
    const snapshot = busySnap();
    snapshot.squad = [...snapshot.squad, { name: 'verifier-9', persona: 'verifier', state: 'finished', source: 'task', task: '' }];
    snapshot.activity['verifier-9'] = { tool: null, since: NOW - sinceAgoMs, startedAt: NOW - sinceAgoMs - 5000, toolCount: 1, tokens: null, mood: 'done', lastLine: '' } as never;
    return panel(160, { snapshot, live: liveWorkers(snapshot, NOW) });
  };
  test('a finished worker keeps its row for 15 s, green, reading `finished`', () => {
    const { rowNodes, rows } = withDone(15_000);
    const row = rowOf(rowNodes, 'verifier-9');
    expect(text(row)).toMatch(/● verifier-9 +verifier +finished/);
    expect(cellOf(row, '●').props.color).toBe(TONE_HEX.ok);
    expect(rows.findIndex((r) => r.includes('verifier-9'))).toBeGreaterThan(rows.findIndex((r) => r.includes('explorer-1'))); // finished sorts last
  });
  test('and is gone after that', () => {
    expect(withDone(15_001).all).not.toContain('verifier-9');
  });
  test('a finished worker never lingers once the whole wave is done (idle shows the last run instead)', () => {
    const snapshot = busySnap({ comms: [] });
    snapshot.squad = snapshot.squad.map((a) => ({ ...a, state: 'finished' as const }));
    const live = liveWorkers(snapshot, NOW).map((w) => ({ ...w, state: 'done' as const, since: NOW - 5000 }));
    const { all, rows } = panel(160, { snapshot, live });
    expect(all).not.toContain('finished');
    expect(rows[1]).toContain('last run');
  });
});

describe('message and footer', () => {
  test('one message row: `from to to   text   hh:mm`, the lead named like omp', () => {
    const { rows } = panel(200, { leadName: 'lead-01a189' });
    const row = rows.find((r) => r.includes('need a decision'))!;
    expect(row).toMatch(/^ impl-auth to lead-01a189 {3}need a decision on the token ttl +\d\d:\d\d $/);
    expect(rows.filter((r) => r.includes('need a decision'))).toHaveLength(1);
  });
  test('without a lead name the collapsed `lead` stays', () => {
    expect(panel(160).all).toContain('impl-auth to lead   need a decision');
  });
  test('checks name each group with a mark and a word; failures take the text tone', () => {
    const { rows, rowNodes } = panel(160, { gates: [gate, okGate] });
    const foot = rows.at(-1)!;
    expect(foot).toContain('checks  ■ completion  ● routing');
    const row = rowNodes.at(-1)!;
    expect(cellOf(row, '■').props.color).toBe(TONE_HEX.bad);
    expect(cellOf(row, ' completion').props.color).toBe(TONE_HEX.text);
    expect(cellOf(row, '●').props.color).toBe(TONE_HEX.ok);
    expect(cellOf(row, ' routing').props.color).toBe(TONE_HEX.sub);
  });
  test('gate results appear once: the header carries no count, the footer is the only place', () => {
    const { rows } = panel(160, { gates: [gate] });
    expect(rows[0]).not.toMatch(/gates|■ completion/);
    expect(rows.filter((r) => r.includes('completion'))).toHaveLength(1);
  });
  test('the header check group never draws or counts as a check', () => {
    const header = { id: 'header' as const, title: 'Header', lines: [{ ok: false, label: 'h' }] } as any;
    const { all } = panel(200, { gates: [gate, header] });
    expect(all).not.toContain('header');
  });
  test('when tight the footer keeps only failures, then a bare mark', () => {
    const groups = ['completion', 'tripwire', 'routing', 'verdict'].map((id, i) => ({ id, title: id, lines: [{ ok: i !== 1, label: id }] })) as any;
    const foot = (columns: number) => panel(columns, { gates: groups, snapshot: idleSnap(), live: [] }).rows.at(-1)!.trim();
    expect(foot(100)).toBe('checks  ● completion  ■ tripwire  ● routing  ● verdict');
    expect(foot(80)).toBe('checks  ● completion  ■ tripwire  ● routing  ● verdict');
    const none = (columns: number) => panel(columns, { gates: groups, snapshot: idleSnap(), live: [], core: undefined }).rows.at(-1)!.trim();
    expect(none(80)).toContain('■ tripwire');
  });
  test('no checks reported yet: no footer row', () => {
    expect(panel(160, { gates: [] }).rows.some((r) => r.includes('checks'))).toBe(false);
  });
});

describe('the board slot', () => {
  test('expanded lists every item right under the band (header, then one row each); folded costs nothing', () => {
    const { rows } = panel(160, { snapshot: busySnap({ todos: boardTodos as any }), todoExpanded: true, maxRows: 14 });
    expect(rows[1]!.trim()).toMatch(/^ITEM +STATE +OWNER +DETAIL$/);
    expect(rows.slice(2, 5).map((r) => r.trim().replace(/^▸ /, '').slice(0, 1))).toEqual(['●', '▲', '◇']); // the in-progress item's owner waits, so the item reads blocked (data/live.ts: board state from the owner)
    expect(rows.slice(2, 5).map((r) => r.includes('done') || r.includes('blocked') || r.includes('queued'))).toEqual([true, true, true]);
  });
  test('a tight budget shrinks the board before it takes the footer or the attention workers', () => {
    const snapshot = busySnap({ todos: boardTodos as any });
    const roomy = panel(160, { gates: [gate], snapshot, todoExpanded: true, maxRows: 12 }).rows;
    const { rows } = panel(160, { gates: [gate], snapshot, todoExpanded: true, maxRows: 8 });
    expect(rows.length).toBeLessThanOrEqual(8);
    expect(rows.some((r) => r.includes('runner-1'))).toBe(true);
    expect(rows.at(-1)).toContain('checks');
    const boardRows = (rs: string[]) => rs.filter((r) => /^[ ▸] [●◐◓◑◒◇■▲] .* (done|running|queued|failed|blocked) /.test(r) && !/(runner|implementer|explorer) {2,}/.test(r)).length;
    expect(boardRows(roomy)).toBe(3);
    expect(boardRows(rows)).toBeLessThanOrEqual(boardRows(roomy)); // the board's header and three items fit in the 8 rows beside the attention worker and the footer
  });
  test('board text drops the [phase] / [label] prefix', () => {
    const todos = [{ id: 'x', content: '[research] Trace gate path', status: 'in_progress' }, { id: 'y', content: '[label] Other', status: 'pending' }];
    const open = panel(200, { snapshot: busySnap({ todos: todos as any }), todoExpanded: true, maxRows: 14 }).all;
    expect(open).toContain('Trace gate path');
    expect(open).not.toMatch(/\[(research|label)\]/);
  });
  test('the running board item carries the spinner frame of the tick and its owner, as in omp', () => {
    const snapshot = busySnap({ todos: [{ id: 'b', content: '[research] edit auth middleware', status: 'in_progress', owner: 'explorer-1' }] as any });
    const row = (tick: number) => panel(200, { snapshot, tick, todoExpanded: true }).rows[2]!;
    expect(row(0)).toMatch(/^▸ ◐ edit auth middleware +running +explorer-1/);
    expect(row(1)).toMatch(/^▸ ◓ edit auth middleware/);
    expect(row(4)).toBe(row(0));
  });
});

describe('degrade order and the row budget', () => {
  const rowsAt = (maxRows: number) => panel(160, { gates: [gate], maxRows }).rows;
  test('blank rows go first: the one above the message, then the one under the band', () => {
    const blanks = (n: number) => rowsAt(n).filter((r) => !r.trim()).length;
    expect(blanks(12)).toBe(2);
    expect(blanks(8)).toBe(2);
    expect(blanks(7)).toBe(1);
    expect(blanks(6)).toBe(0);
    const full = rowsAt(8);
    expect(full[1]!.trim()).toBe('');
    const note = full.findIndex((r) => r.includes('need a decision'));
    expect(full[note - 1]!.trim()).toBe('');
    expect(rowsAt(7)[1]!.trim()).toBe(''); // the first blank, under the band, outlasts the second
  });
  test('then the message goes, then the footer, then workers past a `+N more` row', () => {
    const has = (n: number, s: string) => rowsAt(n).some((r) => r.includes(s));
    expect(has(6, 'need a decision')).toBe(true);
    expect(has(5, 'need a decision')).toBe(true);
    expect(has(5, '+2 more')).toBe(true);
    expect(has(4, 'need a decision')).toBe(false);
    expect(has(4, 'checks')).toBe(true);
    expect(has(3, 'checks')).toBe(true);
    expect(has(2, 'checks')).toBe(false);
    expect(rowsAt(3)).toHaveLength(3);
    expect(rowsAt(4).find((r) => r.includes('+2 more'))).toContain('+2 more · 1 waiting');
  });
  test('workers that need attention are the ones kept', () => {
    expect(rowsAt(4).some((r) => r.includes('runner-1'))).toBe(true);
    expect(rowsAt(4).some((r) => r.includes('explorer-1'))).toBe(false);
  });
  test('the total never exceeds maxRows', () => {
    for (const maxRows of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]) expect(rowsAt(maxRows).length).toBeLessThanOrEqual(maxRows);
  });
  test('planRows: workers past the budget fold into `+N more`, the message gives way first', () => {
    expect(planRows(3, 3, true)).toMatchObject({ lanes: 1, ticker: false, footer: false });
    expect(planRows(4, 3, true)).toMatchObject({ ticker: false, footer: true });
    expect(planRows(6, 5, true)).toMatchObject({ lanes: 1, ticker: true, footer: true, more: true });
    expect(planRows(12, 3, true)).toMatchObject({ lanes: 3, ticker: true, footer: true, more: false });
  });
  test('maxRows under 3 falls back to the one summary row; 0 or below draws nothing', () => {
    expect(panel(160, { maxRows: 2 }).rows).toHaveLength(1);
    expect(panel(160, { maxRows: 1 }).rows).toHaveLength(1);
    for (const maxRows of [0, -1]) {
      expect(panel(160, { maxRows }).rows).toHaveLength(0);
      expect(panel(160, { maxRows, snapshot: idleSnap(), live: [] }).rows).toHaveLength(0);
    }
    expect(panel(160, { maxRows: 1, snapshot: idleSnap(), live: [] }).rows).toHaveLength(1);
  });
  test('every row fills exactly the columns at 60..200', () => {
    for (const columns of [200, 160, 158, 120, 119, 100, 80, 79, 60]) {
      for (const row of panel(columns, { gates: [gate] }).rows) expect([columns, textWidth(row)]).toEqual([columns, columns]);
    }
  });
});

describe('below 80 columns: only the band, one row', () => {
  test('`◖ ◆ ATLAS ◗ ph 4/5 · todo 1/4 · ◒1 ■1` fills the columns', () => {
    const { rows } = panel(79, { gates: [gate] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trim()).toBe(`◖ ◆ ATLAS ◗ ph 4/5 · todo 1/4 · ${spinnerGlyph(3)}1 ■1 ◉1`);
    expect(textWidth(rows[0]!)).toBe(79);
  });
  test('idle keeps the capsule and the todo count; 80 columns is the full layout', () => {
    expect(panel(70, { snapshot: idleSnap(), live: [] }).rows[0]).toContain('◖ ◆ ATLAS ◗');
    expect(panel(70, { snapshot: idleSnap(), live: [] }).rows[0]).not.toContain('failed');
    expect(panel(80).rows.length).toBeGreaterThan(1);
    expect(panel(79).rows).toHaveLength(1);
  });
  test('a blocked band says so in the summary', () => {
    const snapshot = idleSnap();
    snapshot.phase = 'blocked' as never;
    expect(panel(70, { snapshot, live: [], lastPhase: 'implement' }).rows[0]).toContain('blocked');
  });
  test('the panel is a non-shrinking column on the panel background', () => {
    const { node } = panel(160);
    expect(node.props).toMatchObject({ flexDirection: 'column', flexShrink: 0, backgroundColor: PALETTES.mocha.panel });
  });
});

describe('railPhase', () => {
  const snap = (phase: string) => ({ ...busySnap(), phase }) as ReturnType<typeof busySnap>;
  const ids = busySnap().contract.phases.map((p) => p.id as string);

  test('an on-rail phase is lit as itself, ignoring lastPhase', () => {
    const on = ids[1]!;
    expect(railPhase(snap(on), ids[2])).toBe(on);
  });
  test('an off-rail phase falls back to the last rail phase seen', () => {
    expect(railPhase(snap('blocked'), ids[2])).toBe(ids[2]);
  });
  test('an off-rail phase with no or unknown lastPhase lights the first rail phase', () => {
    const first = railPhase(snap(ids[0]!));
    expect(railPhase(snap('blocked'))).toBe(first);
    expect(railPhase(snap('blocked'), null)).toBe(first);
    expect(railPhase(snap('blocked'), 'nonsense')).toBe(first);
  });
});

describe('message row: only real messages, never presence events', () => {
  const comm = (seq: number, ago: number, from: string, to: string, text: string, kind: string) => ({ seq, ts: NOW - ago, from, to, text, kind });
  test('a newer join or leave does not replace the last message', () => {
    const comms = [comm(1, 9000, 'impl-auth', 'lead', 'need a decision on the token ttl', 'say'), comm(2, 1000, 'explorer-a843', 'all', 'joined', 'join'), comm(3, 500, 'explorer-a843', 'all', 'left', 'leave')];
    const { all } = panel(160, { snapshot: busySnap({ comms: comms as any }) });
    expect(all).toContain('impl-auth to lead');
    expect(all).not.toMatch(/to all +(joined|left)/);
  });
  test('only presence events: no message row at all', () => {
    const comms = [comm(1, 1000, 'explorer-a843', 'all', 'joined', 'join')];
    const { all } = panel(160, { snapshot: busySnap({ comms: comms as any }) });
    expect(all).not.toContain('joined');
  });
});

describe('band counts the open work the TODO tree shows', () => {
  const rowsOf = (items: { id: string; status: string }[]) => items.map((t) => ({ ...t, content: `item ${t.id}`, owner: 'explorer-a843', evidence: null, origin: 'dispatch' }));
  test('only dispatch rows on the board, no groups: `0 of 2`', () => {
    const todos = rowsOf([{ id: 'd0', status: 'in_progress' }, { id: 'd1', status: 'pending' }]);
    const { rows } = panel(160, { snapshot: busySnap({ todos: todos as any, todoGroups: [] }) });
    expect(rows[0]).toContain('0 of 2');
  });
});

describe('D2 the band count is the snapshot count', () => {
  const r = (id: string, over: Record<string, unknown> = {}) => ({ id, content: `work ${id}`, status: 'pending', session_id: 's', ...over });
  const items = [
    r('a', { status: 'completed', phase: 'implement' }), r('b', { phase: 'implement' }),
    r('m', { origin: 'manual' }), // unphased session row: no group holds it, the count must
    r('ph', { content: 'placeholder', session_id: 'old' }), r('old', { session_id: 'older' }),
    r('adv', { origin: 'advisor' }), r('car', { origin: 'carried' }),
  ];
  test('D2: band `N of M` equals computeCounts on the same board (1 of 3), whatever the groups drop', () => {
    const contract = busySnap().contract;
    const snapshot = busySnap({ todos: items as any, todoGroups: groupTodos(items as any, contract, 's'), counts: computeCounts(items as any, contract, 's') });
    expect(snapshot.counts).toMatchObject({ done: 1, total: 3 });
    expect(panel(160, { snapshot }).rows[0]).toContain('1 of 3');
  });
});
