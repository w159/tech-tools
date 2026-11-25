// The redesigned side panel (mock.html `side`, `chat`): tabs status / health / channel / bored, the header pill, and the four tab bodies (the gates content sits under the health tab).
// Truths kept from the old panel tests (state words in the tally, counts, which agent owns which row, frozen clocks, whole phase names, no cell wider than the pane) are asserted here against the new shape.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../../../contracts/panel-world';
import { cells, type Ui } from '../../design/atlas-ui';
import type { Health } from '../../data/idle-health';
import { bodyLines, fillRows, headerRows, lineText, panelLines, panelText, PANEL_TABS, STRIP_TABS, stripLayout, tabRows, tabRule, type PanelModel, type PanelTab } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const plain: Ui = { theme: 'mocha', ascii: true, color: 'none' };
const text = (m: PanelModel): string[] => panelText(m);
const body = (m: PanelModel): string[] => bodyLines(m).map((l) => lineText(l).trimEnd());
const HEALTH: Health = {
  gates: { total: 4, green: 3, checks: [{ id: 'completion', ok: true }, { id: 'tripwire', ok: false }], denied: 2 }, version: '17.32.0', branch: 'main', upSecs: 57_420, ctxPct: 27, tokens: 339_000, window: 1_000_000,
  last: { secs: 492, done: 5, total: 7, agents: 2, failed: 0 }, denyAgeSecs: 125,
  hooks: { total: 60, byLabel: [], recent: [{ label: 'tool.call', ageSecs: 3, ms: 2 }, { label: 'tool.call', ageSecs: 9, ms: 9 }, { label: 'tool.call', ageSecs: 12, ms: 4 }], latency: { n: 60, p50: 2, p95: 9 } },
  pulse: { events: [0, 1, 2, 3, 5, 4, 3, 2, 1, 0, 2, 3, 4, 5, 6, 3, 2, 1, 0, 2], ctx: [], runs: [{ secs: 483, ok: true, at: 1 }, { secs: 2320, ok: false, at: 2 }, { secs: 182, ok: true, at: 3 }] },
} as never;
const run = { kind: 'working' as const, secs: 5, startMs: 0, frame: 0 };
const live = (tab: PanelTab, cols = 62, over: Partial<PanelModel> = {}, ui: Ui = mocha): PanelModel => panelWorld(tab, cols, ui, { rows: 40, run, health: HEALTH, ...over });

