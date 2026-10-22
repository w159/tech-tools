import { patchInto } from './dom.js';

// Re-render a page region in place: `fill(twin)` builds the new content into a
// detached twin and patchInto reconciles it, so scroll, focus, typed text and
// open <details> survive. data-keep details are re-applied in case the
// reconcile replaced their node.
export function keepView(mount, fill) {
  const open = new Set([...mount.querySelectorAll('details[data-keep][open]')].map((d) => d.dataset.keep));
  const twin = mount.cloneNode(false);
  fill(twin);
  patchInto(mount, twin);
  for (const d of mount.querySelectorAll('details[data-keep]')) d.open = open.has(d.dataset.keep);
}

// A stable change key for a polled payload: volatile clocks and time-bucket
// timestamps are dropped, so an identical refetch leaves the DOM alone.
const VOLATILE = new Set(['checked_at', 'as_of', 'last_ok', 'idle_seconds', 'generated_at', 'now', 'age_seconds', 't']);
export function changeKey(value) {
  return JSON.stringify(value, (k, v) => (VOLATILE.has(k) ? undefined : v));
}

// Turn a transcript tail (JSONL text, claude or omp) into short readable lines.
// Unparseable lines are shown clipped, never dropped.
const clip = (s, n = 280) => (s.length > n ? `${s.slice(0, n)}…` : s);

const PART_LABEL = { tool_use: (p) => `→ ${p.name || 'tool'}`, toolCall: (p) => `→ ${p.name || 'tool'}`, tool_result: () => '← tool result' };

function partText(p) {
  if (!p || typeof p !== 'object') return String(p || '');
  if (p.type === 'text' || p.type === 'thinking') return p.text || p.thinking || '';
  const label = PART_LABEL[p.type];
  return label ? label(p) : '';
}

function bodyOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(partText).filter(Boolean).join(' ');
}

function parseLine(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function entryOf(raw) {
  const obj = parseLine(raw);
  if (!obj || typeof obj !== 'object') return { who: '?', text: clip(raw) };
  const msg = obj.message && typeof obj.message === 'object' ? obj.message : obj;
  const body = bodyOf(msg.content);
  if (!body) return null;
  return { who: msg.role || obj.type || '?', text: clip(body.replace(/\s+/g, ' ').trim()) };
}

export function readableTranscript(text, max = 40) {
  const lines = String(text || '').split('\n').filter((l) => l.trim());
  return lines.slice(-max).map(entryOf).filter(Boolean);
}
