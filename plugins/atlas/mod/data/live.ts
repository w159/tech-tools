// One worker list for every surface: squad + per-agent activity, lead excluded, urgent first.
import type { UiState } from '../atlas-ui';
import { ownerOutcome } from '../board-model';
import type { LiveSnapshot } from '../orchestra-types';

export interface LiveWorker {
  name: string;
  role: string;
  state: 'working' | 'blocked' | 'failed' | 'parked' | 'done';
  tool: string | null;
  /** The tool answered last; the band shows it dimmed between calls. */
  lastTool: string | null;
  /** Current-tool time (moves every call). */
  since: number;
  /** First sight of the worker; the age shown to people. */
  startedAt: number;
  target: string | null;
  /** The current (else last) call's intent, as omp's tool preview shows it. */
  detail?: string | null;
  lastLine: string;
  /** Tool start times over the last minute (tool-call history). */
  calls: number[];
  /** Dispatch `SCOPE:` value (`audit/medium`), when the prompt carried one. */
  scope: string | null;
}

const ORDER = { blocked: 0, failed: 1, working: 2, parked: 3, done: 4 } as const;

/** Wave 37 (card/HUD agreement): workers a completion signal (the lead transcript's `<task-notification>` for the agent) has ended, with the outcome and the clock reading (ms) of the signal. The transcript card and the HUD rows read the
 * same fact: a worker the signal names is `done` (or `failed`) on the very render the card prints, though the snapshot that lists it has not been rebuilt yet. An instance that started after the signal (a retry that
 * reuses the name) is a new run and is not ended by it. */
const signalled = new Map<string, { outcome: 'done' | 'failed'; at: number }>();
export const noteEnded = (name: string, outcome: 'done' | 'failed', at: number): void => { if (name) signalled.set(name, { outcome, at }); };
export const forgetEnded = (): void => signalled.clear();
/** The task-notification texts' (`<task-id>`, `<status>`) pairs: which host task ended and how (`completed` reads done; `failed`, `killed`, `stopped` read failed). */
export function notifiedEnds(text: string): { id: string; outcome: 'done' | 'failed' }[] {
  return [...text.matchAll(/<task-id>([^<]+)<\/task-id>[\s\S]*?<status>([^<]*)<\/status>/g)].map((m) => ({ id: m[1]!.trim(), outcome: /^(completed|idle|done|finished)$/i.test(m[2]!.trim()) ? 'done' as const : 'failed' as const }));
}

// Takes LiveSnapshot (AtlasSnapshot & activity): AtlasSnapshot alone has no per-agent activity.
export function liveWorkers(snapshot: LiveSnapshot, now: number): LiveWorker[] {
  return snapshot.squad
    .filter((a) => a.name !== 'lead')
    .map((a): LiveWorker => {
      const act = snapshot.activity[a.name];
      // Host-listed completion wins over a stale 'blocked' mood; only live squad states can be blocked.
      // Failure is terminal: a worker the activity record failed (a killed task) is never read done, whatever the squad row says later.
      const state = a.state === 'finished' ? (act?.mood === 'failed' ? 'failed' : 'done')
        : a.state === 'failed' || a.state === 'dead' ? 'failed'
        : a.state === 'parked' ? 'parked'
        : act?.mood === 'blocked' || a.state === 'input' || a.state === 'stuck' ? 'blocked'
        : act?.mood === 'failed' ? 'failed'
        : act?.mood === 'done' ? 'done'
        : 'working';
      const sig = signalled.get(a.name);
      const ended = sig !== undefined && state !== 'done' && state !== 'failed' && (act?.startedAt ?? 0) <= sig.at; // the completion signal names it: terminal, whatever the snapshot has not caught up with
      return { name: a.name, role: a.persona, state: ended ? sig.outcome : state, tool: ended ? null : act?.tool ?? null, lastTool: act?.lastTool ?? null, since: ended ? Math.min(Math.max(sig.at, (act?.startedAt ?? 0) + 1), now) : act?.since ?? now, startedAt: act?.startedAt ?? act?.since ?? now, target: act?.target ?? null, detail: act?.detail ?? null, lastLine: act?.lastLine ?? '', calls: act?.calls ?? [], scope: act?.scope ?? null };
    })
    .sort((x, y) => ORDER[x.state] - ORDER[y.state]);
}

/** When the worker's run ended, for a duration: an ended worker's stamped finish (`since`, frozen by the builder), else `now`. A stamp
 * at or before the start (an entry that never saw an event) or after `now` is no finish time, so the run reads as still counting. */
export const endedAt = (w: Pick<LiveWorker, 'state' | 'since' | 'startedAt'>, now: number): number =>
  (w.state === 'done' || w.state === 'failed') && w.since > w.startedAt && w.since <= now ? w.since : now;

/** Calls per `bucketMs` slot over the last `n` slots, oldest first. */
export function callBuckets(calls: readonly number[], now: number, n = 12, bucketMs = 5000): number[] {
  const out = new Array<number>(n).fill(0);
  for (const t of calls) {
    const slot = n - 1 - Math.floor((now - t) / bucketMs);
    if (slot >= 0 && slot < n) out[slot]! += 1;
  }
  return out;
}

export const activeCount = (ws: LiveWorker[]) => ws.filter((w) => w.state === 'working' || w.state === 'blocked').length;