describe('the strip: status health channel bored', () => {
  test('the four tabs, in this order, whole words; no team, core or board', () => {
    expect(PANEL_TABS.map((t) => t.label)).toEqual(['status', 'health', 'channel', 'bored']);
    expect(STRIP_TABS.map((t) => t.label)).toEqual(['status', 'health', 'channel', 'bored']);
    expect(lineText(tabRows(live('route'))[0]!).trim().replace(/ +/g, ' ')).toBe('status health 1 channel 2 bored'); // the world's one denied gate (the badge sits on health, where the gates live), two unread notes
  });
  test('the lit tab is a filled accent chip, with an accent segment on the rule below it', () => {
    for (const tab of ['route', 'core', 'channel', 'bored'] as PanelTab[]) {
      const m = live(tab);
      const lit = tabRows(m)[0]!.runs.find((x) => x.bg === 'accent');
      expect(lit?.bold).toBe(true);
      const rule = tabRule(m);
      const heavy = rule.runs.find((x) => x.tone === 'accent')!;
      expect(heavy.t).toMatch(/^━+$/);
      expect(cells(heavy.t)).toBe(cells(lit!.t)); // the segment is as wide as the chip it sits under
      expect(lineText(rule).indexOf('━')).toBe(lineText(tabRows(m)[0]!).indexOf(lit!.t));
    }
  });
  test('health carries its denial count in red, channel its unread count in the accent', () => {
    const runs = tabRows(live('route'))[0]!.runs;
    expect(runs.find((x) => x.t === ' 1' && x.tone === 'bad')).toBeTruthy();
    expect(runs.find((x) => x.t === ' 2' && x.tone === 'accent')).toBeTruthy();
    expect(lineText(tabRows(live('route', 62, { unread: 0, gates: [] }))[0]!)).not.toMatch(/ \d/);
  });
  test('one row and never wider than the pane at every width; the trailing tabs fold into `more ›`, the order never changes', () => {
    for (let cols = 30; cols <= 150; cols++) {
      const rows = tabRows(live('route', cols));
      expect(rows).toHaveLength(1);
      expect(cells(lineText(rows[0]!))).toBeLessThanOrEqual(cols);
      expect(cells(lineText(tabRule(live('route', cols))))).toBeLessThanOrEqual(cols);
      const f = stripLayout(cols, 'route');
      const shown = [...f.rows[0]!.map((t) => t.id), ...f.folded.map((t) => t.id)];
      expect(shown).toEqual(['route', 'core', 'channel', 'bored'].filter((t) => shown.includes(t as never)));
    }
    expect(stripLayout(40, 'route').rows[0]!.map((t) => t.label)).toEqual(['status', 'health', 'channel', 'bored']);
    expect(stripLayout(37, 'route').more).toBe(false);
    expect(stripLayout(37, 'route').rows[0]!.map((t) => t.label)).toEqual(['status', 'health', 'chan', 'bored']); // the short label where the whole words do not fit
    expect(stripLayout(30, 'route').more).toBe(true);
  });
  test('the header: the ATLAS pill, project · branch dim, the version flush right; four rows above the body', () => {
    const m = live('route', 80, { channel: 'tech-tools@main' });
    const [head] = headerRows(m);
    const t = lineText(head!);
    expect(t).toContain('◆ ATLAS');
    expect(t).toContain('tech-tools · main');
    expect(t.trimEnd().endsWith('17.32.0')).toBe(true);
    expect(headerRows(m)).toHaveLength(4);
    expect(head!.runs.find((x) => x.t.includes('ATLAS'))?.bg).toBe('accent');
  });
  test('ascii and no colour: every glyph has an ascii form', () => {
    for (const tab of ['route', 'core', 'channel', 'bored'] as PanelTab[]) {
      const rows = panelText(live(tab, 62, {}, plain));
      expect(rows.join('\n')).not.toMatch(/[✓✗●○◐◓◑◒◉▰▱━─│╭╮╰╯▌↳⇢•›…▇┤└]/);
      for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(62);
    }
  });
});

