// Sidebar through the claude-code/testing kit: the real hooks module boots on a fake board
// (one channel member), draws the Pane on 'terminal', and the test presses the member row,
// types into the msg Input and submits. The note argv must name that member and the draft clear.
import type { On } from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import { gaugeText } from './atlas-ui';

const CHANNELS = JSON.stringify({ channels: { 'lead-abcdef': { members: [{ name: 'impl-a', role: 'implementer' }] } } });

test('press a member, type, submit: the note goes to that member and the draft clears', async ($, on) => {
  const runs: string[][] = [];
  const toasts: string[] = [];
  mock.clock(on);
  mock.env(on, { ATLAS_PROJECT_ROOT: '/repo' });
  on('session.id', async () => ({ value: 'abcdef-0000' }) as never);
  on('session.start', async (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never);
  on('ui.log', async () => ({ value: undefined }) as never);
  on('fs.exists', async (_$, e) => ({ value: String((e as { path: string }).path).endsWith('/.atlas') }) as never);
  on('fs.read', async (_$, e) => {
    const path = String((e as { path: string }).path);
    if (path.endsWith('/.atlas/.run/channels.json')) return { value: CHANNELS } as never;
    throw new Error('no such file');
  });
  on('fs.stat', async () => { throw new Error('no such file'); });
  on('fs.list', async () => ({ value: [] }) as never);
  on('agent.list', async () => ({ value: [{ id: 'aaaaaaaaaaaaaaaaa', teammateId: 'impl-a@s', type: 'atlas:implementer', status: 'running' }] }) as never);
  on('command.register', async (_$, e) => ({ value: { command: (e as { name: string }).name } }) as never);
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never);
  on('process.run', async (_$, e) => {
    runs.push([...(e as { argv: string[] }).argv]);
    return { value: { exitCode: 0, stdout: 'main', stderr: '' } } as never;
  });
  on('ui.toast', async (_$, e) => {
    toasts.push(String((e as { text?: string }).text ?? ''));
    return { value: undefined } as never;
  });
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const ui = await $.ui.mount({
    plugin: 'atlas',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'atlas',
    props: { title: 'Atlas', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never,
  });
  await ui.press({ key: 'tab:team' }); // the pane opens on route
  await ui.press({ key: 'worker:impl-a' });
  await ui.input({ key: 'msg', text: 'ping', kind: 'change' });
  await ui.input({ key: 'msg', text: 'ping' });
  const note = runs.find((argv) => argv.includes('note'));
  expect(note).toBeDefined();
  expect(note?.slice(note.indexOf('--to'), note.indexOf('--to') + 2)).toEqual(['--to', 'impl-a']);
  expect(note?.at(-1)).toBe('ping');
  expect(toasts).toContain('Sent to impl-a');
  expect((await ui.find({ key: 'msg' }))?.text ?? '').toBe('');
});

const CONTRACT = JSON.stringify({
  phases: ['research', 'theory', 'test', 'validate', 'implement', 'verify', 'done', 'blocked'].map((id) => ({ id, glyph: '.' })),
  todoPhases: ['research', 'theory', 'test', 'validate', 'implement', 'verify'],
  headerFirstLinePattern: '^ATLAS',
  itemPhasePrefix: '[<phase>] ',
});

/** Boot the real module on a fake board whose host agent list is `agents`. */
async function boot(on: On, agents: unknown[], env: Record<string, string> = {}, files: Record<string, string> = {}) {
  const clock = mock.clock(on);
  mock.env(on, { ATLAS_PROJECT_ROOT: '/repo', ...env });
  on('session.id', async () => ({ value: 'abcdef-0000' }) as never);
  on('session.start', async (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never);
  on('ui.log', async () => ({ value: undefined }) as never);
  on('fs.exists', async (_$, e) => ({ value: String((e as { path: string }).path).endsWith('/.atlas') }) as never);
  // The band's stepper comes from the operating contract; without it the rail has no phases to draw.
  on('fs.read', async (_$, e) => {
    const path = String((e as { path: string }).path);
    if (path.endsWith('/contracts/operating-contract.json')) return { value: CONTRACT } as never;
    const hit = Object.keys(files).find((k) => path.endsWith(k));
    if (hit) return { value: files[hit] } as never;
    throw new Error('no such file');
  });
  on('fs.stat', async (_$, e) => {
    const path = String((e as { path: string }).path);
    const hit = Object.keys(files).find((k) => path.endsWith(k));
    if (hit) return { value: { mtimeMs: 1, size: files[hit]!.length, isDirectory: false } } as never;
    throw new Error('no such file');
  });
  on('fs.list', async () => ({ value: [] }) as never);
  on('agent.list', async () => ({ value: agents }) as never);
  on('command.register', async (_$, e) => ({ value: { command: (e as { name: string }).name } }) as never);
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never);
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never);
  on('ui.toast', async () => ({ value: undefined }) as never);
  return clock;
}

