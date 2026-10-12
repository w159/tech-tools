// Tests for mod/data/sessions.ts: transcript tail, mux rows, merge, id -> label.
import { describe, expect, test } from 'claude-code/testing';
import { labelFor, mergeSessions, parseMuxStatus, parseTranscript, projectSlug, stripAnsi, subagentSession, transcriptPath } from './sessions';

const asst = (content: unknown[]) => JSON.stringify({ type: 'assistant', message: { content } });
const user = (content: unknown[]) => JSON.stringify({ type: 'user', message: { content } });

describe('parseTranscript', () => {
  test('last assistant text lines, ANSI stripped, in-flight tool last', () => {
    const jsonl = [
      '{"cut":"half a line from the tail window"', // malformed: skipped
      asst([{ type: 'text', text: 'reading \u001b[31mauth\u001b[0m files\nfound 3 call sites' }]),
      asst([{ type: 'tool_use', id: 't1', name: 'Grep', input: {} }]),
      user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
      asst([{ type: 'text', text: 'x'.repeat(300) }]),
      asst([{ type: 'tool_use', id: 't2', name: 'Edit', input: {} }]),
      '{"type":"attachment"}',
    ].join('\n');
    const { tail, tool } = parseTranscript(jsonl);
    expect(tool).toBe('Edit');
    expect(tail).toHaveLength(4);
    expect(tail[0]).toBe('reading auth files');
    expect(tail[2]?.length).toBe(120);
    expect(tail[3]).toBe('> Edit');
  });

  test('finished tool: no in-flight line; max 4 lines; garbage => empty', () => {
    const lines = Array.from({ length: 6 }, (_, i) => asst([{ type: 'text', text: `line ${i}` }]));
    expect(parseTranscript(lines.join('\n')).tail).toEqual(['line 2', 'line 3', 'line 4', 'line 5']);
    expect(parseTranscript('not json at all')).toEqual({ tail: [], tool: null });
  });
});

describe('parseMuxStatus', () => {
  test('workers become sessions with transport, state and tail', () => {
    const out = JSON.stringify({ ok: true, transport: 'claude-bg', workers: [
      { name: 'e2e-s11', dead: 0, pid: 'bf184718', state: 'blocked', tail: 'waiting\nfor input' },
      { name: 'e2e-s14', dead: 1, pid: '06cb7fa8', state: 'completed', tail: '' },
    ] });
    expect(parseMuxStatus(out, 5)).toEqual([
      { name: 'e2e-s11', transport: 'claude-bg', state: 'blocked', since: 5, tail: ['waiting', 'for input'], pid: 'bf184718' },
      { name: 'e2e-s14', transport: 'claude-bg', state: 'done', since: 5, tail: [], pid: '06cb7fa8' },
    ]);
  });
  test('malformed output is no sessions', () => {
    expect(parseMuxStatus('boom', 0)).toEqual([]);
    expect(parseMuxStatus('{"workers":5}', 0)).toEqual([]);
  });
});

describe('sessions plumbing', () => {
  test('merge de-duplicates by name, first source wins', () => {
    const a = subagentSession({ id: 'a529730494759bac3', status: 'running' }, 'explorer', ['hi'], 1);
    const b = { ...a, name: 'explorer', transport: 'tmux' as const };
    const c = { ...a, name: 'other' };
    expect(mergeSessions([a], [b, c]).map((s) => [s.name, s.transport])).toEqual([['explorer', 'subagent'], ['other', 'subagent']]);
  });
  test('id -> label: mapped name, else raw id truncated to 6, labels untouched', () => {
    expect(labelFor('a529730494759bac3', { a529730494759bac3: 'explorer' })).toBe('explorer');
    expect(labelFor('a529730494759bac3', {})).toBe('a52973');
    expect(labelFor('impl-auth', {})).toBe('impl-auth');
  });
  test('transcript path uses the cwd slug', () => {
    expect(projectSlug('/Users/j/a.b~c/x')).toBe('-Users-j-a-b-c-x');
    expect(transcriptPath('/h/', '/p/q', 'S', 'ag')).toBe('/h/.claude/projects/-p-q/S/subagents/agent-ag.jsonl');
    expect(stripAnsi('\u001b[1mbold\u001b[0m')).toBe('bold');
  });
});

// Real shape of ~/.claude/projects/<slug>/<lead session id>/subagents/agent-<agentId>.jsonl (redacted, trimmed from an atlas:explorer run).
const REAL_SUBAGENT_JSONL = [
  '{"parentUuid":null,"isSidechain":true,"agentId":"a06f54fc229f1c245","type":"user","message":{"role":"user","content":"ROLE: read-only explorer (name: explore-session-tail) GOAL: Explain how sessions.ts builds the tail lines"},"sessionId":"0460bbb5-0000-0000-0000-000000000000"}',
  '{"parentUuid":"b4cc2a13","isSidechain":true,"agentId":"a06f54fc229f1c245","type":"attachment","attachment":{"type":"skill_listing"},"sessionId":"0460bbb5-0000-0000-0000-000000000000"}',
  '{"parentUuid":"b29b8fa5","isSidechain":true,"agentId":"a06f54fc229f1c245","message":{"model":"claude-sonnet-5-5","role":"assistant","content":[{"type":"text","text":"Need register.ts I/O side."}],"stop_reason":null},"type":"assistant","sessionId":"0460bbb5-0000-0000-0000-000000000000"}',
  '{"parentUuid":"c1","isSidechain":true,"agentId":"a06f54fc229f1c245","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_01Nwd1J7YLXhDFhDPPx2nzGP","name":"mcp__lean-ctx__ctx_search","input":{"pattern":"TAIL_BYTES|parseTranscript"},"caller":{"type":"direct"}}]},"type":"assistant","sessionId":"0460bbb5-0000-0000-0000-000000000000"}',
  '{"parentUuid":"c2","isSidechain":true,"agentId":"a06f54fc229f1c245","message":{"role":"user","content":[{"tool_use_id":"toolu_01Nwd1J7YLXhDFhDPPx2nzGP","type":"tool_result","content":[{"type":"text","text":"5 matches in 1 files"}]}]},"type":"user","sessionId":"0460bbb5-0000-0000-0000-000000000000"}',
  '{"parentUuid":"c3","isSidechain":true,"agentId":"a06f54fc229f1c245","message":{"role":"assistant","content":[{"type":"text","text":"Reading the pane next."},{"type":"tool_use","id":"toolu_015vwBDbVxsRH19msdp18mn2","name":"mcp__lean-ctx__ctx_read","input":{"mode":"lines:240-300"}}]},"type":"assistant","sessionId":"0460bbb5-0000-0000-0000-000000000000"}',
].join('\n');

