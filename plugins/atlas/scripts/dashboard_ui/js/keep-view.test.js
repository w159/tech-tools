import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { changeKey, keepView, readableTranscript } from './keep-view.js';

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

// ---- keepView: a small DOM double that is faithful enough for patchInto's reconcile ----
const attrsOf = (el) => Object.entries(el.attrs).map(([name, value]) => ({ name, value }));
class FakeNode {
  constructor(nodeType, tagName, text) {
    this.nodeType = nodeType;
    this.tagName = tagName;
    this.nodeValue = text;
    this.attrs = {};
    this.childNodes = [];
    this.parentNode = null;
  }
  get attributes() { return attrsOf(this); }
  get dataset() {
    const out = {};
    for (const [k, v] of Object.entries(this.attrs)) if (k.startsWith('data-')) out[k.slice(5)] = v;
    return out;
  }
  get open() { return 'open' in this.attrs; }
  set open(v) { if (v) this.attrs.open = ''; else delete this.attrs.open; }
  get isConnected() { return true; }
  setAttr(k, v) { this.attrs[k] = v; return this; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; }
  removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); c.parentNode = null; return c; }
  replaceChild(nu, old) {
    if (nu.parentNode) nu.parentNode.removeChild(nu);
    this.childNodes = this.childNodes.map((x) => (x === old ? nu : x));
    nu.parentNode = this;
    old.parentNode = null;
    return old;
  }
  cloneNode(deep) {
    const c = new FakeNode(this.nodeType, this.tagName, this.nodeValue);
    c.attrs = { ...this.attrs };
    if (deep) for (const k of this.childNodes) c.appendChild(k.cloneNode(true));
    return c;
  }
  isEqualNode(o) {
    if (this.nodeType !== o.nodeType || this.tagName !== o.tagName || this.nodeValue !== o.nodeValue) return false;
    if (JSON.stringify(this.attrs) !== JSON.stringify(o.attrs) || this.childNodes.length !== o.childNodes.length) return false;
    return this.childNodes.every((k, i) => k.isEqualNode(o.childNodes[i]));
  }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  matches(sel) {
    return sel.split(',').some((part) => {
      const m = part.trim().match(/^([a-z]*)((?:\[[a-z-]+\])*)$/);
      if (!m || this.nodeType !== 1) return false;
      if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
      return [...m[2].matchAll(/\[([a-z-]+)\]/g)].every((a) => a[1] in this.attrs);
    });
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => n.childNodes.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((c) => c.textContent).join(''); }
}
const el = (tag, attrs = {}, ...kids) => {
  const n = new FakeNode(1, tag.toUpperCase());
  Object.assign(n.attrs, attrs);
  kids.forEach((k) => n.appendChild(typeof k === 'string' ? new FakeNode(3, '#text', k) : k));
  return n;
};

describe('keepView', () => {
  let saved;
  beforeEach(() => {
    saved = globalThis.document;
    globalThis.document = { getElementById: () => null, activeElement: null };
  });
  afterEach(() => { globalThis.document = saved; });

  test('fill gets an empty shallow twin of the mount and the mount ends up with exactly the new content', () => {
    const mount = el('div', { id: 'm' }, el('p', {}, 'old one'), el('p', {}, 'old two'));
    let seen;
    keepView(mount, (twin) => {
      seen = { children: twin.childNodes.length, isMount: twin === mount, id: twin.attrs.id };
      twin.appendChild(el('p', {}, 'fresh'));
    });
    expect(seen).toEqual({ children: 0, isMount: false, id: 'm' });
    expect(mount.childNodes.length).toBe(1);
    expect(mount.textContent).toBe('fresh');
  });

  test('open data-keep details stay open and closed ones stay closed when the reconcile replaces their nodes', () => {
    const mount = el('div', {},
      el('details', { 'data-keep': 'a', open: '' }, el('summary', {}, 'A')),
      el('details', { 'data-keep': 'b' }, el('summary', {}, 'B')));
    keepView(mount, (twin) => {
      // A different class makes the structure differ so patchInto swaps the node; the twin's own open state is the reverse.
      twin.appendChild(el('details', { 'data-keep': 'a', class: 'v2' }, el('summary', {}, 'A2')));
      twin.appendChild(el('details', { 'data-keep': 'b', class: 'v2', open: '' }, el('summary', {}, 'B2')));
    });
    const [a, b] = mount.querySelectorAll('details[data-keep]');
    expect(a.textContent).toBe('A2');
    expect(a.open).toBe(true);
    expect(b.textContent).toBe('B2');
    expect(b.open).toBe(false);
  });

  test('details without data-keep are left to the reconcile (not forced closed)', () => {
    const mount = el('div', {}, el('details', {}, el('summary', {}, 'x')));
    mount.childNodes[0].open = true;
    keepView(mount, (twin) => twin.appendChild(el('details', {}, el('summary', {}, 'x'))));
    // identical structure: carried, not reset
    expect(mount.querySelectorAll('details')[0].open).toBe(true);
  });
});