const AGENT = { id: 'aaaaaaaaaaaaaaaaa', teammateId: 'impl-a@s', type: 'atlas:implementer', description: 'edit pane', status: 'running' };

test('hotkey tab c sets the view to channel', async ($, on) => {
  await boot(on, []);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const ui = await $.ui.mount({
    plugin: 'atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas',
    props: { title: 'Atlas', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never,
  });
  // The active tab is its label drawn bold (the rest muted), not a dimColor flag on the button.
  const isActive = async (tab: string) => ((await ui.find({ key: `tab:${tab}` }))?.children?.[0] as { props: { bold?: boolean } } | undefined)?.props.bold;
  expect(await isActive('route')).toBe(true); // route is the default tab
  expect((await ui.find({ key: 'tab:channel' }))?.props.hotkey).toBe('c');
  await ui.press({ key: 'tab:channel' });
  expect(await isActive('channel')).toBe(true);
  expect(await isActive('route')).toBe(false);
});

/** The team view's worker row as drawn after `ms` more mocked time (a working row carries the spinner frame). */
async function workerRowAfter($: Engine, clock: { advance(ms: number): Promise<unknown> }, ms: number): Promise<string> {
  await clock.advance(ms);
  const ui = await $.ui.mount({
    plugin: 'atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas',
    props: { title: 'Atlas', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never,
  });
  await ui.press({ key: 'tab:team' });
  const text = (await ui.find({ key: 'worker:impl-a' }))?.text ?? '';
  await ui.unmount();
  return text;
}

test('the spinner tick stays still when no worker is live', async ($, on) => {
  const clock = await boot(on, [{ ...AGENT, status: 'completed' }]);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const before = await workerRowAfter($, clock, 0);
  expect(before).not.toBe('');
  expect(await workerRowAfter($, clock, 2000)).toBe(before);
});

test('the spinner tick advances with a live worker', async ($, on) => {
  const clock = await boot(on, [AGENT]);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const before = await workerRowAfter($, clock, 0);
  expect(before).not.toBe('');
  expect(await workerRowAfter($, clock, 250)).not.toBe(before);
});

/** Everything the AbovePrompt render drew, as one string. */
async function abovePromptText($: Engine, maxRows: number, bodyColumns = 160): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'atlas', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { bodyColumns, hasSurvey: false, maxRows } as never });
  const text = JSON.stringify([ui.drawn, (await ui.findAll({})).map((n) => n.text)]);
  await ui.unmount();
  return text;
}

/** The band's spinner frame in its `<glyph> 1 running` count after `ms` more mocked time ('' when the count has no spinner). */
async function bandSpinAfter($: Engine, clock: { advance(ms: number): Promise<unknown> }, ms: number): Promise<string> {
  await clock.advance(ms);
  return /([◐◓◑◒]) 1 running/.exec(await abovePromptText($, 30))?.[1] ?? '';
}

