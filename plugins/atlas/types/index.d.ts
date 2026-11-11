// Atlas mod session state (see mod/register.ts). Every value is JSON data held
// by the engine's $.state for the session, so it survives a hot reload of the
// mod's code. Only derived or non-serializable module caches stay out.
// `claude plugin validate` requires this contract to be self-contained (no
// imports), so the snapshot types below are a verbatim copy of the matching
// block in mod/contract.ts (between the BEGIN/END markers); keep the two in step
// (hooks/test_atlas_contract.py fails when they differ).

// fallow-ignore-next-line code-duplication
// ---- BEGIN shared snapshot types (verbatim copy in types/index.d.ts; hooks/test_atlas_contract.py keeps them identical) ----
export type PhaseId = 'research' | 'theory' | 'test' | 'validate' | 'implement' | 'verify' | 'done' | 'blocked';

export interface Phase { id: PhaseId; glyph: string }

export interface Contract {
  phases: Phase[];
  todoPhases: PhaseId[];
  headerFirstLinePattern: string;
  headerTemplate?: string; // human form of the status header (operating-contract headerTemplate)
  itemPhasePrefix: string; // e.g. "[<phase>] "
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | string;
  owner?: string;
  session_id?: string;
  phase?: PhaseId;
  archived?: boolean;
  evidence?: string;
  claimed_at?: number | null;   // epoch seconds
  estimate_s?: number | null;   // the item's own estimate in seconds, when the board records one (the Board draws `of mm:ss` and the gauge only from it)
  origin?: 'session' | 'carried' | 'manual' | 'advisor' | string;
  channel?: string;
  role?: string;
  carries?: number;
  carried_at?: number;          // epoch seconds
  completed_at?: number | null; // epoch seconds
  updated_at?: number;          // epoch seconds
}

export interface ChannelNote {
  ts: string; // ISO string (mod/data/channels.ts converts the channel file's epoch seconds with isoTs)
  seq: number;
  owner: string;
  to?: string;
  item?: string;
  text: string;
  channel: string;
  kind?: string; // omitted = plain note; 'exit' | 'claim' | 'release' | 'conflict' | 'report' | 'handoff' | 'blocked' | ...
  paths?: string[];
  delivery?: 'delivered' | 'refused';
}

export interface ChannelMember {
  name: string;
  role?: string;
  pane_id?: string;
  pid?: number;
  ended_at?: string | null;
  exit_code?: number | null;
}

export type AgentState =
  | 'spawning' | 'running' | 'idle' | 'input' | 'stuck' | 'parked' | 'finished' | 'failed' | 'dead';

export interface Persona {
  name: string;          // 'implementer' (no atlas: prefix)
  model: string;         // frontmatter pin: haiku|sonnet|opus|inherit
  effort: string;        // low|medium|high|...
  color: string;         // frontmatter colour name, e.g. 'green'
  description: string;
}

export interface SquadAgent {
  name: string;          // dispatch name, e.g. 'impl-auth'
  persona: string;       // persona name or 'armada-<dept>' or 'unknown'
  state: AgentState;
  source: 'task' | 'colony';
  transport?: string;    // atlas_mux.py transport (tmux|herdr|claude-bg) for mux-launched workers
  task?: string;         // todo item content
  item?: string;         // todo item id
  lastNoteTs?: string;
  paneId?: string;
  tokens?: number;
  model?: string;
  effort?: string;
}

export interface PhaseCount { done: number; total: number }

/** Everything the UI needs, rebuilt by the hooks module on file change and passed as Client props. */
export interface AtlasSnapshot {
  /** Monotonic build number stamped by register.ts rebuild(); a consumer ignores a snapshot with a lower one than it last applied. */
  seq?: number;
  root: string | null;
  sessionId: string;
  channel: string | null;
  contract: Contract;
  personas: Persona[];
  todos: TodoItem[];                       // session slice, non-archived
  counts: { done: number; total: number; byPhase: Record<string, PhaseCount> };
  phase: PhaseId;                          // current phase (header > in_progress item > research)
  phaseSource: 'header' | 'todo' | 'default';
  notes: ChannelNote[];                    // sorted by seq,ts; last 500
  members: ChannelMember[];
  squad: SquadAgent[];
  contextPct: number;
  now: number;                             // epoch ms at build
}
// ---- END shared snapshot types ----

