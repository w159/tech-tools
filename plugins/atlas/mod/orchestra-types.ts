// Orchestration slice of the Atlas snapshot (contract.ts is locked, so the new
// fields live here). View workers import these types; the builder returns LiveSnapshot.
import type { AtlasSnapshot, PhaseId } from './contract';

// Shared shapes live in the self-contained types contract; re-exported so mod code keeps one import site.
import type { Mood, ActivityEntry, CommsEntry, TodoGroup as ContractTodoGroup } from '../types';
export type { Mood, ActivityEntry, CommsEntry };

/** Contract TodoGroup plus the props-slice marker (rows left out to keep Client props small). */
export type TodoGroup = ContractTodoGroup & { hidden?: { live: number; liveDone: number; archived: number } };

export interface OrchestraSnapshot {
  activity: Record<string, ActivityEntry>;
  comms: CommsEntry[];             // oldest first, last 200, 'lead' is the lead, to 'all' = broadcast
  todoGroups: TodoGroup[];         // live items first within a group; archived backlog excluded
}

export type LiveSnapshot = AtlasSnapshot & OrchestraSnapshot;