test('changeKey drops every volatile clock key at any depth and keeps real fields', () => {
  const volatile = ['checked_at', 'as_of', 'last_ok', 'idle_seconds', 'generated_at', 'now', 'age_seconds', 't'];
  for (const k of volatile) {
    expect(changeKey({ id: 1, [k]: 'a', nest: { [k]: 'b', v: 1 } })).toBe(changeKey({ id: 1, [k]: 'zzz', nest: { v: 1 } }));
    expect(changeKey({ id: 1, [k]: 'a' })).toBe('{"id":1}');
  }
  expect(changeKey({ id: 1, status: 'ok' })).not.toBe(changeKey({ id: 1, status: 'bad' }));
  expect(changeKey({ time: 1 })).toBe('{"time":1}');
});

test('readableTranscript labels omp toolCall and tool_result parts, with a default name', () => {
  const text = [
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'Bash' }, { type: 'toolCall' }, { type: 'tool_use' }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'big' }, { type: 'mystery' }] } }),
  ].join('\n');
  expect(readableTranscript(text)).toEqual([
    { who: 'assistant', text: '→ Bash → tool → tool' },
    { who: 'user', text: '← tool result' },
  ]);
});

test('readableTranscript reads thinking parts, bare string parts and collapses whitespace', () => {
  const text = [
    JSON.stringify({ role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm\n  deep' }, 'plain', null, { type: 'text', text: '' }] }),
    JSON.stringify({ type: 'system', content: '  a \t b\n c ' }),
  ].join('\n');
  expect(readableTranscript(text)).toEqual([
    { who: 'assistant', text: 'hmm deep plain' },
    { who: 'system', text: 'a b c' },
  ]);
});

test('readableTranscript clips long text at 280 chars with an ellipsis, exactly 280 is kept', () => {
  const exact = 'x'.repeat(280);
  const long = 'y'.repeat(281);
  const out = readableTranscript([JSON.stringify({ role: 'user', content: exact }), JSON.stringify({ role: 'user', content: long }), 'z'.repeat(300)].join('\n'));
  expect(out[0].text).toBe(exact);
  expect(out[1].text).toBe(`${'y'.repeat(280)}…`);
  expect(out[2]).toEqual({ who: '?', text: `${'z'.repeat(280)}…` });
});

test('readableTranscript shows scalar JSON lines raw, skips blank lines and entries with no readable body', () => {
  const text = ['42', 'null', '', '   ', JSON.stringify({ role: 'user', content: [] }), JSON.stringify({ role: 'user', content: 7 }), JSON.stringify({ type: 'x', message: 'str' })].join('\n');
  expect(readableTranscript(text)).toEqual([{ who: '?', text: '42' }, { who: '?', text: 'null' }]);
  expect(readableTranscript(undefined)).toEqual([]);
  expect(readableTranscript(null)).toEqual([]);
});

test('readableTranscript prefers message.role, then the entry type, then a question mark', () => {
  const text = [
    JSON.stringify({ type: 'outer', message: { role: 'inner', content: 'a' } }),
    JSON.stringify({ type: 'outer', message: { content: 'b' } }),
    JSON.stringify({ content: 'c' }),
  ].join('\n');
  expect(readableTranscript(text).map((e) => e.who)).toEqual(['inner', 'outer', '?']);
});
