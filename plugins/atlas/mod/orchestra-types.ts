// Orchestration slice of the Atlas snapshot (contract.ts is locked, so the new
// fields live here). View workers import these types; the builder returns LiveSnapshot.
import type { AtlasSnapshot, PhaseId } from './contract';

// Shared shapes live in the self-contained types contract; re-exported so mod code keeps one import site.
import type { Mood, ActivityEntry as ContractActivityEntry, CommsEntry, TodoGroup as ContractTodoGroup } from '../types';
export type { Mood, CommsEntry };

/** Contract entry plus: startedAt (first sight, never moves), target (what the current or last tool touched) and
 * lastTool (the tool answered last, kept between calls). `since` stays the current-tool time. */
export type ActivityEntry = ContractActivityEntry & { startedAt?: number; target?: string; lastTool?: string };

/** A team pane worker's tool, read from its pane log onto its squad row (it raises no in-process events). */
export type TeamTool = { tool?: string; lastTool?: string; target?: string; startedAt?: number };

/** Contract TodoGroup plus the props-slice marker (rows left out to keep Client props small). */
export type TodoGroup = ContractTodoGroup & { hidden?: { live: number; liveDone: number; archived: number } };

export interface OrchestraSnapshot {
  activity: Record<string, ActivityEntry>;
  comms: CommsEntry[];             // oldest first, last 200, 'lead' is the lead, to 'all' = broadcast
  todoGroups: TodoGroup[];         // live items first within a group; archived backlog excluded
}

export type LiveSnapshot = AtlasSnapshot & OrchestraSnapshot;