describe('real subagent transcript', () => {
  test('tail is the worker output (text lines + in-flight tool), not the task description in the first user row', () => {
    const { tail, tool } = parseTranscript(REAL_SUBAGENT_JSONL);
    expect(tail).toEqual(['Need register.ts I/O side.', 'Reading the pane next.', '> mcp__lean-ctx__ctx_read']);
    expect(tool).toBe('mcp__lean-ctx__ctx_read');
    expect(tail.join(' ')).not.toContain('ROLE:');
  });
  test('layout is <slug>/<lead session id>/subagents/agent-<agentId>.jsonl, the id as $.agent.list gives it', () => {
    expect(transcriptPath('/Users/jerry', '/Users/jerry/MEGA/Projects/Agentic/tech-tools', '0460bbb5-58f3-4a5e-969a-3eb0eb109983', 'a06f54fc229f1c245')).toBe(
      '/Users/jerry/.claude/projects/-Users-jerry-MEGA-Projects-Agentic-tech-tools/0460bbb5-58f3-4a5e-969a-3eb0eb109983/subagents/agent-a06f54fc229f1c245.jsonl',
    );
  });
  test('no transcript yet: empty tail', () => {
    expect(parseTranscript('').tail).toEqual([]);
  });
});

describe('characterization: parseTranscript edge rows', () => {
  test('open tool_use without name defaults to "tool"; closed tools vanish; last open wins', () => {
    const jsonl = [
      asst([{ type: 'tool_use', id: 't1' }]),
      asst([{ type: 'tool_use', id: 't2', name: 'Bash' }, { type: 'text', text: 'running' }]),
      user([{ type: 'tool_result', tool_use_id: 't1' }]),
      asst([{ type: 'tool_use', id: 't3', name: 'Grep' }]),
    ].join('\n');
    expect(parseTranscript(jsonl)).toEqual({ tail: ['running', '> Grep'], tool: 'Grep' });
  });
  test('ignores non-array content, wrong roles, non-string fields and blank text lines', () => {
    const jsonl = [
      JSON.stringify({ type: 'assistant', message: { content: 'plain' } }),
      JSON.stringify({ type: 'system', message: { content: [{ type: 'text', text: 'nope' }] } }),
      asst([{ type: 'text', text: 42 }, { type: 'tool_use', id: 7, name: 'X' }, { type: 'text', text: 'a\n\n  \nb' }]),
      user([{ type: 'text', text: 'user text ignored' }, { type: 'tool_result', tool_use_id: 9 }]),
      ' {"leading":"space"}',
    ].join('\n');
    expect(parseTranscript(jsonl)).toEqual({ tail: ['a', 'b'], tool: null });
  });
  test('long lines clip at 120 chars with ellipsis; tail is 3 lines when a tool is open', () => {
    const long = 'x'.repeat(200);
    const jsonl = [asst([{ type: 'text', text: `1\n2\n3\n${long}` }, { type: 'tool_use', id: 'z', name: 'Read' }])].join('\n');
    const r = parseTranscript(jsonl);
    expect(r.tool).toBe('Read');
    expect(r.tail).toEqual(['2', '3', `${'x'.repeat(119)}…`, '> Read']);
  });
});

describe('characterization: parseMuxStatus edge rows', () => {
  test('transport, state mapping, dead override, pid and tail handling', () => {
    const out = JSON.stringify({
      transport: 'herdr',
      workers: [
        { name: 'a', state: 'WORKING', pid: 12, tail: 'l1\n\n\u001b[31ml2\u001b[0m\nl3\nl4\nl5' },
        { name: 'b', dead: true, state: 'error' },
        { name: 'c', dead: true, state: 'running' },
        { name: 'd', state: 'weird' },
        { name: '', state: 'idle' },
        { state: 'idle' },
        null,
        { name: 'e', state: 'waiting', pid: 0, tail: 5 },
      ],
    });
    expect(parseMuxStatus(out, 9)).toEqual([
      { name: 'a', transport: 'herdr', state: 'running', since: 9, tail: ['l2', 'l3', 'l4', 'l5'], pid: '12' },
      { name: 'b', transport: 'herdr', state: 'failed', since: 9, tail: [] },
      { name: 'c', transport: 'herdr', state: 'done', since: 9, tail: [] },
      { name: 'd', transport: 'herdr', state: 'running', since: 9, tail: [] },
      { name: 'e', transport: 'herdr', state: 'blocked', since: 9, tail: [] },
    ]);
  });
  test('unknown transport falls back to claude-bg; missing workers => []', () => {
    expect(parseMuxStatus('{"transport":"zzz","workers":[{"name":"q"}]}', 1)[0]?.transport).toBe('claude-bg');
    expect(parseMuxStatus('{}', 1)).toEqual([]);
  });
});
