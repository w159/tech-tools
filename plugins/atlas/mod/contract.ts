// Shared contract for the Atlas Claude Code mod. EVERY mod file imports types from here.
// Do not change signatures without telling the lead. Reference API types:
// plugins/atlas/.claude-plugin/types/claude-code/index.d.ts (generated, gitignored).
// Plan: docs/plans/2026-10-09-atlas-mod.md

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

// ---- injectable IO (data readers are pure over this; register.ts adapts $.fs) ----
export interface FsLike {
  read(path: string): Promise<string | undefined>;
  stat(path: string): Promise<{ size: number; mtimeMs: number } | undefined>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<string[]>;
}

// ---- brand tokens (mirror scripts/dashboard_ui/css/tokens.css) ----
export const BRAND = {
  accent: '#2fbd9f', focus: '#7fe0cb', bg: '#0c1215', surface: '#121a1e', text: '#e6edf0', dim: '#9fb0b8',
  ok: '#52c872', working: '#62b8e6', input: '#f2aa40', fail: '#ff7570', idle: '#93a4ac', subagent: '#b5a3fa',
} as const;
