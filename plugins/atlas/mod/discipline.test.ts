// Tests for discipline.ts: each rule fires, each fails open, the kill switch and
// headless gate silence it, and toasts are rate-limited.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { BIG_TURN_TOKENS, HEAVY_CHARS, HEAVY_LIMIT, TOAST_GAP_MS, factsLine, isVague, disciplinePrompt, reinforceLine, registerDiscipline } from './discipline';
import { memState } from './test_helpers';
import { leadBusy } from './data/runstate';

describe('reinforceLine', () => {
  test('carries the contract template and phase, never the regex', () => {
    const line = reinforceLine('ATLAS | <glyph> <phase> | <state>', 'verify');
    expect(line).toContain('ATLAS | <glyph> <phase> | <state>');
    expect(line).toContain('verify');
    expect(line).not.toContain('\\S');
    expect(line.length).toBeLessThan(110);
  });
  test('names the header in words when the contract carries no template', () => {
    expect(reinforceLine(undefined, 'research')).toContain('the ATLAS status header');
  });
});

/** register.ts owns the one prompt.submit hook and calls disciplinePrompt from it; the tests stand in for that hook. */
function wire(hooks: Map<string, Hook>, reinforce: () => string | null): void {
  const deps = { reinforce };
  registerDiscipline(((event: string, a: unknown, b?: unknown) => hooks.set(event, (b ?? a) as Hook)) as unknown as On, deps);
  hooks.set('prompt.submit', ($, e, next) => disciplinePrompt($, e as { text: string }, next as never, deps));
}

type Hook = ($: EngineInterface, e: unknown, next: (i: unknown) => Promise<unknown>) => Promise<unknown>;
const PATTERN = '^ATLAS \\| \\S+ \\w+';
const GOOD = 'ATLAS | 🔨 implement | go';
const snapshot = {
  root: '/repo',
  phase: 'implement',
  contract: { headerFirstLinePattern: PATTERN },
  todos: [
    { id: 't1', content: 'wire the gate', status: 'pending' },
    { id: 't2', content: 'old thing', status: 'completed' },
  ],
};

function setup(opts: { modOn?: boolean; interactive?: boolean; gitFails?: boolean } = {}) {
  const hooks = new Map<string, Hook>();
  wire(hooks, () => 'reinforce-line');
  const rec = { toasts: [] as string[], now: 1_000_000 };
  const $ = {
    state: memState({
      'atlas/isModOn': opts.modOn ?? true,
      'atlas/isInteractive': opts.interactive ?? true,
      'atlas/snapshot': snapshot,
    }),
    clock: { now: async () => rec.now },
    ui: { toast: (t: string) => rec.toasts.push(t) },
    process: {
      run: async () => {
        if (opts.gitFails) throw new Error('no git');
        return { exitCode: 0, stdout: 'feat/x\n', stderr: '' };
      },
    },
  } as unknown as EngineInterface;
  const call = (tool: string, textLen: number, extra: Record<string, unknown> = {}) =>
    hooks.get('tool.call')!($, { tool, ...extra }, async () => ({ result: {}, text: 'x'.repeat(textLen) }));
  const answer = (text: string, extra: Record<string, unknown> = {}) =>
    hooks.get('turn.complete')!($, { reason: 'answer', isAborted: false, answer: text, ...extra }, async (e) => e);
  const submit = async (text: string, extra: Record<string, unknown> = {}) => {
    let seen: { context?: string[] } = {};
    await hooks.get('prompt.submit')!($, { text, ...extra }, async (e) => ((seen = e as typeof seen), e));
    return seen;
  };
  return { $, rec, call, answer, submit };
}

