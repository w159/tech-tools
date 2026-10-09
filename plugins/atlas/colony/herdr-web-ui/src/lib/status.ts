import type { AgentStatus } from "../../shared/protocol.ts";

export type KnownStatus = "idle" | "working" | "blocked" | "done" | "unknown";

/** The one word every surface (sidebar, palette, composer) uses for an agent state. */
export const STATUS_WORD: Readonly<Record<KnownStatus, string>> = {
  idle: "READY",
  working: "RUN",
  blocked: "INPUT",
  done: "DONE",
  unknown: "—",
};

const KNOWN: Readonly<Record<string, KnownStatus>> = { idle: "idle", working: "working", blocked: "blocked", done: "done" };

/** herdr's AgentStatus is open-ended; the UI knows four states and files the rest under unknown. */
export function knownStatus(status?: AgentStatus): KnownStatus {
  return (status !== undefined && KNOWN[status]) || "unknown";
}

/** herdr's roll-up order: a blocked agent colours the whole workspace, then a working one, then done. */
const ROLLUP: readonly KnownStatus[] = ["blocked", "working", "done", "idle"];

/**
 * One state for a row that stands for several panes, as herdr rolls a workspace's agents up:
 * blocked wins, then working, then done, then ready; unknown only when no pane says more.
 */
export function rollupStatus(statuses: ReadonlyArray<AgentStatus | undefined>): KnownStatus {
  const known = statuses.map((status) => knownStatus(status));
  return ROLLUP.find((state) => known.includes(state)) ?? "unknown";
}

/**
 * Whether a pushed status change should read the conversation now instead of at the next poll:
 * a turn starts or ends when the pane enters or leaves `working`, and the chat's last block
 * follows the status while the transcript it holds is up to POLL_MS old.
 */
export function statusEdgeRead(previous: AgentStatus | undefined, next: AgentStatus | undefined): boolean {
  return previous !== next && (previous === "working" || next === "working");
}
