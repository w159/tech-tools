// Reusable fixtures for plugins/atlas tests (`claude-code/testing` kit).
// Types come from contract.ts; no Node APIs (the test env has none).
// Deterministic: every timestamp derives from FIXTURE_EPOCH_MS.

import type {
  AtlasSnapshot, ChannelMember, ChannelNote, Contract, FsLike,
  PhaseId, Persona, SquadAgent, TodoItem,
} from './contract';

/** Fixed base time for all fixture timestamps (2025-10-09T04:26:40Z). */
export const FIXTURE_EPOCH_MS = 1_760_000_000_000;

// ---- FIXTURE_CONTRACT ----

const PHASE_GLYPHS: Record<PhaseId, string> = {
  research: '?', theory: '※', test: '⚗', validate: '☑',
  implement: '⚒', verify: '✓', done: '●', blocked: '✗',
};

/** A valid mod Contract with the 8 phases and their glyphs. */
export const FIXTURE_CONTRACT: Contract = {
  phases: (Object.keys(PHASE_GLYPHS) as PhaseId[]).map(id => ({ id, glyph: PHASE_GLYPHS[id] })),
  todoPhases: ['research', 'theory', 'test', 'validate', 'implement', 'verify'],
  headerFirstLinePattern: '^# atlas:',
  itemPhasePrefix: '[<phase>] ',
};

// ---- memFs ----

export interface MemFs extends FsLike {
  /** Advance the mtime of one path, or every path when omitted. */
  bump(path?: string): void;
  /** Set content and bump mtime, simulating a file change. */
  write(path: string, text: string): void;
}

/**
 * In-memory FsLike seeded from a path -> text map. Pure: size/mtime are
 * counters over a fixed clock, never Date.now. Entries start at
 * FIXTURE_EPOCH_MS; `bump`/`write` advance the clock by 1ms per call.
 * `list(dir)` returns the direct children of dir (full paths), `[]` if absent.
 */
export function memFs(files: Record<string, string> = {}): MemFs {
  const entries = new Map<string, { text: string; size: number; mtimeMs: number }>();
  let clock = FIXTURE_EPOCH_MS;
  const encoder = new TextEncoder();
  const set = (path: string, text: string) => {
    entries.set(path, { text, size: encoder.encode(text).length, mtimeMs: ++clock });
  };
  for (const [path, text] of Object.entries(files)) set(path, text);
  return {
    read: async path => entries.get(path)?.text,
    stat: async path => {
      const e = entries.get(path);
      return e ? { size: e.size, mtimeMs: e.mtimeMs } : undefined;
    },
    exists: async path => entries.has(path),
    list: async dir => {
      const d = dir.replace(/\/+$/, '');
      const out: string[] = [];
      for (const path of entries.keys()) {
        if (path.startsWith(d + '/') && !path.slice(d.length + 1).includes('/')) out.push(path);
      }
      return out.sort();
    },
    bump: path => {
      if (path === undefined) for (const e of entries.values()) e.mtimeMs = ++clock;
      else {
        const e = entries.get(path);
        if (e) e.mtimeMs = ++clock;
      }
    },
    write: set,
  };
}

// ---- makeSnapshot ----

const DEFAULT_TODOS: TodoItem[] = [
  { id: 't1', content: '[research] map mod surface', status: 'pending', phase: 'research' },
  { id: 't2', content: '[theory] pick channel model', status: 'pending', phase: 'theory' },
  { id: 't3', content: '[implement] write session guard', status: 'in_progress', phase: 'implement', owner: 'impl-auth' },
  { id: 't4', content: '[test] cover routing intents', status: 'pending', phase: 'test' },
  { id: 't5', content: '[verify] typecheck helpers', status: 'completed', phase: 'verify', owner: 'veri-auth', evidence: 'tsc exit 0' },
];

const DEFAULT_PERSONAS: Persona[] = [
  { name: 'implementer', model: 'sonnet', effort: 'medium', color: 'green', description: 'Implements one bounded change.' },
  { name: 'verifier', model: 'haiku', effort: 'low', color: 'blue', description: 'Verifies a claim against evidence.' },
  { name: 'scout', model: 'sonnet', effort: 'medium', color: 'yellow', description: 'Read-only exploration.' },
];

const DEFAULT_SQUAD: SquadAgent[] = [
  { name: 'impl-auth', persona: 'implementer', state: 'running', source: 'task', task: DEFAULT_TODOS[2]!.content, item: 't3', tokens: 12_000, model: 'sonnet', effort: 'medium', paneId: 'pane-1' },
  { name: 'veri-auth', persona: 'verifier', state: 'idle', source: 'task', item: 't5', lastNoteTs: iso(2), paneId: 'pane-2', tokens: 3_000 },
  { name: 'scout-fs', persona: 'scout', state: 'parked', source: 'colony', paneId: 'pane-3' },
];

const DEFAULT_NOTES: ChannelNote[] = [
  { ts: iso(0), seq: 1, owner: 'lead', to: 'all', text: 'kick off mod build', channel: 'tech-tools@main/lead' },
  { ts: iso(1), seq: 2, owner: 'impl-auth', text: 'guard written, ready for verify', channel: 'tech-tools@main/lead', kind: 'note' },
  { ts: iso(2), seq: 3, owner: 'veri-auth', text: 'verified, evidence on t5', channel: 'tech-tools@main/lead', kind: 'exit' },
];

const DEFAULT_MEMBERS: ChannelMember[] = [
  { name: 'lead-01a122', role: 'lead', pane_id: 'pane-0' },
  { name: 'ModTestHarness', role: 'task' },
];

function iso(offsetMs: number): string {
  return new Date(FIXTURE_EPOCH_MS + offsetMs).toISOString();
}

function countsFor(todos: TodoItem[]): AtlasSnapshot['counts'] {
  const byPhase: Record<string, { done: number; total: number }> = {};
  let done = 0;
  for (const t of todos) {
    const phase = t.phase ?? 'research';
    const c = (byPhase[phase] ??= { done: 0, total: 0 });
    c.total++;
    if (t.status === 'completed') { c.done++; done++; }
  }
  return { done, total: todos.length, byPhase };
}

const DEFAULT_SNAPSHOT: AtlasSnapshot = {
  root: '/tmp/atlas-fixture',
  sessionId: 'sess-fixture',
  channel: 'tech-tools@main/lead',
  contract: FIXTURE_CONTRACT,
  personas: DEFAULT_PERSONAS,
  todos: DEFAULT_TODOS,
  counts: countsFor(DEFAULT_TODOS),
  phase: 'implement',
  phaseSource: 'todo',
  notes: DEFAULT_NOTES,
  members: DEFAULT_MEMBERS,
  squad: DEFAULT_SQUAD,
  unread: 0,
  tokens: 15_000,
  costUsd: 0.05,
  contextPct: 12,
  headerMisses: 0,
  now: FIXTURE_EPOCH_MS,
};

/**
 * A valid AtlasSnapshot: 8 phases with glyphs, 3 squad agents, 5 todos, notes,
 * members, personas. `over` shallow-merges on top; when it swaps `todos`, the
 * default `counts` are recomputed from them unless `over.counts` is given.
 */
export function makeSnapshot(over: Partial<AtlasSnapshot> = {}): AtlasSnapshot {
  const snap = { ...DEFAULT_SNAPSHOT, ...over };
  if (over.todos !== undefined && over.counts === undefined) snap.counts = countsFor(over.todos);
  return snap;
}
