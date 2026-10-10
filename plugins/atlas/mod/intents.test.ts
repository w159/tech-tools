// Tests for intentToArgv: exact argv per Intent variant, argv-head invariant,
// injection rejection, caps, and validation edges. Flags mirror the REAL CLIs:
// scripts/atlas_todo.py (status --id --status / complete --id --evidence /
// claim --id --owner / note --owner --to --channel + positional text),
// scripts/atlas_herdr.py (prompt --pane --text), scripts/atlas_mux.py (kill --run).
import { describe, expect, test } from 'claude-code/testing';
import { intentToArgv } from './intents';

const CHANNEL = 'tech-tools@main/lead-01a122'; // real format: <basename>@<branch>[/lead-<id>]
const CTX = { pluginRoot: '/plg', root: '/proj', channel: CHANNEL };
const py = (script: string) => ['python3', `/plg/scripts/${script}.py`];

const TODO = { t: 'todo.phase', id: 't1', phase: 'implement' } as const;

describe('argv head invariant', () => {
  test('every cli intent begins python3 + <pluginRoot>/scripts/<script>.py', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ t: 'todo.phase', id: 't1', phase: 'implement' }, 'atlas_todo'],
      [{ t: 'todo.claim', id: 't1', owner: 'alice' }, 'atlas_todo'],
      [{ t: 'todo.complete', id: 't1', evidence: 'bun test green' }, 'atlas_todo'],
      [{ t: 'note', to: 'lead-01a122', text: 'hello world' }, 'atlas_todo'],
      [{ t: 'steer', paneId: '3-Shell', text: 'run tests' }, 'atlas_herdr'],
      [{ t: 'stop', run: 'run-1' }, 'atlas_mux'],
    ];
    for (const [intent, script] of cases) {
      const r = intentToArgv(intent, CTX);
      if (!r.ok || r.kind !== 'cli') throw new Error(`expected cli intent: ${JSON.stringify(r)}`);
      expect(r.argv[0]).toBe('python3');
      expect(r.argv[1]).toBe(`/plg/scripts/${script}.py`);
    }
  });
});

describe('exact argv per intent variant', () => {
  test('todo.phase -> atlas_todo status --id --status --root', () => {
    expect(intentToArgv({ t: 'todo.phase', id: 't1', phase: 'implement' }, CTX)).toEqual({
      ok: true,
      kind: 'cli',
      argv: [...py('atlas_todo'), 'status', '--id', 't1', '--status', 'implement', '--root', '/proj'],
    });
  });

  test('todo.claim -> atlas_todo claim --id --owner --root', () => {
    expect(intentToArgv({ t: 'todo.claim', id: 't1', owner: 'alice' }, CTX)).toEqual({
      ok: true,
      kind: 'cli',
      argv: [...py('atlas_todo'), 'claim', '--id', 't1', '--owner', 'alice', '--root', '/proj'],
    });
  });

  test('todo.complete -> atlas_todo complete --id --evidence --root', () => {
    expect(intentToArgv({ t: 'todo.complete', id: 't1', evidence: 'bun test green' }, CTX)).toEqual({
      ok: true,
      kind: 'cli',
      argv: [...py('atlas_todo'), 'complete', '--id', 't1', '--evidence', 'bun test green', '--root', '/proj'],
    });
  });

  test('note -> atlas_todo note --root --channel --owner --to + positional text', () => {
    expect(intentToArgv({ t: 'note', to: 'lead-01a122', text: 'hello world' }, CTX)).toEqual({
      ok: true,
      kind: 'cli',
      argv: [
        ...py('atlas_todo'),
        'note',
        '--root', '/proj',
        '--channel', CHANNEL,
        '--owner', 'human',
        '--channel', CHANNEL,
        '--to', 'lead-01a122',
        'hello world',
      ],
    });
  });

  test('steer -> atlas_herdr prompt --pane --text', () => {
    expect(intentToArgv({ t: 'steer', paneId: '3-Shell', text: 'run tests' }, CTX)).toEqual({
      ok: true,
      kind: 'cli',
      argv: [...py('atlas_herdr'), 'prompt', '--pane', '3-Shell', '--text', 'run tests'],
    });
  });

  test('stop -> atlas_mux kill --run', () => {
    expect(intentToArgv({ t: 'stop', run: 'run-1' }, CTX)).toEqual({
      ok: true,
      kind: 'cli',
      argv: [...py('atlas_mux'), 'kill', '--run', 'run-1'],
    });
  });
});

