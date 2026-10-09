import { test, expect } from 'bun:test';
import { changeKey, readableTranscript } from './keep-view.js';

test('changeKey ignores clocks and history bucket times but sees real changes', () => {
  const a = { checked_at: 'x', subsystems: [{ id: 'db', last_ok: '1', history: [{ t: 'a', ok: 1 }] }] };
  const b = { checked_at: 'y', subsystems: [{ id: 'db', last_ok: '2', history: [{ t: 'b', ok: 1 }] }] };
  const c = { checked_at: 'y', subsystems: [{ id: 'db', last_ok: '2', history: [{ t: 'b', ok: 2 }] }] };
  expect(changeKey(a)).toBe(changeKey(b));
  expect(changeKey(a)).not.toBe(changeKey(c));
});

test('readableTranscript reads claude, omp and garbage lines', () => {
  const text = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'fix the bug' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'on it' }, { type: 'tool_use', name: 'Edit' }] } }),
    'not json at all',
    JSON.stringify({ type: 'meta' }),
  ].join('\n');
  const out = readableTranscript(text);
  expect(out).toEqual([
    { who: 'user', text: 'fix the bug' },
    { who: 'assistant', text: 'on it → Edit' },
    { who: '?', text: 'not json at all' },
  ]);
});

test('readableTranscript keeps only the last N lines', () => {
  const text = Array.from({ length: 100 }, (_, i) => JSON.stringify({ role: 'user', content: `m${i}` })).join('\n');
  const out = readableTranscript(text, 5);
  expect(out.length).toBe(5);
  expect(out[4].text).toBe('m99');
});
