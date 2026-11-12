// Round 3, critique 22 (HUD and SUBAGENTS): a quiet header, a rounded box that never changes shape, honest rows, `returned` as the done disc, one spinner phase.
// Every rule is checked at 150 and 110 columns (and at 57, the width the live 110-column transcript leaves beside the docked pane) with a scorer-shaped parser
// (round2/tools/live_capture.py parse_frame, rev 4 locators: is_block_header, a TODO row is `<glyph> T<n> `, a SUBAGENTS row is `<glyph> <name> <state word>`).
import { describe, expect, test } from 'claude-code/testing';
import { PALETTE5, SPIN_FRAMES, cells, leadSpinnerGlyph, runsString, spinClock, spinFrameOf, type Run, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { agentModel, hudLines, type HudAgent, type HudInput } from './hud';
import { agentRows, type AgentRow } from './hud-surface';

const NOW = 1_794_458_960_000;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const RIBBON = '◖ ◆ ATLAS ◗';
const WIDTHS = [150, 110, 57] as const;

const todo = (i: number, status: string, owner?: string, extra: object = {}): TodoItem =>
  ({ id: `t${i}`, content: ['T1 read alpha.py (alpha-explorer)', 'T2 read beta.py (beta-explorer)', 'T3 read gamma.py (gamma-explorer)', 'T4 combine the three reports', 'T5 write the final summary'][i - 1]!, status, ...(owner ? { owner } : {}), ...extra }) as unknown as TodoItem;
const OWNERS = ['alpha-explorer', 'beta-explorer', 'gamma-explorer'];
const agent = (name: string, state: string, uiState: HudAgent['ui'], over: Partial<HudAgent> = {}): HudAgent => ({ name, role: 'explorer', state, ui: uiState, model: 'haiku', since: NOW - 5000, ...over });

const working: HudInput = { todos: [todo(1, 'in_progress', OWNERS[0]), todo(2, 'in_progress', OWNERS[1]), todo(3, 'in_progress', OWNERS[2]), todo(4, 'pending'), todo(5, 'pending')], agents: OWNERS.map((n) => agent(n, 'working', 'running', { tool: 'Read', target: `${n.split('-')[0]}.py` })) };
const done: HudInput = { todos: [1, 2, 3, 4, 5].map((i) => todo(i, 'completed', OWNERS[i - 1])), agents: OWNERS.map((n) => agent(n, 'done', 'done', { lastLine: 'STATUS: DONE' })) };
const blocked: HudInput = { todos: [todo(1, 'completed', OWNERS[0]), todo(2, 'blocked', OWNERS[1]), todo(3, 'completed', OWNERS[2]), todo(4, 'pending'), todo(5, 'pending')], agents: [agent(OWNERS[0]!, 'done', 'done'), agent(OWNERS[1]!, 'failed', 'failed'), agent(OWNERS[2]!, 'done', 'done')] };
const STATES = { working, done, blocked } as const;

const draw = (input: HudInput, cols: number, maxRows = 40, over: { tick?: number; now?: number } = {}): Run[][] => hudLines(input, { cols, maxRows, ui, now: over.now ?? NOW, ...(over.tick !== undefined ? { tick: over.tick } : {}) });
const text = (rows: Run[][]): string[] => rows.map((r) => runsString(r).trimEnd());

/** The scorer's rev 4 locators, ported: a block header is the ribbon then `▸ `; a TODO row, after an optional `▸ `, is `<glyph> T<n> `; a SUBAGENTS row is `<glyph> <name> <state word>`. */
const isBlockHeader = (l: string): boolean => l.includes(RIBBON) && (l.split(RIBBON)[1] ?? '').slice(0, 3).includes('▸ ');
const STATE_WORDS = 'running|queued|done|failed|blocked|waiting';
function scorerView(lines: string[]): { todo: Map<string, string>; sub: { name: string; word: string; glyph: string }[]; unknown: string[] } {
  const todoAt = lines.findIndex((l) => isBlockHeader(l) && l.includes('▸ TODO'));
  const subAt = lines.findIndex((l) => isBlockHeader(l) && l.includes('▸ SUBAGENTS'));
  const strip = (l: string): string => { const m = l.trim(); return m.startsWith('▸ ') ? m.slice(2).trimStart() : m; };
  const todoRowsSeen = new Map<string, string>();
  const unknown: string[] = [];
  for (const l of lines.slice(todoAt + 1, subAt >= 0 ? subAt : undefined)) {
    const ms = strip(l);
    const mi = /^(\S)\s+(\S.*)$/.exec(ms);
    if (!mi || /^[╰╯─ ]+$/.test(ms)) continue;
    const tm = /^(T[1-5])\b/.exec(mi[2]!);
    if (!'◐◓◑◒◇●■▲◉'.includes(mi[1]!)) unknown.push(mi[1]!);
    if (tm) todoRowsSeen.set(tm[1]!, mi[1]!);
  }
  const sub: { name: string; word: string; glyph: string }[] = [];
  if (subAt >= 0) for (const l of lines.slice(subAt + 1)) {
    if (l.includes(RIBBON)) break;
    const mr = new RegExp(`^([◐◓◑◒◇■▲◉●])\\s+(\\S+)\\s+(${STATE_WORDS})\\b`).exec(strip(l));
    if (mr) sub.push({ glyph: mr[1]!, name: mr[2]!, word: mr[3]! });
  }
  return { todo: todoRowsSeen, sub, unknown };
}

describe('step 1: a quiet header', () => {
  for (const cols of WIDTHS) {
    test(`${cols} columns: the ribbon has no fill and reads 240, the title is bold 252, the rule is 240; the literal block header text is kept`, () => {
      const rows = draw(working, cols);
      for (const title of ['TODO', 'SUBAGENTS']) {
        const head = rows.find((r) => runsString(r).includes(`▸ ${title}`))!;
        const line = runsString(head);
        expect(isBlockHeader(line)).toBe(true);
        expect(line).toContain(`${RIBBON} ▸ ${title}`);
        const ribbon = head.find((x) => x.t === RIBBON)!;
        expect([ribbon.tone, ribbon.fg, ribbon.bg, ribbon.chip]).toEqual(['dim', PALETTE5.dim, undefined, undefined]);
        const name = head.find((x) => x.t === title)!;
        expect([name.tone, name.bold, name.fg]).toEqual(['text', true, PALETTE5.body]);
        const rule = head.find((x) => /^─+╮$/.test(x.t))!; // the rule and its right corner are one quiet 240 run
        expect([rule.tone, rule.fg]).toEqual(['dim', PALETTE5.dim]);
        expect(head.filter((x) => x.chip === true || x.bg !== undefined)).toEqual([]); // the band alone carries the solid chip
      }
    });
  }
  test('the count and the meter follow the title: TODO has `n/m` and the meter, SUBAGENTS the spinner and the counts', () => {
    const rows = text(draw(working, 150));
    expect(rows[0]).toMatch(/▸ TODO {2}0\/5 ▱{8} ─+╮$/);
    expect(rows.find((r) => r.includes('SUBAGENTS'))).toMatch(/▸ SUBAGENTS [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 3 running ─+╮$/);
  });
});

describe('step 2: a rounded box that never changes shape', () => {
  for (const cols of WIDTHS) for (const [name, input] of Object.entries(STATES)) {
    test(`${cols} columns, ${name}: ╭─ before the header, ─╮ at the last cell, ╰───╯ under each block, one blank between the blocks, the same width`, () => {
      const rows = draw(input, cols);
      const out = text(rows);
      const heads = out.map((l, i) => [l, i] as const).filter(([l]) => isBlockHeader(l));
      expect(heads.map(([l]) => /▸ (TODO|SUBAGENTS)/.exec(l)![1])).toEqual(['TODO', 'SUBAGENTS']);
      for (const [l, i] of heads) {
        expect([l.startsWith('╭─ '), l.endsWith('╮'), cells(l)]).toEqual([true, true, cols]);
        expect(cells(runsString(rows[i]!))).toBe(cols); // padded to the one width in every state
      }
      const closes = out.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith('╰'));
      expect(closes.map(([l]) => l)).toEqual([`╰${'─'.repeat(cols - 2)}╯`, `╰${'─'.repeat(cols - 2)}╯`]); // both blocks, every state
      expect(closes[1]![1]).toBe(out.length - 1); // SUBAGENTS closes the HUD; the host or the register adds the blank under it
      const subAt = heads[1]![1];
      expect([out[subAt - 2], out[subAt - 1]]).toEqual([`╰${'─'.repeat(cols - 2)}╯`, '']); // exactly one blank between TODO and SUBAGENTS
      expect(out.filter((l) => l === '')).toHaveLength(1);
      for (const l of out) expect(cells(l)).toBeLessThanOrEqual(cols);
      expect(out.slice(1).some((l) => /^[│┃]/.test(l.trim()) && !l.startsWith('╰'))).toBe(false); // rows carry no side border: the scorer reads the glyph first
      for (const [l] of closes) expect(/^\S\S/.test(l)).toBe(true); // a closing line with no space after its first character is skipped by the scorer
    });
  }
  test('the width does not reflow between working and idle: every header and closing rule is `cols` cells in every state', () => {
    for (const cols of WIDTHS) {
      const widths = new Set<number>();
      for (const input of Object.values(STATES)) for (const l of text(draw(input, cols)).filter((x) => isBlockHeader(x) || x.startsWith('╰'))) widths.add(cells(l));
      expect([...widths]).toEqual([cols]);
    }
  });
  test('ASCII keeps the same shape: `+-` and `-+` on the header, `+---+` closing, `[ATLAS]` for the ribbon', () => {
    const out = text(hudLines(working, { cols: 110, maxRows: 40, ui: { theme: 'mocha', ascii: true, color: 'none' }, now: NOW }));
    expect(out[0]).toMatch(/^\+- \[ATLAS\] > TODO .*-\+$/); // the rule runs to the last cell and ends in `+`
    expect(out.filter((l) => /^\+-+\+$/.test(l))).toHaveLength(2);
    for (const l of out.filter((x) => x.trim() !== '')) expect(cells(l)).toBeLessThanOrEqual(110);
  });
  test('a short budget drops the blank, then the closing rules, then folds the finished rows; both boxes lose their corners with their rules, and the column names stay while an agent row shows (critique 26)', () => {
    for (const cols of [150, 110]) {
      const input: HudInput = { todos: [todo(1, 'completed', OWNERS[0]), todo(2, 'completed', OWNERS[1]), todo(3, 'in_progress', OWNERS[2]), todo(4, 'pending'), todo(5, 'pending')], agents: OWNERS.map((n, i) => agent(n, i < 2 ? 'done' : 'working', i < 2 ? 'done' : 'running', { tool: 'Read', target: `${n.split('-')[0]}.py` })) };
      const at = (n: number): string[] => text(draw(input, cols, n));
      const plan = (out: string[]): string[] => out.filter((l) => /^[▸ ] [◐◓◑◒◇●■▲◉] T[1-5] /.test(l));
      const corners = (out: string[]): [number, number, number] => [out.filter((l) => l.startsWith('╭─ ')).length, out.filter((l) => l.endsWith('╮')).length, out.filter((l) => l.startsWith('╰') && l.endsWith('╯')).length];
      expect(at(40)).toHaveLength(14);
      for (let n = 14; n >= 8; n--) {
        const out = at(n);
        expect([cols, n, out.length <= n]).toEqual([cols, n, true]);
        expect([cols, n, corners(out)]).toEqual([cols, n, n >= 13 ? [2, 2, 2] : [0, 0, 0]]); // the bottoms are the first decoration after the blank, and they go with the tops and their `╮`: a box is closed on both blocks or drawn open on both (critique 27)
        expect([cols, n, out.some((l) => /AGENT\s+STATE/.test(l))]).toEqual([cols, n, true]);
      }
      expect(at(14).filter((l) => l === '')).toHaveLength(1);
      expect(at(13).filter((l) => l === '')).toHaveLength(0); // the blank goes first
      expect(plan(at(13))).toHaveLength(5); // every plan row stays
      expect(plan(at(12))).toHaveLength(5); // then the rules; still every plan row
      expect(plan(at(11))).toHaveLength(5);
      expect(at(10)[0]).toMatch(/2 done/); // the finished rows fold into the count after that
      expect(plan(at(10)).some((l) => /T[12] read/.test(l))).toBe(false);
      expect(plan(at(8)).filter((l) => /T[345] /.test(l)).length).toBeGreaterThanOrEqual(1); // an open plan row keeps its place
    }
  });
});

describe('the scorer reads the rewritten blocks: states, rows and names at 150 and 110', () => {
  for (const cols of WIDTHS) for (const [name, input] of Object.entries(STATES)) {
    test(`${cols} columns, ${name}: every T row has a known glyph and the right state, every agent row parses`, () => {
      const v = scorerView(text(draw(input, cols)));
      expect(v.unknown).toEqual([]);
      expect([...v.todo.keys()].sort()).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
      const expected = name === 'working' ? { T1: 'running', T2: 'running', T3: 'running', T4: 'queued', T5: 'queued' } : name === 'done' ? { T1: 'done', T2: 'done', T3: 'done', T4: 'done', T5: 'done' } : { T1: 'done', T2: 'blocked', T3: 'done', T4: 'queued', T5: 'queued' };
      for (const [k, st] of Object.entries(expected)) expect([k, '◐◓◑◒'.includes(v.todo.get(k)!) ? 'running' : { '◇': 'queued', '●': 'done', '■': 'failed', '▲': 'blocked', '◉': 'waiting' }[v.todo.get(k)!]]).toEqual([k, st]);
      expect(v.sub.map((r) => r.name)).toEqual(OWNERS);
      for (const r of v.sub) expect(r.word).toBe(name === 'working' ? 'running' : name === 'done' ? 'done' : r.name === OWNERS[1] ? 'failed' : 'done');
    });
  }
});

describe('step 3: honest rows', () => {
  test('never a blank AGENT name: a worker the host listed with no name takes its key, else the dispatch description name, else the owner of a dispatch row no one holds', () => {
    const dispatch = { ...todo(3, 'in_progress'), id: 'd3', content: 'read gamma.py', owner: 'gamma-explorer', origin: 'dispatch' } as unknown as TodoItem;
    const nameless: HudAgent[] = [agent('', 'working', 'running', { role: '' })];
    expect(agentModel(nameless, [dispatch])[0]!.name).toBe('gamma-explorer');
    expect(agentModel([agent('', 'working', 'running', { task: 'gamma-explorer: read gamma.py' })], [])[0]!.name).toBe('gamma-explorer');
    expect(agentModel([agent('', 'working', 'running', { key: 'delta-explorer' })], [])[0]!.name).toBe('delta-explorer');
    expect(agentModel([agent('', 'working', 'running', { role: 'explorer' })], [])[0]!.name).toBe('explorer');
    for (const cols of WIDTHS) {
      const named = scorerView(text(draw({ todos: [dispatch], agents: [agent('', 'working', 'running', { role: 'explorer' })] }, cols))).sub; // the dispatch row's own queued worker, and the nameless one under its role
      expect(named.map((r) => r.name).sort()).toEqual(['explorer', 'gamma-explorer']);
    }
  });
  test('the name is whole on every frame of a new row (the reveal never blanks or cuts it)', () => {
    const rows: AgentRow[] = [{ name: 'gamma-explorer', state: 'running', model: 'haiku', tasks: [], tool: 'read g.py', ctx: null, focus: false, key: 'agent:gamma' }];
    for (const cols of WIDTHS) expect(text(agentRows(rows, { cols, ui }, { spacers: true, extras: false, close: true }))[2]).toContain('gamma-explorer');
  });
  test('truncation is all or none per column: a cell that does not fit ends in a one-cell `…`, never `...`, never a cut without a mark, never another word', () => {
    const mk = (name: string, tool: string): AgentRow => ({ name, state: 'running', model: 'haiku', tasks: [1], tool, ctx: null, focus: false });
    const rows = [mk('alpha-explorer', 'read a-very-long-file-name-that-cannot-fit.py'), mk('beta-explorer', 'read b.py'), mk('gamma-explorer', 'bash')];
    for (const cols of [110, 80, 70]) { // RESULT is the column that ends in a mark; 57 cells leave no room for it
      const lasts = text(agentRows(rows, { cols, ui }, { spacers: true, extras: false, close: true })).slice(2, -1).map((l) => l.split(/\s{2,}/).at(-1)!);
      expect([cols, lasts[1]!.startsWith('read b') || lasts[1]!.endsWith('…')]).toEqual([cols, true]);
      expect([cols, lasts[0]!.endsWith('…') || lasts[0] === 'read a-very-long-file-name-that-cannot-fit.py']).toEqual([cols, true]);
      for (const l of lasts) expect([cols, l, /\S\.\.\.$/.test(l)]).toEqual([cols, l, false]);
    }
  });
  test('MODEL and TASK are never `-` when known: the TASK falls back to the dispatch row text, MODEL keeps the squad model', () => {
    const dispatch = { ...todo(3, 'in_progress'), id: 'd3', content: 'read gamma.py', owner: 'gamma-explorer', origin: 'dispatch' } as unknown as TodoItem;
    const lone = agentModel([agent('gamma-explorer', 'working', 'running')], [dispatch])[0]!;
    expect([lone.task, lone.model]).toEqual(['read gamma.py', 'haiku']);
    for (const cols of [150, 110]) {
      const line = text(agentRows([lone], { cols, ui }, { spacers: true, extras: false, close: true }))[2]!;
      expect(line.includes('haiku')).toBe(cols >= 120); // MODEL shows from 120 columns
      expect(line).toMatch(cols >= 120 ? /haiku {3}read g…/ : /running {5}read g…/); // the dispatch text, cut with a one-cell mark in the 7-cell TASK column, never `-`
    }
    expect(agentModel([agent('gamma-explorer', 'working', 'running', { model: '' })], [])[0]!.model).toBe('-'); // unknown stays an honest dash
  });
  test('LAST is one type, the elapsed clock, frozen when the agent ends; RESULT never repeats the state word', () => {
    const running = agentModel([agent('alpha-explorer', 'working', 'running', { startedAt: NOW - 24_000, since: NOW - 24_000 })], [], null, NOW)[0]!;
    expect(running.elapsed).toBe('0:24');
    expect(running.fallback).toBeUndefined();
    expect(agentModel([agent('alpha-explorer', 'done', 'done', { lastTool: 'Read' })], [], null, NOW)[0]!.fallback).toBe('read');
    const ended = { startedAt: NOW - 40_000, since: NOW - 10_000 };
    expect(agentModel([agent('alpha-explorer', 'done', 'done', ended)], [], null, NOW)[0]!.elapsed).toBe('0:30');
    expect(agentModel([agent('alpha-explorer', 'done', 'done', ended)], [], null, NOW + 90_000)[0]!.elapsed).toBe('0:30'); // frozen: a later clock does not move it
    expect(agentModel([agent('alpha-explorer', 'failed', 'failed', ended)], [], null, NOW + 90_000)[0]!.elapsed).toBe('0:30');
    expect(agentModel([agent('alpha-explorer', 'working', 'running', { startedAt: NOW - 40_000 })], [], null, NOW + 90_000)[0]!.elapsed).toBe('2:10'); // a live agent's keeps counting
    for (const cols of [110, 57]) {
      const row: AgentRow = { ...running, tool: '' };
      const out = text(agentRows([row], { cols, ui }, { spacers: true, extras: false, close: true }));
      expect(out[1]).toMatch(/LAST/);
      expect([cols, out[2]!.match(/running/g)!.length]).toEqual([cols, 1]); // the state column only
      expect([cols, /\s0:24(\s|$)/.test(out[2]!)]).toEqual([cols, true]);
    }
    expect(text(agentRows([{ ...running, tool: 'read a.py' }], { cols: 110, ui }, { spacers: true, extras: false, close: true }))[2]).toMatch(/0:24 {4}read a\.py$/); // RESULT follows LAST, the clock stays the one type in its column
  });
  test('at 110 all five TODO rows show while running when the budget allows (the box and the agents take 14 rows)', () => {
    for (const cols of [110, 57]) {
      const out = text(draw(working, cols, 14));
      expect(out).toHaveLength(14);
      expect(out.filter((l) => /^[▸ ]\s*\S T[1-5] /.test(l))).toHaveLength(5);
      expect(out[0]).not.toMatch(/more/);
    }
  });
});

describe('step 4 (critique 27): `returned` is the neutral `◉` and the word in 245, never the green done disc', () => {
  const returnedInput: HudInput = { todos: [todo(1, 'in_progress', OWNERS[0]), todo(2, 'in_progress', OWNERS[1])], agents: [agent(OWNERS[0]!, 'working', 'running', { tool: 'Read', target: 'a.py' }), agent(OWNERS[1]!, 'done', 'done', { lastLine: 'x' })] };
  for (const cols of WIDTHS) {
    test(`${cols} columns: the row reads \`◉ T2 ... returned\`, the glyph is the neutral mark in the body tone, the word is secondary, and the scorer counts no unknown glyph`, () => {
      const rows = draw(returnedInput, cols);
      const row = rows.find((r) => runsString(r).includes('T2 read beta.py'))!;
      expect(runsString(row)).not.toContain('◃');
      expect(row.some((x) => x.t === '●')).toBe(false);
      const glyph = row.find((x) => x.t === '◉')!;
      expect(glyph.tone).toBe('text');
      const word = row.find((x) => x.t === 'returned')!;
      expect(word.tone).toBe('sub');
      const v = scorerView(text(rows));
      expect(v.unknown).toEqual([]);
      expect(v.todo.get('T2')).toBe('◉');
    });
  }
  test('ASCII: the neutral mark and the word', () => {
    const out = text(hudLines(returnedInput, { cols: 110, maxRows: 40, ui: { theme: 'mocha', ascii: true, color: 'none' }, now: NOW }));
    expect(out.find((l) => l.includes('T2 read beta.py'))).toMatch(/^ {2}\? T2 .* returned$/);
  });
});

describe('step 5: one spinner phase: the band, the TODO rows, the SUBAGENTS rows and the SUBAGENTS header turn the shared frame', () => {
  for (const cols of [150, 110]) {
    test(`${cols} columns: every running glyph is SPIN_FRAMES at spinFrameOf(spinClock(now, tick)), at several frames`, () => {
      for (const [now, tick] of [[NOW, 0], [NOW + 100, 0], [NOW + 200, 3], [NOW + 750, 1]] as const) {
        const frame = spinFrameOf(spinClock(now, tick), '');
        const glyph = SPIN_FRAMES[((frame % 4) + 4) % 4]!;
        const rows = draw(working, cols, 40, { now, tick });
        const header = runsString(rows.find((r) => runsString(r).includes('▸ SUBAGENTS'))!);
        expect([now, tick, header.includes(`SUBAGENTS ${leadSpinnerGlyph(frame)} 3 running`)]).toEqual([now, tick, true]); // the title turns the band's braille frame on the same index
        const marks = text(rows).flatMap((l) => (/^[▸ ] ([◐◓◑◒]) (T\d|\S+-explorer)/.exec(l) ? [/^[▸ ] ([◐◓◑◒])/.exec(l)![1]!] : []));
        expect(marks).toHaveLength(6); // three TODO rows, three agent rows
        expect([now, tick, new Set(marks).size, marks[0]]).toEqual([now, tick, 1, glyph]);
      }
    });
  }
});
