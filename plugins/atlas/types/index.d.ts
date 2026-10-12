// Atlas mod session state (see mod/register.ts). Every value is JSON data held
// by the engine's $.state for the session, so it survives a hot reload of the
// mod's code. Only derived or non-serializable module caches stay out.
// `claude plugin validate` requires this contract to be self-contained (no
// imports), so the snapshot types below are a verbatim copy of the matching
// block in mod/contract.ts (lines 6-95); keep the two in step.

// fallow-ignore-next-line code-duplication
export type PhaseId = 'research' | 'theory' | 'test' | 'validate' | 'implement' | 'verify' | 'done' | 'blocked';

export interface Phase { id: PhaseId; glyph: string }

export interface Contract {
  phases: Phase[];
  todoPhases: PhaseId[];
  headerFirstLinePattern: string;
  itemPhasePrefix: string; // e.g. "[<phase>] "
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | string;
  owner?: string;
  session_id?: string;
  phase?: PhaseId;
  archived?: boolean;
  evidence?: string;
}

export interface ChannelNote {
  ts: string;
  seq: number;
  owner: string;
  to?: string;
  item?: string;
  text: string;
  channel: string;
  kind?: string; // 'exit' | 'note' | ...
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
  unread: number;
  tokens: number;
  costUsd: number;
  contextPct: number;
  headerMisses: number;
  now: number;                             // epoch ms at build
}

export type PaneTab = 'colony' | 'channel' | 'board' | 'squad' | 'collab';

/** null = not measured yet (rendered `--`); 0 is a legitimate measured value. */
export type Usage = { tokens: number | null; costUsd: number | null; contextPct: number | null };

/** Spinner animation frame counter (written and read by mod/restyle.tsx). */
export type SpinnerTick = number;

declare module 'claude-code' {
	interface PluginState {
		atlas: {
			snapshot: AtlasSnapshot | null;
			tab: PaneTab;
			usage: Usage;
			taskAgents: SquadAgent[];
			headerPhase: PhaseId | null;
			headerMisses: number;
			lastSeenSeq: number;
			isModOn: boolean;
			isInteractive: boolean;
			paneOpened: boolean;
			spinnerTick: SpinnerTick;
		};
	}
}