describe('heavy inline meter', () => {
  test('toasts once at the limit', async () => {
    const { rec, call } = setup();
    for (let i = 0; i < HEAVY_LIMIT + 2; i++) await call('Read', HEAVY_CHARS);
    expect(rec.toasts).toHaveLength(1);
    expect(rec.toasts[0]).toContain('atlas:explorer');
  });

  test('light calls, subagent calls and a delegation never count', async () => {
    const { rec, call, answer } = setup();
    for (let i = 0; i < 6; i++) await call('Read', HEAVY_CHARS - 1);
    for (let i = 0; i < 6; i++) await call('Read', HEAVY_CHARS, { agentId: 'a1' });
    for (let i = 0; i < HEAVY_LIMIT - 1; i++) await call('Bash', HEAVY_CHARS);
    await call('Agent', 10);
    await call('Bash', HEAVY_CHARS);
    await answer(GOOD);
    expect(rec.toasts).toEqual([]);
  });

  test('ATLAS_MOD=off and headless sessions stay silent', async () => {
    for (const opts of [{ modOn: false }, { interactive: false }]) {
      const { rec, call, answer, submit } = setup(opts);
      for (let i = 0; i < HEAVY_LIMIT; i++) await call('Read', HEAVY_CHARS);
      await answer('no header');
      expect((await submit('fix it')).context).toBeUndefined();
      expect(rec.toasts).toEqual([]);
      }
  });

  test('fails open: a throwing engine never breaks the tool, the answer or the prompt', async () => {
    const { rec, call, answer, submit } = setup();
    const e = { tool: 'Read', reason: 'answer', isAborted: false, answer: 'x', text: 'fix it' };
    const broken = { state: { get: async () => { throw new Error('boom'); } } } as unknown as EngineInterface;
    const hooks = new Map<string, Hook>();
    wire(hooks, () => null);
    for (const ev of ['tool.call', 'turn.complete', 'prompt.submit']) {
      expect(await hooks.get(ev)!(broken, e, async (i) => i)).toBeDefined();
    }
    expect(await call('Read', HEAVY_CHARS)).toEqual({ result: {}, text: 'x'.repeat(HEAVY_CHARS) });
    expect((await answer(GOOD)) as unknown).toBeDefined();
    expect((await submit('fix it')).context).toBeDefined();
    expect(rec.toasts).toEqual([]);
  });
});

describe('critique 12 B5: a submitted prompt is a busy lead from the submit, not from the first model step', () => {
  test('prompt.submit marks the lead thinking, so the band never reads idle while the host spinner shows (f0015)', async () => {
    const { $, submit } = setup();
    const lead = async () => ((await $.state.get({ plugin: 'atlas', key: 'orch' } as never)).value as { activity?: Record<string, { mood?: string }> } | undefined)?.activity?.lead;
    expect(await lead()).toBeUndefined();
    await submit('write the report');
    expect((await lead())?.mood).toBe('thinking');
    expect(leadBusy({ activity: { lead: await lead() } })).toBe(true);
  });
  test('a failing state read never blocks the prompt', async () => {
    const hooks = new Map<string, Hook>();
    wire(hooks, () => null);
    const broken = { state: { get: async () => { throw new Error('boom'); } }, clock: { now: async () => { throw new Error('boom'); } } } as unknown as EngineInterface;
    expect(await hooks.get('prompt.submit')!(broken, { text: 'go' }, async (i) => i)).toBeDefined();
  });
});

describe('contract drift + token growth', () => {
  test('a main-loop answer without the header toasts; a good header and subagents do not', async () => {
    const { rec, answer } = setup();
    await answer(GOOD);
    await answer('no header here', { agentId: 'agent-1' });
    expect(rec.toasts).toEqual([]);
    await answer('no header here');
    expect(rec.toasts).toEqual([expect.stringContaining('missing the ATLAS')]);
  });

  test('toasts are rate-limited', async () => {
    const { rec, answer } = setup();
    await answer('bad');
    await answer('bad');
    expect(rec.toasts).toHaveLength(1);
    rec.now += TOAST_GAP_MS;
    await answer('bad');
    expect(rec.toasts).toHaveLength(2);
  });

  test('a turn that added many tokens inline without delegating toasts', async () => {
    const { rec, call, answer } = setup();
    await call('Read', HEAVY_CHARS);
    await answer(GOOD, { usage: { input_tokens: 100, cache_creation_input_tokens: BIG_TURN_TOKENS } });
    expect(rec.toasts).toEqual([expect.stringContaining('30k tokens')]);
  });
});

describe('prompt sharpening', () => {
  test('vague prompt gets facts plus the reinforce line; text untouched', async () => {
    const { submit } = setup();
    const out = await submit('fix it');
    expect(out).toMatchObject({ text: 'fix it' });
    expect(out.context).toEqual(['reinforce-line', expect.stringContaining('branch feat/x')]);
    expect(out.context?.[1]).toContain('open todos: wire the gate');
    expect(out.context?.[1]).not.toContain('old thing');
  });

  test('specific, slash, quoted and non-composer prompts get no facts', async () => {
    const { submit } = setup();
    for (const text of ['/atlas-cc', 'fix "it"', 'summarize everything under plugins/atlas/hooks']) {
      expect((await submit(text)).context).toEqual(['reinforce-line']);
    }
    expect((await submit('fix it', { origin: { kind: 'peer' } })).context).toEqual(['reinforce-line']);
  });

  test('git failure fails open: the prompt still goes through', async () => {
    const { submit } = setup({ gitFails: true });
    expect((await submit('fix it')).context).toEqual(['reinforce-line']);
  });

  test('pure helpers', () => {
    expect(isVague('make it better')).toBe(true);
    expect(isVague('add retries to src/api.ts')).toBe(false);
    expect(isVague('')).toBe(false);
    expect(factsLine(null, 'main')).toBeNull();
  });
});
