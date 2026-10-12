// Orchestration slice of the Atlas snapshot (contract.ts is locked, so the new
// fields live here). View workers import these types; the builder returns LiveSnapshot.
import type { AtlasSnapshot, PhaseId } from './contract';

// Shared shapes live in the self-contained types contract; re-exported so mod code keeps one import site.
import type { Mood, ActivityEntry, CommsEntry, LifecycleEntry, Savings, Session, ContractProgress, TodoGroup as ContractTodoGroup } from '../types';
export type { Mood, ActivityEntry, CommsEntry, LifecycleEntry, Savings, Session, ContractProgress };

/** Contract TodoGroup plus the props-slice marker (rows left out to keep Client props small). */
export type TodoGroup = ContractTodoGroup & { hidden?: { live: number; liveDone: number; archived: number } };

export interface OrchestraSnapshot {
  activity: Record<string, ActivityEntry>;
  comms: CommsEntry[];             // oldest first, last 200, 'lead' is the lead, to 'all' = broadcast
  lifecycle: LifecycleEntry[];
  savings: Savings;
  sessions: Session[];
  todoGroups: TodoGroup[];         // live items first within a group; archived backlog excluded
  contractProgress: ContractProgress[]; // current-session todos only
  backlog: { done: number; total: number }; // global board count; never drives the phase pill
}

export type LiveSnapshot = AtlasSnapshot & OrchestraSnapshot;