export type Mood = 'idle' | 'working' | 'thinking' | 'blocked' | 'done' | 'failed' | 'celebrate';
export interface ActivityEntry { tool: string | null; since: number; toolCount: number; tokens: number | null; mood: Mood; lastLine: string }
export interface CommsEntry { seq: number; ts: number; from: string; to: string; text: string; kind: 'say' | 'dispatch' | 'report' | 'merge' | 'join' | 'leave' }
export interface TodoGroup {
  phase: PhaseId | 'unsorted' | 'advisor';
  dept: string;
  glyph: string;
  items: { id: string; content: string; status: string; owner: string | null; evidence: string | null; live: boolean; origin?: string; session_id?: string }[];
  done: number;
  total: number;
}
/** Copy of mod/orchestra-types.ts LiveSnapshot. */
export type LiveSnapshot = AtlasSnapshot & {
  activity: Record<string, ActivityEntry>;
  comms: CommsEntry[];
  todoGroups: TodoGroup[];
};
/** Event-fed orchestration state (mod/data/orchestration.ts Orch). */
export interface Orch {
  activity: Record<string, ActivityEntry>;
  comms: CommsEntry[];
  stage: Record<string, 'spawned' | 'working' | 'reported'>;
  meta: Record<string, { name?: string; type?: string }>;
}

/** The Atlas core as the band and pane draw it (mod/data/core.ts CoreModel; the contract holds no imports). */
export interface CoreState {
  contract: { header: Tally; evidence: Tally; open: number; openGates: number; verifiedDone: Tally };
  verdicts: { id: string; status: 'verified' | 'rejected' | 'needs-evidence'; title: string; by: string; at: number; evidence: string }[];
  claims: { owner: string; role: string; status: 'DONE' | 'FAILED' | 'BLOCKED'; at: number; matched: string | null }[];
  ledger: { verified: number; refuted: number; pending: number; claimed: number; unchecked: number };
  offload: {
    workers: { name: string; role: string; model: string | null; brief: number; peak: number; kept: number; returned: number; costUsd: number | null; finished: boolean }[];
    kept: number;
    returned: number;
    ratio: number | null;
  };
  routes: { teamId: string; name: string; cls: string; effort: string; isolation: string; maxParallel: number; seats: { role: string; count: number; model: string; effort: string; ran: string[] }[]; drift: string[] }[];
}
/** ok of total. */
export type Tally = { ok: number; total: number };

export type PaneTab = 'colony' | 'channel' | 'board' | 'squad' | 'collab';

/** null = not measured yet (rendered `--`); 0 is a legitimate measured value. */
export type Usage = { tokens: number | null; costUsd?: number | null; contextPct: number | null }; // costUsd: no mod code measures it yet

/** Spinner animation frame counter (written and read by mod/restyle.tsx). */
export type SpinnerTick = number;

declare module 'claude-code' {
	interface PluginState {
		atlas: {
			snapshot: LiveSnapshot | null;
			usage: Usage;
			taskAgents: SquadAgent[];
			headerPhase: PhaseId | null;
			isModOn: boolean;
			isInteractive: boolean;
			paneOpened: boolean;
			spinnerTick: SpinnerTick;
			bandGauges: { todo: { from: number; to: number; at: number }; ctx: { from: number; to: number; at: number } | null } | null;
			easeTick: number;
			discipline: { heavy: number; delegated: boolean; hint: string; toastAt: number };
			orch: Orch;
			sidebarRecipient: string | null;
			sidebarExpanded: string | null;
			sidebarDraft: string;
			atlasView: 'team' | 'channel' | 'route' | 'gates' | 'core' | 'board';
			gates: { id: 'completion' | 'tripwire' | 'routing' | 'header'; title: string; lines: { id: string; label: string; ok: boolean; detail?: string; fix?: string }[]; error?: string }[];
			lastHeader: { matched: boolean; phase: string | null } | null;
			core: CoreState | null;
			headerTally: { ok: number; total: number };
		};
	}
}
