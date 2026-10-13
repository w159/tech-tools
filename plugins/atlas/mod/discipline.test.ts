// Tests for discipline.ts: each rule fires, each fails open, the kill switch and
// headless gate silence it, and toasts are rate-limited.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { BIG_TURN_TOKENS, HEAVY_CHARS, HEAVY_LIMIT, TOAST_GAP_MS, factsLine, isVague, registerDiscipline } from './discipline';
import { memState } from './test_helpers';

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
  const on = ((event: string, a: unknown, b?: unknown) => hooks.set(event, (b ?? a) as Hook)) as unknown as On;
  registerDiscipline(on, { reinforce: () => 'reinforce-line' });
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
    registerDiscipline(((ev: string, a: unknown, b?: unknown) => hooks.set(ev, (b ?? a) as Hook)) as unknown as On, { reinforce: () => null });
    for (const ev of ['tool.call', 'turn.complete', 'prompt.submit']) {
      expect(await hooks.get(ev)!(broken, e, async (i) => i)).toBeDefined();
    }
    expect(await call('Read', HEAVY_CHARS)).toEqual({ result: {}, text: 'x'.repeat(HEAVY_CHARS) });
    expect((await answer(GOOD)) as unknown).toBeDefined();
    expect((await submit('fix it')).context).toBeDefined();
    expect(rec.toasts).toEqual([]);
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
