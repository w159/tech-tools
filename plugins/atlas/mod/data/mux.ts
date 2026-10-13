// atlas_mux.py status -> squad entries, so mux-launched workers reach liveWorkers. Stdout is one JSON object:
// { transport, workers: [{ name, dead, pid, state? }], board: [{ name, exit }] } (board exit = the worker's exit note code).
import type { AgentState, SquadAgent } from '../contract';

const BLOCKED = ['waiting', 'input', 'blocked'];

function stateOf(w: { dead?: unknown; state?: unknown }, exit: number | null | undefined): AgentState {
  if (typeof exit === 'number') return exit === 0 ? 'finished' : 'failed';
  if (w.dead === 1 || w.dead === true) return 'finished';
  return typeof w.state === 'string' && BLOCKED.includes(w.state) ? 'input' : 'running';
}

/** Malformed or non-JSON stdout => []. */
export function parseMuxStatus(stdout: string): SquadAgent[] {
  try {
    const data = JSON.parse(stdout) as { transport?: unknown; workers?: unknown; board?: unknown };
    if (!Array.isArray(data.workers)) return [];
    const exits = new Map<string, number | null>();
    for (const b of Array.isArray(data.board) ? (data.board as { name?: unknown; exit?: unknown }[]) : []) {
      if (typeof b?.name === 'string' && typeof b.exit === 'number') exits.set(b.name, b.exit);
    }
    const transport = typeof data.transport === 'string' ? data.transport : 'mux';
    return (data.workers as { name?: unknown; dead?: unknown; state?: unknown }[]).flatMap((w) =>
      typeof w?.name === 'string' && w.name
        ? [{ name: w.name, persona: 'unknown', state: stateOf(w, exits.get(w.name)), source: 'colony' as const, transport }]
        : [],
    );
  } catch {
    return [];
  }
}