test('the band spinner advances one frame per 100 ms while a worker runs', async ($, on) => {
  const clock = await boot(on, [AGENT]);
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never); // the host's own AbovePrompt
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const frames = [await bandSpinAfter($, clock, 0)];
  for (let i = 0; i < 8; i++) frames.push(await bandSpinAfter($, clock, 100));
  expect(frames[0]).not.toBe(''); // the count carries a spinner, not a still glyph
  for (let i = 1; i < frames.length; i++) expect(frames[i]).not.toBe(frames[i - 1]); // a new frame every 100 ms sample
  expect(new Set(frames).size).toBe(4); // the whole ◐◓◑◒ cycle
});

test('the band is still when no worker is live: no tick, no redraw difference', async ($, on) => {
  const clock = await boot(on, [{ ...AGENT, status: 'completed' }]);
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  await clock.advance(1000); // the first gate run lands
  const before = await abovePromptText($, 30);
  expect(before).toContain('blocked'); // the fixture's gate has a failing completion check, so the idle band reads blocked (A2)
  for (let i = 0; i < 5; i++) {
    await clock.advance(1000);
    expect(await abovePromptText($, 30)).toBe(before);
  }
});

test('the HUD lists the agent; the band beside it keeps the counts and draws no worker row', async ($, on) => {
  await boot(on, [AGENT]);
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const shown = await abovePromptText($, 30);
  expect(shown).toContain('SUBAGENTS'); // the restored block
  expect(shown).toContain('impl-a'); // listed once, by the HUD
  expect(shown).not.toContain('implementer'); // the band's role column is gone
  expect(shown).toContain('phase 1/5');
  expect(shown).toMatch(/[◐◓◑◒] 1 running/); // the band's count agrees with the block (a working agent is running)
  expect(shown).not.toContain('queued');
  expect(shown).not.toContain('starting'); // no band worker row (its activity word)
  const tight = await abovePromptText($, 7);
  expect(tight).toContain('SUBAGENTS');
  expect(tight).not.toContain('implementer');
});

test('with no HUD (ATLAS_HUD=off) the band lists its own worker rows', async ($, on) => {
  await boot(on, [AGENT], { ATLAS_HUD: 'off' });
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const shown = await abovePromptText($, 30);
  expect(shown).not.toContain('SUBAGENTS');
  expect(shown).toContain('ATLAS');
  expect(shown).toContain('implementer'); // the band's worker row carries the role
});

test('narrow (70 columns) the HUD drops the Subagents block and the band is its one summary row', async ($, on) => {
  await boot(on, [AGENT]);
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const shown = await abovePromptText($, 30, 70);
  expect(shown).not.toContain('SUBAGENTS');
  expect(shown).toContain('ph 1/5');
  expect(shown).not.toContain('implementer');
});

test('at a starved maxRows the HUD keeps its Subagents ribbon and row, and the band folds to its one summary row', async ($, on) => {
  await boot(on, [AGENT]);
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const two = await abovePromptText($, 2);
  expect(two).toContain('SUBAGENTS'); // a running agent keeps two rows before the band keeps any
  expect(two).not.toContain('phase 1/5'); // so the band has no row left
  const three = await abovePromptText($, 3);
  expect(three).toContain('SUBAGENTS');
  expect(three).toContain('phase 1/5'); // the band's one summary row: phase position and counts
  expect(three).toMatch(/[◐◓◑◒] 1 running/);
  expect(three).not.toContain('theory'); // no rail: it would name every phase
  expect(three).not.toContain('implementer');
});

test('ATLAS_HUD=off draws no HUD rows (the band is unaffected)', async ($, on) => {
  await boot(on, [AGENT], { ATLAS_HUD: 'off' });
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  expect(await abovePromptText($, 30)).not.toContain('SUBAGENTS');
});

test('with the docked pane open (measured: viewport 143, bodyColumns 138) the band draws its full tier', async ($, on) => {
  await boot(on, [AGENT]);
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const shown = await abovePromptText($, 18, 138);
  expect(shown).toContain('ATLAS');
  expect(shown).toContain('research · phase 1/5'); // the full tier names the phase and its position; the rail is the rich form's
  expect(shown).not.toContain('theory');
});