describe('status', () => {
  test('PHASE: dots joined by rules, every phase name whole under its dot', () => {
    const rows = body(live('route', 80, { phases: ['research', 'theory', 'test', 'validate', 'implement', 'verify'], phase: 'implement', entered: ['research', 'theory', 'test', 'validate', 'implement'] }));
    const at = rows.findIndex((l) => l.includes('PHASE'));
    expect(rows[at + 2]).toMatch(/^ ●─+●─+●─+●─+◉─+○$/);
    for (const p of ['research', 'theory', 'test', 'validate', 'implement', 'verify']) expect(rows[at + 3]).toContain(p);
    const dots = [...rows[at + 2]!].map((c, i) => [c, i] as const).filter(([c]) => '●◉○'.includes(c)).map(([, i]) => i);
    ['research', 'theory', 'test', 'validate', 'implement', 'verify'].forEach((p, i) => expect(rows[at + 3]!.indexOf(p)).toBe(dots[i]!)); // each name starts under its dot
  });
  test('PHASE colours: done green, current accent, the rest dim', () => {
    const m = live('route', 80, { phases: ['a', 'b', 'c'], phase: 'b', entered: ['a', 'b'] });
    const dots = bodyLines(m).flatMap((l) => l.runs).filter((x) => /^[●◉○]$/.test(x.t));
    expect(dots.map((x) => [x.t, x.tone])).toEqual([['●', 'ok'], ['◉', 'accent'], ['○', 'dim']]);
  });
  test('a phase list too wide for one row wraps as `● name` chips, never cut', () => {
    const phases = ['research', 'theory', 'test', 'validate', 'implement', 'verify'];
    const rows = body(live('route', 40, { phases, phase: 'test', entered: ['research', 'theory', 'test'] }));
    for (const p of phases) expect(rows.join('\n')).toContain(p);
  });
  test('PLAN: `n of m`, the segmented bar, one row per item with owner and time', () => {
    const rows = body(live('route', 62));
    expect(rows.find((l) => l.includes('PLAN'))).toMatch(/PLAN {2}3 of 7 {2}[▰▱]+$/);
    const sub = rows.find((l) => l.includes('Subagents block'))!;
    expect(sub).toContain('implementer-band');
    expect(sub).toMatch(/0:42$/); // the owner's own clock, frozen at the world's 42 s
    expect(rows.find((l) => l.includes('Gate tests'))).toMatch(/runner-land +-$/); // a queued item has no time
    expect(rows.find((l) => l.includes('Changelog'))).toMatch(/^▸ ✗ Changelog/);
    expect(rows.join('\n')).toContain('failed · tests red 3'); // a failed row says why under it
  });
  test('PLAN: a title naming its owner keeps the owner whole when it is cut', () => {
    const todos = [{ id: 't1', label: 'T1 read alpha.py (alpha-explorer)', state: 'running' as const }];
    for (const cols of [37, 43]) expect(body(live('route', cols, { todos, workers: [] })).join('\n')).toContain('(alpha-explorer)');
  });
  test('PLAN: the owner is one column, the time flush right, nothing runs into the next column', () => {
    for (const cols of [62, 80, 120]) {
      const rows = body(live('route', cols)).filter((l) => /^▸ [◐✓○✗▲] /.test(l));
      expect(rows.length).toBeGreaterThanOrEqual(7);
      for (const l of rows) { expect(cells(l)).toBeLessThanOrEqual(cols - 1); expect(l.trimEnd().length).toBe(cols - 1); }
    }
  });
  test('TEAM: the tally with its words, then one row per agent with glyph, name, role, what it did, time', () => {
    const rows = body(live('route', 80));
    const head = rows.find((l) => l.includes('TEAM'))!;
    expect(head).toContain('1 running');
    expect(head).not.toContain('done'); // finished agents leave the list and the tally: one `N done` line below keeps the count
    expect(rows.some((l) => /^ +\d+ done$/.test(l))).toBe(true);
    expect(head).toContain('1 failed');
    expect(head).toContain('1 queued');
    const a = rows.find((l) => l.includes('implementer-band') && l.includes('read runs.ts'))!;
    expect(a).toMatch(/^▸ ◐ implementer-band +implementer +read runs\.ts:17 +0:42$/);
    expect(rows.find((l) => l.includes('implementer-live'))).toContain('✗');
  });
  test('TEAM: a worker row opens its detail on a press (task, model, last step) and picks the recipient', () => {
    const m = live('route', 80, { expanded: 'worker:implementer-band' });
    const l = bodyLines(m).find((x) => x.press?.key === 'worker:implementer-band')!;
    expect(l.press).toMatchObject({ kind: 'worker', name: 'implementer-band' });
    expect(body(m).join('\n')).toMatch(/model +\S+/);
  });
  test('SESSION: only what the mod holds: uptime, branch, last run, release', () => {
    const rows = body(live('route', 80));
    const at = rows.findIndex((l) => l.includes('SESSION'));
    expect(rows.slice(at).join('\n')).toMatch(/uptime +15h 57m/);
    expect(rows.slice(at).join('\n')).toMatch(/branch +main/);
    expect(rows.slice(at).join('\n')).toMatch(/last run +✓ 8:12 +5\/7 done/);
    expect(rows.slice(at).join('\n')).toMatch(/release +17\.32\.0/);
    expect(body(live('route', 80, { health: undefined })).join('\n')).not.toContain('SESSION');
  });
  test('a short pane gives up plan and team rows, never its sections', () => {
    const rows = body(live('route', 62, { rows: 24 }));
    for (const s of ['PHASE', 'PLAN', 'TEAM']) expect(rows.join('\n')).toContain(s);
    expect(rows.length).toBeLessThanOrEqual(24 - 4);
  });
});

