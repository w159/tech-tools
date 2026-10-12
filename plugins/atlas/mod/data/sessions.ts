// Worker sessions for the Atlas mod: subagent transcript tails, atlas_mux.py
// worker rows, de-duplicated by name. Pure (register.ts does the I/O: it reads a
// bounded transcript tail with `tail -c` and runs atlas_mux.py). Never throws.
import type { Session } from '../orchestra-types';

const MAX_TAIL = 4;
const MAX_LINE = 120;
/** Bytes of a transcript's end that register.ts reads (a JSONL line can be huge; a cut first line is dropped). */
export const TAIL_BYTES = 131_072;

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|[\u0000-\u0008\u000b-\u001f\u007f]/g;
export const stripAnsi = (s: string): string => s.replace(ANSI, '');

const clip = (s: string): string => {
 const t = stripAnsi(s).replace(/\s+/g, ' ').trim();
 return t.length > MAX_LINE ? `${t.slice(0, MAX_LINE - 1)}…` : t;
};

/** A raw host agent id (`a529730494759bac3`) as opposed to a human label. */
const RAW_ID = /^a?[0-9a-f]{16}$/;

/** Human label for an id: mapped name, else a label unchanged, else a raw id truncated to 6 chars. */
export function labelFor(id: string, names: Record<string, string>): string {
 const n = names[id];
 if (n !== undefined && n !== '') return n;
 return RAW_ID.test(id) ? id.slice(0, 6) : id;
}

/** `~/.claude/projects/<slug>` slug of a cwd: every non-alphanumeric becomes '-'. */
export const projectSlug = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-');

export const transcriptPath = (home: string, cwd: string, sessionId: string, agentId: string): string =>
 `${home.replace(/\/+$/, '')}/.claude/projects/${projectSlug(cwd)}/${sessionId}/subagents/agent-${agentId}.jsonl`;

type Block = { type?: string; text?: string; id?: string; name?: string; tool_use_id?: string };
type Scan = { lines: string[]; open: Map<string, string> }; // open: tool_use id -> name, until its tool_result arrives

type Row = { type?: string; message?: { content?: unknown } };

/** A JSONL object row; anything else (blank, cut, malformed) is an empty row. */
function parseRow(raw: string): Row {
 try {
  return raw.startsWith('{') ? (JSON.parse(raw) as Row) : {};
 } catch {
  return {};
 }
}

/** Role and content blocks of one row; content-less rows have no blocks. */
function rowBlocks(raw: string): { role?: string; blocks: Block[] } {
 const row = parseRow(raw);
 const content = row.message?.content;
 return { role: row.type, blocks: Array.isArray(content) ? (content as Block[]) : [] };
}

function pushTextLines(text: string, lines: string[]): void {
 for (const l of text.split('\n')) if (clip(l) !== '') lines.push(clip(l));
}

/** Block handlers keyed `<row type>:<block type>`. */
const BLOCK: Record<string, (c: Block, scan: Scan) => void> = {
 'assistant:text': (c, scan) => { if (typeof c.text === 'string') pushTextLines(c.text, scan.lines); },
 'assistant:tool_use': (c, scan) => { if (typeof c.id === 'string') scan.open.set(c.id, c.name ?? 'tool'); },
 'user:tool_result': (c, scan) => { if (typeof c.tool_use_id === 'string') scan.open.delete(c.tool_use_id); },
};

function scanRow(raw: string, scan: Scan): void {
 const { role, blocks } = rowBlocks(raw);
 for (const c of blocks) BLOCK[`${role}:${c?.type}`]?.(c, scan);
}

/** Newest lines, leaving room for the in-flight tool line. */
function tailOf(lines: string[], tool: string | null): string[] {
 const tail = lines.slice(-(tool === null ? MAX_TAIL : MAX_TAIL - 1));
 if (tool !== null) tail.push(`> ${tool}`);
 return tail;
}

/**
 * Last assistant text lines and the in-flight tool of a transcript tail
 * (JSONL, newest last). Malformed or cut lines are skipped.
 */
export function parseTranscript(text: string): { tail: string[]; tool: string | null } {
 const scan: Scan = { lines: [], open: new Map() };
 for (const raw of text.split('\n')) scanRow(raw, scan);
 const tool = [...scan.open.values()].pop() ?? null;
 return { tail: tailOf(scan.lines, tool), tool };
}

const MUX_STATE: Record<string, Session['state']> = {
 running: 'running', working: 'running', active: 'running', busy: 'running',
 idle: 'idle', blocked: 'blocked', waiting: 'blocked', needs_input: 'blocked',
 done: 'done', completed: 'done', finished: 'done', exited: 'done',
 failed: 'failed', error: 'failed', killed: 'failed',
};

type MuxWorker = { name?: unknown; dead?: unknown; pid?: unknown; state?: unknown; tail?: unknown };

const muxTransport = (t: unknown): Session['transport'] => (t === 'tmux' || t === 'herdr' ? t : 'claude-bg');

const stateKey = (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : '');

/** A dead worker is failed only when its last state said so, else done. */
const deadState = (mapped: Session['state'] | undefined): Session['state'] => (mapped === 'failed' ? 'failed' : 'done');

const muxState = (w: MuxWorker): Session['state'] => {
 const mapped = MUX_STATE[stateKey(w.state)];
 return w.dead ? deadState(mapped) : (mapped ?? 'running');
};

const isNamed = (w: MuxWorker | null): w is MuxWorker & { name: string } => typeof w?.name === 'string' && w.name !== '';

const muxTail = (t: unknown): string[] =>
 typeof t === 'string' ? t.split('\n').map(clip).filter((l) => l !== '').slice(-MAX_TAIL) : [];

/** One worker row as a session; nameless rows are dropped. */
function muxRow(w: MuxWorker, transport: Session['transport'], now: number): Session[] {
 if (!isNamed(w)) return [];
 return [{ name: w.name, transport, state: muxState(w), since: now, tail: muxTail(w.tail), ...(w.pid ? { pid: String(w.pid) } : {}) }];
}

/** `atlas_mux.py status` stdout -> sessions (transport from the payload). Malformed => []. */
export function parseMuxStatus(stdout: string, now: number): Session[] {
 try {
  const data = JSON.parse(stdout) as { transport?: string; workers?: unknown };
  if (!Array.isArray(data.workers)) return [];
  const transport = muxTransport(data.transport);
  return (data.workers as MuxWorker[]).flatMap((w) => muxRow(w, transport, now));
 } catch {
  return [];
 }
}

const AGENT_STATE: Record<string, Session['state']> = {
 pending: 'running', running: 'running', waiting: 'blocked', idle: 'idle',
 completed: 'done', failed: 'failed', killed: 'failed',
};

/** One $.agent.list row as a subagent session; `tail` from parseTranscript (empty when unreadable). */
export function subagentSession(
 a: { id: string; status: string }, name: string, tail: string[], since: number,
): Session {
 return { name, transport: 'subagent', state: AGENT_STATE[a.status] ?? 'running', since, tail, agentId: a.id };
}

/** Merge by name; the first source wins (subagents before mux rows). */
export function mergeSessions(...groups: Session[][]): Session[] {
 const seen = new Set<string>();
 const out: Session[] = [];
 for (const s of groups.flat()) {
  if (seen.has(s.name)) continue;
  seen.add(s.name);
  out.push(s);
 }
 return out;
}