describe('ui intents', () => {
  test('tab accepts every contract tab and returns kind ui', () => {
    for (const tab of ['colony', 'channel', 'board', 'squad', 'collab']) {
      expect(intentToArgv({ t: 'tab', tab }, CTX)).toEqual({ ok: true, kind: 'ui', tab });
    }
  });

  test('tab rejects unknown tabs', () => {
    expect(intentToArgv({ t: 'tab', tab: 'nope' }, CTX).ok).toBe(false);
  });

  test('inspect returns kind ui with the agent name', () => {
    expect(intentToArgv({ t: 'inspect', agent: 'explorer-1' }, CTX)).toEqual({
      ok: true,
      kind: 'ui',
      agent: 'explorer-1',
    });
  });
});

describe('injection attempts rejected', () => {
  const BAD = ['a b', 'a;b', '$(id)', '`id`', 'a\nb'];
  const targets: Array<[Record<string, unknown>, string]> = [
    [{ t: 'todo.claim', id: 'x', owner: 'ok' }, 'id'],
    [{ t: 'todo.claim', id: 'x', owner: 'ok' }, 'owner'],
    [{ t: 'todo.complete', id: 'x', evidence: 'ok' }, 'id'],
    [{ t: 'note', to: 'ok', text: 'ok' }, 'to'],
    [{ t: 'steer', paneId: 'ok', text: 'ok' }, 'paneId'],
    [{ t: 'inspect', agent: 'ok' }, 'agent'],
    [{ t: 'stop', run: 'ok' }, 'run'],
  ];

  test('spaces, ;, $(), backticks, newlines in ids/owner/to/agent/paneId/run are rejected', () => {
    for (const [base, field] of targets) {
      for (const bad of BAD) {
        const r = intentToArgv({ ...base, [field]: bad }, CTX);
        expect(r.ok).toBe(false);
      }
    }
  });

  test('injection payloads in the channel are rejected', () => {
    for (const bad of [...BAD, 'ok\nb']) {
      const r = intentToArgv({ t: 'note', to: 'ok', text: 'ok' }, { ...CTX, channel: bad });
      expect(r.ok).toBe(false);
    }
  });

  test('null channel is rejected', () => {
    expect(intentToArgv({ t: 'note', to: 'ok', text: 'ok' }, { ...CTX, channel: null }).ok).toBe(false);
  });

  test('real channel format <name>@<branch>/lead-<id> is accepted', () => {
    const r = intentToArgv({ t: 'note', to: 'ok', text: 'ok' }, { ...CTX, channel: 'tech-tools@main' });
    expect(r.ok).toBe(true);
  });
});

describe('text caps and empties', () => {
  const at2000 = 'x'.repeat(2000);
  const at2001 = 'x'.repeat(2001);
  const textTargets: Array<[Record<string, unknown>, string]> = [
    [{ t: 'note', to: 'ok', text: '' }, 'text'],
    [{ t: 'steer', paneId: 'ok', text: '' }, 'text'],
    [{ t: 'todo.complete', id: 'ok' }, 'evidence'],
  ];

  test('2000 chars accepted, 2001 rejected', () => {
    for (const [base, field] of textTargets) {
      expect(intentToArgv({ ...base, [field]: at2000 }, CTX).ok).toBe(true);
      expect(intentToArgv({ ...base, [field]: at2001 }, CTX).ok).toBe(false);
    }
  });

  test('empty and whitespace-only text rejected', () => {
    for (const [base, field] of textTargets) {
      for (const bad of ['', '   ', '\n\t']) {
        expect(intentToArgv({ ...base, [field]: bad }, CTX).ok).toBe(false);
      }
    }
  });

  test('non-string fields rejected', () => {
    for (const [base, field] of textTargets) {
      for (const bad of [undefined, null, 42, {}]) {
        expect(intentToArgv({ ...base, [field]: bad }, CTX).ok).toBe(false);
      }
    }
  });
});

describe('validation edges', () => {
  test('stop without run rejected', () => {
    expect(intentToArgv({ t: 'stop' }, CTX).ok).toBe(false);
  });

  test('unknown t rejected', () => {
    for (const bad of [{ t: 'nonsense' }, { t: '' }, {}, 'note', 42, null, undefined]) {
      expect(intentToArgv(bad, CTX).ok).toBe(false);
    }
  });

  test('unknown phase rejected', () => {
    expect(intentToArgv({ ...TODO, phase: 'nope' }, CTX).ok).toBe(false);
    expect(intentToArgv({ ...TODO, phase: undefined }, CTX).ok).toBe(false);
  });

  test('missing ids/owner/to/agent/paneId rejected', () => {
    expect(intentToArgv({ t: 'todo.claim', owner: 'ok' }, CTX).ok).toBe(false);
    expect(intentToArgv({ t: 'note', text: 'ok' }, CTX).ok).toBe(false);
    expect(intentToArgv({ t: 'inspect' }, CTX).ok).toBe(false);
    expect(intentToArgv({ t: 'steer', text: 'ok' }, CTX).ok).toBe(false);
  });
});
