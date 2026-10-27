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

/** Malformed or non-JSON stdout => []. `members`: a live spawn-team record's workers. A tiled team runs them as panes
 * of one window named after the session, which `status` lists as that window only, so a member without a row of its
 * own is running until its board exit note says otherwise. */
export function parseMuxStatus(stdout: string, members: readonly string[] = []): SquadAgent[] {
  try {
    const data = JSON.parse(stdout) as { transport?: unknown; workers?: unknown; board?: unknown };
    if (!Array.isArray(data.workers)) return [];
    const exits = new Map<string, number | null>();
    for (const b of Array.isArray(data.board) ? (data.board as { name?: unknown; exit?: unknown }[]) : []) {
      if (typeof b?.name === 'string' && typeof b.exit === 'number') exits.set(b.name, b.exit);
    }
    const transport = typeof data.transport === 'string' ? data.transport : 'mux';
    const rows = (data.workers as { name?: unknown; dead?: unknown; state?: unknown }[]).filter((w) => typeof w?.name === 'string' && w.name);
    const listed = new Set(rows.map((w) => w.name));
    return [...rows, ...members.filter((m) => !listed.has(m)).map((name) => ({ name }))].map((w) => ({
      name: w.name as string, persona: 'unknown', state: stateOf(w, exits.get(w.name as string)), source: 'colony' as const, transport,
    }));
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

/** The mux rows this session owns, first row per name: `status` under the claude-bg transport also lists
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

/** How a team worker's `claude -p` ended, from the stream-json `result` event its pane log closes with; null while it
 * runs. A tiled pane hides `pane_dead` from `status`, and the exit note can sit on another root's board (worktrees). */
export function paneExit(log: string): 'finished' | 'failed' | null {
  const end = log.split('\n').reverse().map(eventOf).find((e) => e?.type === 'result');
  if (!end) return null;
  return end.is_error === true ? 'failed' : 'finished';
}

const eventOf = (line: string): { type?: unknown; is_error?: unknown } | null => {
  if (!line.includes('"result"')) return null; // skip parsing every tool event
  try {
    return JSON.parse(line) as { type?: unknown; is_error?: unknown };
  } catch {
    return null; // a half-flushed last line or the argv header
  }
};

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