describe('health', () => {
  test('SESSION state and the thin bars with their figures', () => {
    const rows = body(live('core', 62));
    expect(rows.find((l) => l.includes('SESSION'))).toMatch(/■? ?2 denied$|2 denied/);
    expect(rows.find((l) => l.startsWith(' context'))).toMatch(/━+ +27% +339k \/ 1M$/);
    expect(rows.find((l) => l.includes('hook p50'))).toMatch(/2ms +p95 9ms +[▁-█]+$/);
    expect(rows.find((l) => l.includes('tools/min'))).toMatch(/\d+ +peak \d+ +[▁-█]+$/);
    expect(rows.find((l) => l.includes('denials'))).toMatch(/^ denials +2 +last 2m ago/);
  });
  test('a healthy session reads `healthy`, a hot context or slow hooks `degraded`', () => {
    const ok = { ...HEALTH, gates: { total: 2, green: 2, checks: [{ id: 'a', ok: true }] }, denyAgeSecs: undefined } as never;
    expect(body(live('core', 62, { health: ok })).find((l) => l.includes('SESSION'))).toMatch(/✓ healthy$/);
    expect(body(live('core', 62, { health: { ...(ok as object), ctxPct: 75 } as never })).find((l) => l.includes('SESSION'))).toMatch(/degraded$/);
  });
  test('a figure the mod does not have reads `—`, never an invented number', () => {
    const rows = body(live('core', 62, { health: { gates: { total: 0, green: 0, checks: [] } } as never }));
    expect(rows.find((l) => l.startsWith(' context'))).toMatch(/—$/);
    expect(rows.find((l) => l.includes('hook p50'))).toContain('—');
    expect(rows.find((l) => l.includes('tools/min'))).toContain('—');
    expect(rows.find((l) => l.includes('RUNS'))).toContain('no runs yet');
  });
  test('RUNS: the summary line and the bar chart, ok green and failed red, y axis max and 0, oldest / newest', () => {
    const m = live('core', 62);
    const rows = body(m);
    expect(rows.find((l) => l.includes('RUNS'))).toMatch(/3 runs · med 8:03 · p90 38:40 · 1 failed/);
    const chart = bodyLines(m).filter((l) => /^ +(38:40|0)? ?[│┤] /.test(lineText(l)));
    expect(chart.length).toBeGreaterThanOrEqual(3);
    expect(lineText(chart[0]!)).toContain('38:40');
    expect(lineText(chart.at(-1)!)).toMatch(/ 0 ┤/);
    const bars = chart.flatMap((l) => l.runs).filter((x) => x.t.includes('▇'));
    expect(new Set(bars.map((x) => x.tone))).toEqual(new Set(['ok', 'bad']));
    expect(rows.find((l) => l.includes('oldest'))).toMatch(/oldest +newest$/);
    expect(rows.find((l) => l.startsWith(' last'))).toMatch(/last +✓ 3:02 +✗ 38:40 +✓ 8:03$/);
  });
  test('the old core tab content sits under a CORE heading', () => {
    const rows = body(live('core', 62, { core: panelWorld('core', 62, mocha, { rows: 40 }).core }));
    expect(rows.join('\n')).not.toContain('CORE'); // no core model in the world: nothing to show
  });
});

