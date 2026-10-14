// atlas_mux.py status -> squad entries, so mux-launched workers reach liveWorkers. Stdout is one JSON object:
// { transport, workers: [{ name, dead, pid, state? }], board: [{ name, exit }] } (board exit = the worker's exit note code).
import type { AgentState, SquadAgent } from '../contract';
import type { TeamTool } from '../orchestra-types';
import { targetOf } from './orchestration';

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

type TeamRecord = { channel?: unknown; members?: unknown };

const recordOf = (text: string): TeamRecord => {
  try {
    return (JSON.parse(text) ?? {}) as TeamRecord;
  } catch {
    return {}; // a half-written or foreign record names no channel
  }
};

const lastSegment = (channel: unknown): string => (typeof channel === 'string' ? channel.split('/').pop() ?? '' : '');
const memberNames = (r: TeamRecord): string[] =>
  (Array.isArray(r.members) ? (r.members as { name?: unknown }[]) : []).flatMap((m) => (typeof m?.name === 'string' ? [m.name] : []));

/** spawn-team records (`<id>.json`) whose channel ends in one of `channels`' last segments (a full channel or a bare
 * `lead-<session6>`), with their member names: atlas_mux.py registers a team's workers under its team id, not the lead's run. */
export function teamsOf(records: readonly { name: string; text: string }[], channels: readonly string[]): { id: string; members: string[] }[] {
  const wanted = new Set(channels.map(lastSegment).filter(Boolean));
  return records.flatMap((r) => {
    const rec = recordOf(r.text);
    return wanted.has(lastSegment(rec.channel)) ? [{ id: r.name.replace(/\.json$/, ''), members: memberNames(rec) }] : [];
  });
}

/** The mux rows this session owns, first row per name: `status` under the default claude-bg transport also lists
 * every background claude agent of the root, other sessions' included. */
export function ownRows(rows: readonly SquadAgent[], own: ReadonlySet<string>): SquadAgent[] {
  const seen = new Set<string>();
  return rows.filter((a) => own.has(a.name) && !seen.has(a.name) && !!seen.add(a.name));
}

type Block = { type?: unknown; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown };

const blocksOf = (line: string): Block[] => {
  try {
    const content = (JSON.parse(line) as { message?: { content?: unknown } }).message?.content;
    return Array.isArray(content) ? (content as Block[]) : [];
  } catch {
    return []; // the `$ argv` header and the prompt's continuation lines are not JSON
  }
};

const isUse = (b: Block): boolean => b.type === 'tool_use' && typeof b.name === 'string';

/** A team worker's tool from its pane log (`.atlas/.run/logs/<name>.log`, stream-json): the last tool_use is `tool`
 * while no tool_result answers it, else `lastTool`; `uses` counts every tool_use; {} when the log holds no tool call. */
export function paneTool(log: string): TeamTool {
  const blocks = log.split('\n').flatMap(blocksOf);
  const uses = blocks.filter(isUse);
  const use = uses[uses.length - 1];
  if (!use) return {};
  const answered = blocks.some((b) => b.type === 'tool_result' && b.tool_use_id === use.id);
  const target = targetOf(use.input);
  return { [answered ? 'lastTool' : 'tool']: use.name as string, ...(target ? { target } : {}), uses: uses.length };
}