/** What the data shows about one worker; `workerWord` turns it into the state word. */
export type WorkerEvidence = {
  /** The host lists the worker (a squad entry, a registry row). False: dispatched, not seen yet. */
  listed: boolean;
  /** How it ended, when it has. */
  outcome?: 'done' | 'failed';
  /** The board says it waits (on the lead, on input). */
  blocked?: boolean;
};

/** THE state rule, one for every surface and both hosts (band, HUD, side panel, board, omp). A state word comes from the
 * data, never from a clock: queued = dispatched but the host does not list the worker yet; running = the host lists it (a
 * tool in flight or not); done and failed from the outcome; waiting from the board. */
export function workerWord(e: WorkerEvidence): UiState {
  if (e.outcome) return e.outcome;
  if (!e.listed) return 'queued';
  return e.blocked ? 'waiting' : 'running';
}

/** The one state word of a host-listed worker, for every surface (HUD, band, side panel). A parked worker is one the host
 * lists as resting: it has not started the work, so it reads queued, the one place a listed worker is not running. */
export function liveState(w: LiveWorker): UiState {
  if (w.state === 'parked') return 'queued';
  return workerWord({ listed: true, outcome: w.state === 'done' || w.state === 'failed' ? w.state : undefined, blocked: w.state === 'blocked' });
}

/** The same mapping for a bare state word (a fixture's `running` and `queued` pass through; an unknown word reads running). */
export function workerUiState(state: string): UiState {
  switch (state) {
    case 'working': case 'running': return 'running';
    case 'blocked': case 'waiting': return 'waiting';
    case 'failed': return 'failed';
    case 'done': return 'done';
    case 'parked': case 'queued': return 'queued';
    default: return 'running';
  }
}

/** Dispatched members the host does not list: roster rows still open (no `ended_at`), not the lead, not in the squad. Each is
 * a queued worker on every surface, until the host lists it. */
export function queuedMembers(s: Pick<LiveSnapshot, 'members' | 'squad'>): string[] {
  const listed = new Set(s.squad.map((a) => a.name));
  const names = s.members.filter((x) => !x.ended_at && x.role !== 'lead' && x.name !== 'lead' && !x.name.startsWith('lead-') && !listed.has(x.name)).map((x) => x.name);
  return [...new Set(names)];
}

/** Name -> state word of every worker a surface lists: the host-listed workers and the queued members. */
export function workerStates(s: Pick<LiveSnapshot, 'members' | 'squad'>, workers: readonly LiveWorker[]): Map<string, UiState> {
  return new Map<string, UiState>([...queuedMembers(s).map((n): [string, UiState] => [n, 'queued']), ...workers.map((w): [string, UiState] => [w.name, liveState(w)])]);
}

/** Items with their owner's state word attached (`ownerState`), for the board and the TODO tree. */
export const withOwnerStates = <T extends { owner?: string }>(items: readonly T[], states: ReadonlyMap<string, UiState>): (T & { ownerState?: UiState; retried?: boolean })[] =>
  items.map((it) => {
    const o = it.owner ? ownerOutcome(states, it.owner) : undefined; // the owner's LATEST instance (`name #2` after a kill), as the HUD reads it (critique 19 A3)
    return o?.state ? { ...it, ownerState: o.state, ...(o.retried ? { retried: true } : {}) } : { ...it };
  });

/** The one agent tally (state 38): how many agents are in each state word. The SUBAGENTS title (`2 done · 1 failed`) and the band's worker segment (`● 2 done · ■1`) both read their counts from here, so no two surfaces count the same agents twice. */
export type Tally = Record<UiState, number>;
export function tallyOf(states: readonly UiState[]): Tally {
  const t: Tally = { running: 0, blocked: 0, failed: 0, waiting: 0, queued: 0, done: 0 };
  for (const s of states) t[s] += 1;
  return t;
}

/** State 38 (critique: a worker card said `0:13` and no count while its SUBAGENTS row said `0:15` and `3`): the TIME and CALLS cells the SUBAGENTS table prints for a worker, noted by the table as it draws. Every worker card reads
 * them from here, so a card and its row cannot disagree; `-` only where the table cell is `-`. */
export type WorkerFacts = { time: string; calls: string };
let FACT_SEQ = 0; // the order the table drew its cells in: a card compares draws by this count, never by clock readings that can tie
const FACTS = new Map<string, WorkerFacts & { at: number; seq: number }>();
/** How many cell draws the table has made so far. */
export const factsSeq = (): number => FACT_SEQ;
const FACTS_MS = 3000; // a cell older than this is from a table that is no longer drawn
export function noteWorkerFacts(names: readonly (string | undefined)[], time: string, calls: string): void {
  for (const n of names) if (n) FACTS.set(n, { time, calls, at: Date.now(), seq: ++FACT_SEQ });
  if (FACTS.size > 500) for (const k of [...FACTS.keys()].slice(0, 250)) FACTS.delete(k);
}
export function workerFacts(name: string): WorkerFacts | undefined {
  const f = FACTS.get(name);
  return f && Date.now() - f.at < FACTS_MS ? { time: f.time, calls: f.calls } : undefined;
}
/** The cells with the time the table noted them (`Date.now()`), while fresh: a card placed for a worker that just ended waits for a draw made after the end (truth 40, live-150-1 f0052: beta's card said 0:10, its row 0:13). */
export function workerFactsAt(name: string): (WorkerFacts & { at: number; seq: number }) | undefined {
  const f = FACTS.get(name);
  return f && Date.now() - f.at < FACTS_MS ? { ...f } : undefined;
}
export const resetWorkerFacts = (): void => FACTS.clear();