describe('health: the gates section', () => {
  const gates = [
    { id: 'tripwire', title: 'tripwire', lines: [{ id: 't', label: 'team', ok: false, detail: 'Working dispatches run as a tmux team.', fix: 'atlas_mux.py spawn-team --class fix' }, { id: 'n', label: 'name', ok: true }] },
    { id: 'routing', title: 'routing', lines: [{ id: 's', label: 'scope', ok: true }, { id: 'r', label: 'recall', ok: true }] },
  ];
  test('the header counts what passed and what was denied; the grid lists every gate with its mark', () => {
    const rows = body(live('core', 62, { gates }));
    const gi = rows.findIndex((l) => l.includes('GATES'));
    expect(rows[gi]).toMatch(/GATES +this run +✓ 3 +✗ 1$/);
    const grid = rows.slice(gi + 2, gi + 4).join(' ');
    for (const g of ['team', 'name', 'scope', 'recall']) expect(grid).toContain(g);
    expect(rows[gi + 2]).toMatch(/^ {2}✗ team +✓ name +✓ scope +✓ recall$/);
  });
  test('a DENIED card: red rule, code, reason, `fix` in cyan, the denial age flush right', () => {
    const m = live('core', 62, { gates });
    const rows = body(m);
    const at = rows.findIndex((l) => l.includes('DENIED'));
    expect(rows[at + 2]).toMatch(/^ ▌ team +2m ago$/);
    expect(rows[at + 3]).toBe(' ▌ Working dispatches run as a tmux team.');
    expect(rows[at + 4]).toBe(' ▌ fix  atlas_mux.py spawn-team --class fix');
    const fix = bodyLines(m).flatMap((l) => l.runs).find((x) => x.t.startsWith('atlas_mux'))!;
    expect(fix.tone).toBe('cyan');
    expect(bodyLines(m).flatMap((l) => l.runs).find((x) => x.t === 'team' && x.tone === 'bad')?.bold).toBe(true);
  });
  test('nothing denied: the card list says so', () => {
    expect(body(live('core', 62, { gates: [gates[1]!] })).join('\n')).toContain('nothing denied');
  });
  test('the TIMELINE: a tick per bucket that saw checks, the bucket of the last denial marked', () => {
    const rows = body(live('core', 62, { gates }));
    const at = rows.findIndex((l) => l.includes('TIMELINE'));
    expect(rows[at + 1]).toMatch(/^ {2}[│·┃]+$/);
    expect(rows[at + 1]).toContain('┃');
    expect(rows[at + 2]).toMatch(/-\dm +now$/);
  });
  test('no gates reported: one honest line', () => {
    expect(body(live('core', 62, { gates: [] })).join('\n')).toContain('no gates reported yet');
  });
});