test('ATLAS_BAND_RICH=1 reaches the host band: the full tier carries the phase rail', async ($, on) => {
  await boot(on, [AGENT], { ATLAS_BAND_RICH: '1' });
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const shown = await abovePromptText($, 18, 138);
  expect(shown).toContain('theory'); // the rail names every phase
  expect(shown).toContain('1 research'); // numbered, the first lit
});

test('ATLAS_ASCII=1 reaches the host band: the brand falls back to [ATLAS]', async ($, on) => {
  await boot(on, [AGENT], { ATLAS_ASCII: '1' });
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const shown = await abovePromptText($, 30);
  expect(shown).toContain('[ATLAS]');
  expect(shown).not.toContain('◖');
});

test('the band ctx gauge glides on the eased frames after a measure, then the timers stop', async ($, on) => {
  const clock = await boot(on, [AGENT]);
  on('session.measure', async () => ({ changed: ['context'] }) as never); // nothing beneath the plugin answers the event
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const gaugeOf = async (): Promise<string> => /ctx ([█▏▎▍▌▋▊▉░]+) /.exec(await abovePromptText($, 30))?.[1] ?? '';
  await $.session.measure({ context: { tokens: 1000, percent: 20 }, changed: ['context'] } as never);
  await clock.advance(3000); // rebuild picks the fill up; a first sight does not glide
  expect(await gaugeOf()).toBe(gaugeText(8, 0.2));
  await $.session.measure({ context: { tokens: 4000, percent: 80 }, changed: ['context'] } as never);
  const seen: string[] = [];
  for (let i = 0; i < 160; i++) {
    await clock.advance(25);
    const g = await gaugeOf();
    if (seen.at(-1) !== g) seen.push(g);
  }
  expect(seen[0]).toBe(gaugeText(8, 0.2));
  expect(seen.at(-1)).toBe(gaugeText(8, 0.8)); // lands on the figure
  expect(seen.length).toBeGreaterThanOrEqual(4); // start, at least two frames between, the end
  const fill = (g: string): number => [...g].filter((c) => c !== '░').length;
  for (let i = 1; i < seen.length; i++) expect(fill(seen[i]!)).toBeGreaterThanOrEqual(fill(seen[i - 1]!)); // it only moves toward the target
  // Landed: the gauge no longer changes (the glide timer cancelled itself).
  for (let i = 0; i < 20; i++) {
    await clock.advance(27);
    expect(await gaugeOf()).toBe(gaugeText(8, 0.8));
  }
});

test('register hands the HUD the live phase rail: the rich TODO block draws it above its progress row', async ($, on) => {
  const todos = JSON.stringify({ items: [{ id: 'a', content: 'map the auth flow', status: 'in_progress', owner: 'impl-a', session_id: 'abcdef-0000' }] });
  await boot(on, [AGENT], { ATLAS_BAND_RICH: '1' }, { '/.atlas/.run/todos.json': todos });
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const ui = await $.ui.mount({ plugin: 'atlas', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { bodyColumns: 160, hasSurvey: false, maxRows: 40 } as never });
  const rows = (await ui.findAll({})).map((n) => (n.text ?? '').trimStart());
  await ui.unmount();
  expect(rows.some((t) => t.startsWith('▸ 1 research'))).toBe(true); // a row that is the rail alone: the HUD's, not the band's (that one follows the capsule)
});

/** The Team tab's text for impl-a. */
async function teamRow($: Engine): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: { title: 'Atlas', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never });
  await ui.press({ key: 'tab:team' });
  const text = (await ui.find({ key: 'worker:impl-a' }))?.text ?? '';
  await ui.unmount();
  return text;
}

test('L13 the HUD, the band and the side panel say the same state word for a worker in the same frame', async ($, on) => {
  await boot(on, [AGENT]);
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const above = await abovePromptText($, 30);
  expect(above).toMatch(/impl-a[^"]*running/); // the HUD row
  expect(above).toMatch(/[◐◓◑◒] 1 running/); // the band's count
  expect(await teamRow($)).toMatch(/[◐◓◑◒] impl-a\s+running/); // the side panel row
  for (const text of [above, await teamRow($)]) expect(text).not.toContain('queued');
});