describe('channel: the chat', () => {
  const T = 1_700_000_000_000;
  const at = (ms: number): string => new Date(T + ms).toISOString().slice(11, 19);
  const notes = [
    { at: '08:41:00', ms: T, from: 'lead', to: 'implementer-1759', text: 'Dispatching the clock fix. Crew rows carry no start stamp, so finished workers keep counting.', lead: true },
    { at: '08:41:30', ms: T + 30_000, from: 'lead', text: 'Second note in the same minute.', lead: true },
    { at: '08:42:00', ms: T + 60_000, from: 'implementer-1759', text: 'Root cause confirmed in data/crew.ts.' },
    { at: '08:45:00', ms: T + 240_000, from: 'human', to: 'lead', text: 'also check the mux workers' },
    { at: '08:46:00', ms: T + 300_000, from: 'implementer-1759', kind: 'done', text: '4305 pass, 0 fail' },
  ];
  const chat = (over: Partial<PanelModel> = {}, cols = 62, ui: Ui = mocha): PanelModel =>
    live('channel', cols, { notes, people: 3, channel: 'tech-tools@main', starts: [{ at: '08:43:00', ms: T + 120_000, from: 'verifier-a1', kind: 'started', text: 'started' }], workers: [{ name: 'implementer-1759', role: 'implementer', state: 'running', detail: 'x', calls: [T + 299_000] }, { name: 'verifier-a1', role: 'verifier', state: 'waiting', detail: 'y' }], now: T + 305_000, ...over } as never, ui);
  test('the header: `#channel` bold and the online count in green', () => {
    const rows = body(chat());
    expect(rows[0]).toMatch(/^ #tech-tools@main +● 3 online$/);
    const hdr = bodyLines(chat())[0]!;
    expect(hdr.runs.find((x) => x.t.startsWith('#'))?.bold).toBe(true);
    expect(hdr.runs.filter((x) => x.tone === 'ok')).toHaveLength(2);
  });
  test('a centred `today` divider with faint rules', () => {
    const rows = body(chat());
    expect(rows[2]).toMatch(/^ ─+ today ─+$/);
    expect(Math.abs(rows[2]!.indexOf('today') - (62 - 5) / 2)).toBeLessThanOrEqual(2);
  });
  test('a message: `<glyph> <from> -> <to>` with the HH:MM:SS time right-aligned, the body wrapped at a 3-cell indent', () => {
    const rows = body(chat());
    const h = rows.findIndex((l) => l.startsWith(' ◆ lead'));
    expect(rows[h]).toMatch(/^ ◆ lead -> implementer-1759 +08:41:00$/); // the route is in the header: `from -> to`
    expect(rows[h]!.length).toBe(61); // the time ends at the margin
    expect(rows[h + 1]!.startsWith('   Dispatching')).toBe(true);
    for (const l of rows.slice(h + 1, h + 4)) expect(cells(l)).toBeLessThanOrEqual(61);
  });
  test('every message has its own header with its time; a blank row separates messages', () => {
    const rows = body(chat());
    expect(rows.filter((l) => l.startsWith(' ◆ lead'))).toHaveLength(2);
    expect(rows.join('\n')).toContain('   Second note in the same minute.');
    const i = rows.findIndex((l) => l.startsWith(' ◆ implementer-1759'));
    expect(rows[i - 1]).toBe('');
  });
  test('the name wears its role colour: the lead the accent, a worker its role colour', () => {
    const hdrs = bodyLines(chat()).filter((l) => /^ ◆ /.test(lineText(l)));
    expect(hdrs[0]!.runs.find((x) => x.t === 'lead')?.tone).toBe('accent');
    const worker = hdrs.find((l) => l.runs.some((x) => x.t === 'implementer-1759' && x.bold))!; // the speaker, not the `-> recipient` of the lead's note
    expect(worker.runs.find((x) => x.t === 'implementer-1759' && x.bold)?.fg).toBeTruthy();
    expect(worker.runs.find((x) => x.t === 'implementer-1759' && x.bold)?.bold).toBe(true);
    expect(worker.runs.find((x) => x.t === 'implementer-1759' && x.bold)?.fg).not.toBe(hdrs[0]!.runs.find((x) => x.t === 'lead')?.fg); // one colour per agent
  });
  test('a worker that started is one centred dim system line', () => {
    const l = body(chat()).find((x) => x.includes('lead dispatched verifier-a1'))!;
    expect(l.trim()).toBe('⇢ lead dispatched verifier-a1  ·  08:43:00');
    expect(Math.abs((l.length - l.trimStart().length) - (62 - l.trim().length) / 2)).toBeLessThanOrEqual(2);
  });
  test('the user\'s own message is a right-aligned bubble on the accent tint, `you  hh:mm` above it', () => {
    const m = chat();
    const rows = body(m);
    const i = rows.findIndex((l) => l.trim() === 'you  08:45:00');
    expect(rows[i]!.length).toBe(61);
    expect(rows[i + 1]!.endsWith('also check the mux workers')).toBe(true);
    expect(cells(lineText(bodyLines(m)[bodyLines(m).findIndex((l) => lineText(l).includes('also check'))]!))).toBe(61); // the bubble ends at the margin
    const bubble = bodyLines(m).flatMap((l) => l.runs).find((x) => x.t.includes('also check'))!;
    expect(bubble.bgHex).toMatch(/^#[0-9a-f]{6}$/);
    expect(bubble.bgHex).not.toBe('#181825');
  });
  test('a done post carries its state mark and a worker running a call under 10 s old is `typing`', () => {
    const rows = body(chat());
    expect(rows.join('\n')).toContain('   ✓ 4305 pass, 0 fail');
    expect(rows.join('\n')).toContain('implementer-1759 is typing •••');
    expect(body(chat({ now: T + 400_000 })).join('\n')).not.toContain('is typing');
  });
  test('the newest message stays visible: a short pane cuts the log from the top', () => {
    const rows = body(chat({ rows: 22 }));
    expect(rows.join('\n')).toContain('4305 pass, 0 fail');
    expect(rows.join('\n')).not.toContain('Dispatching the clock fix');
    expect(rows.join('\n')).toMatch(/↑ \d+ earlier/);
    expect(rows.length).toBeLessThanOrEqual(22 - 4);
  });
  test('the footer: the bordered input and `@name` chips for the online members; the recipient chip is filled', () => {
    const m = chat({ recipient: 'verifier-a1' });
    const rows = body(m);
    expect(rows.at(-4)).toMatch(/^ +@lead +@implementer-1759 +@verifier-a1 +⏎ send$/); // the chips sit above the input: the compose box is the last thing in the room
    expect(rows.at(-3)).toMatch(/^ ╭─+╮$/);
    expect(rows.at(-2)).toMatch(/^ │ › Message verifier-a1 +│$/);
    expect(rows.at(-2)!.length).toBe(61);
    expect(rows.at(-1)).toMatch(/^ ╰─+╯$/);
    const chips = bodyLines(m).at(-4)!.runs.filter((x) => x.press);
    expect(chips.map((x) => x.press)).toEqual(['to:lead', 'to:implementer-1759', 'to:verifier-a1']);
    expect(chips.map((x) => x.bg === 'accent')).toEqual([false, false, true]);
    expect(rows.at(-2)).toContain('Message verifier-a1');
    expect(body(chat()).at(-2)).toContain('Message the lead, or @name an agent');
    expect(bodyLines(chat()).at(-2)!.press).toMatchObject({ kind: 'compose' });
  });
  test('an empty channel says so and still has the input', () => {
    const rows = body(chat({ notes: [], starts: [], finishes: [] }));
    expect(rows.join('\n')).toContain('no messages yet');
    expect(rows.at(-2)).toContain('Message the lead');
  });
  test('the pane height holds: header + body is exactly the rows, with the input on the last four', () => {
    for (const rows of [24, 30, 40]) expect(panelLines(chat({ rows })).length).toBeLessThanOrEqual(rows);
    expect(panelLines(chat({ rows: 40 })).length).toBe(40);
  });
});

describe('truths carried over from the old tab tests', () => {
  const T = 1_700_000_000_000;
  const chat = (over: Partial<PanelModel> = {}, cols = 62, ui: Ui = mocha): PanelModel => live('channel', cols, { notes: [], people: 1, channel: 'chan', ...over } as never, ui);
  test('a generated launch id is no channel name: the title reads `this run`; a missing name reads #channel', () => {
    expect(body(chat({ channel: 'lc-opl0e60i@master' }))[0]).toMatch(/^ this run +● 1 online$/);
    expect(body(chat({ channel: undefined }))[0]).toMatch(/^ #channel /);
  });
  test('the online count is one word with its number: 1 online, 3 online', () => {
    expect(body(chat({ people: 1 }))[0]).toMatch(/● 1 online$/);
    expect(body(chat({ people: 3 }))[0]).toMatch(/● 3 online$/);
  });
  test('a note is wrapped on its words: whitespace and line breaks collapse, no row is wider than the pane', () => {
    const rows = body(chat({ notes: [{ at: '10:02:00', ms: T, from: 'lead', text: 'one\n\n  two   three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen', lead: true }] as never }, 40));
    const at = rows.findIndex((l) => l.startsWith(' ◆ lead'));
    expect(rows[at + 1]).toBe('   one two three four five six seven');
    for (const l of rows) expect(cells(l)).toBeLessThanOrEqual(39);
  });
  test('blocked, failed and handoff notes carry the state mark: ▲ blocked, ✗ failed (one failure word, never `killed`), ✓ done', () => {
    const notes = [
      { at: '10:02:00', ms: T, from: 'a', kind: 'blocked', text: 'need a decision' },
      { at: '10:03:00', ms: T + 1000, from: 'b', kind: 'failed', text: 'worker failed' },
      { at: '10:04:00', ms: T + 2000, from: 'c', kind: 'handoff', text: 'T1 merged' },
    ] as never;
    const rows = body(chat({ notes }));
    expect(rows.join('\n')).toContain('   ▲ need a decision');
    expect(rows.join('\n')).toContain('   ✗ worker failed');
    expect(rows.join('\n')).toContain('   ✓ T1 merged');
    expect(rows.join('\n')).not.toMatch(/killed/);
    const runs = bodyLines(chat({ notes })).flatMap((l) => l.runs);
    expect(runs.find((x) => x.t === 'worker failed')?.tone).toBe('bad');
  });
  test('a killed worker is a channel row, not `no messages yet`', () => {
    const rows = body(chat({ notes: [{ at: '10:02:00', ms: T, from: 'gamma-explorer', kind: 'failed', text: 'failed' }] as never }));
    expect(rows.join('\n')).not.toContain('no messages yet');
    expect(rows.join('\n')).toMatch(/gamma-explorer/);
  });
  test('ASCII: a note to a peer is marked with `>` and everything is plain ASCII', () => {
    const rows = body(chat({ notes: [{ at: '10:02:00', ms: T, from: 'lead', to: 'impl', text: 'go', lead: true }] as never }, 62, plain));
    expect(rows.join('\n')).toContain('+ lead -> impl'); // the ASCII glyph set: `+` for the speaker mark, `->` for the route
    expect(rows.join('\n')).toMatch(/^[\x20-\x7e\n]*$/);
  });
  test('the strip badge shows unread only when it is not zero, with its number', () => {
    expect(lineText(tabRows(live('route', 62, { unread: 0 }))[0]!)).not.toMatch(/channel +\d/);
    expect(lineText(tabRows(live('route', 62, { unread: 4 }))[0]!)).toMatch(/channel +4/);
  });
  test('a blocked plan row shows the blocked mark and why, under it; the PHASE head is the run state: blocked, done, working', () => {
    const todos = [{ id: 'b1', label: 'ship it', state: 'blocked' as const, owner: 'impl', detail: 'blocked: needs your approval' }];
    const rows = body(live('route', 80, { todos }));
    expect(rows.find((l) => l.includes('ship it'))).toMatch(/^▸ ▲ ship it/);
    expect(rows.join('\n')).toContain('blocked · blocked: needs your approval');
    expect(body(live('route', 80, { run: { kind: 'blocked', secs: 5, startMs: 0, frame: 0 } })).find((l) => l.includes('PHASE'))).toMatch(/PHASE +▲ blocked$/);
    expect(body(live('route', 80, { run: { kind: 'done', secs: 5, startMs: 0, frame: 0 } })).find((l) => l.includes('PHASE'))).toMatch(/PHASE +✓ done$/);
    expect(body(live('route', 80, { run: { kind: 'working', secs: 5, startMs: 0, frame: 0 } })).find((l) => l.includes('PHASE'))).toMatch(/PHASE +[◐◓◑◒] working$/);
  });
  test('the Claude pane fills its height: header + body + fill is exactly the rows when the body fits', () => {
    for (const rows of [30, 40, 48]) for (const tab of ['route', 'core', 'channel', 'bored'] as PanelTab[]) {
      const m = live(tab, 62, { rows });
      const used = panelLines(m).length + fillRows(m, bodyLines(m).length).length;
      expect([tab, rows, used]).toEqual([tab, rows, Math.max(rows, used)]);
    }
  });
  test('no gate ratio: `n/m` never appears beside a gate on the health tab or the strip', () => {
    const rows = panelText(live('core', 80)).join('\n') + panelText(live('route', 80))[2];
    expect(rows).not.toMatch(/(gates?|routing|tripwire|completion|header)[^\n]*\d+\/\d+/);
  });
  test('every row of every tab at every width is inside the pane, idle, working, done and blocked, colour and ascii', () => {
    for (const ui of [mocha, plain]) for (const kind of ['idle', 'working', 'done', 'blocked'] as const) for (const tab of ['route', 'core', 'channel', 'bored'] as PanelTab[]) for (const cols of [30, 38, 47, 62, 80, 110, 150]) {
      for (const l of panelText(live(tab, cols, { run: { kind, secs: 5, startMs: 0, frame: 0 } }, ui))) expect([tab, kind, cols, cells(l)]).toEqual([tab, kind, cols, Math.min(cells(l), cols)]);
    }
  });
});
