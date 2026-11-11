// Live lead channel + atlas_crew run readers: key resolution, worker rows/notes, fingerprint, dead pids.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import type { FsLike } from '../contract';
import { FIXTURE_CONTRACT, FIXTURE_EPOCH_MS, memFs } from '../test_helpers';
import { SnapshotBuilder } from '../snapshot';
import { liveWorkers } from './live';
import { crewSig, readCrew } from './crew';
import { channelRows } from '../pane/sidebar-channel';
import { teamRows } from '../pane/sidebar-team';
import type { SidebarHandlers, SidebarModel } from '../pane/sidebar-types';

const ROOT = '/r';
const PLUGIN = '/plugin';
const SESSION = 'abc12345';
const LEAD = 'proj@main/lead-abc123';
const CREW = `${ROOT}/.atlas/.run/crew/run1`;
const EPOCH_S = FIXTURE_EPOCH_MS / 1000;

/** memFs lists files only; a real fs also lists subdirectories, which the crew reader needs. */
function dirFs(files: Record<string, string>) {
  const fs = memFs(files);
  const list: FsLike['list'] = async (dir) => {
    const d = dir.replace(/\/+$/, '');
    const out = new Set<string>();
    for (const p of Object.keys(files)) if (p.startsWith(d + '/')) out.add(p.slice(d.length + 1).split('/')[0]!);
    return [...out];
  };
  return Object.assign(fs, { list });
}

const log = (o: Record<string, unknown>) => JSON.stringify(o);
function seed(extra: Record<string, string> = {}) {
  return dirFs({
    [`${PLUGIN}/contracts/operating-contract.json`]: JSON.stringify(FIXTURE_CONTRACT),
    [`${ROOT}/.atlas`]: '',
    [`${ROOT}/.atlas/.run/channels.json`]: JSON.stringify({
      channels: {
        'proj@main': { members: [], notes: 1 },
        [LEAD]: { members: [{ name: 'impl-a', role: 'atlas:implementer' }, { name: LEAD, role: 'lead' }] },
      },
    }),
    [`${ROOT}/.atlas/.run/board/1.jsonl`]: [
      log({ channel: 'proj@main', seq: 1, ts: EPOCH_S - 99999, owner: 'old', text: 'stale main note' }),
      log({ channel: LEAD, seq: 2, ts: EPOCH_S, owner: 'impl-a', to: 'all', text: 'live lead note' }),
    ].join('\n'),
    [`${CREW}/run.json`]: JSON.stringify({ run_id: 'run1', plan: { workers: [{ name: 'gw-broker' }, { name: 'auvik' }] } }),
    [`${CREW}/pid/gw-broker`]: '123',
    [`${CREW}/pid/auvik`]: '124',
    [`${CREW}/exit/auvik.r0.json`]: JSON.stringify({ exit: 0 }),
    [`${CREW}/irc/log.jsonl`]: log({ seq: 1, ts: EPOCH_S, from: 'auvik', to: '#run1', text: 'crew line one' }) + '\n',
    ...extra,
  });
}

async function build(fs: ReturnType<typeof seed>) {
  const b = new SnapshotBuilder(fs, PLUGIN);
  await b.init('/r/sub', {}, SESSION, 'proj', 'main');
  return b.build({ headerPhase: null, taskAgents: [], usage: { contextPct: 1 }, now: FIXTURE_EPOCH_MS + 1000 });
}

/** Element children that are themselves elements. */
const kids = (n: any): any[] => [n?.props?.children].flat().filter((x) => x && typeof x === 'object');
/** Visible text of an element tree. */
const textOf = (n: any): string => (n?.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(' '));

describe('live lead channel', () => {
  test('resolves "<folder>@<branch>/lead-<s6>" over the stale "<folder>@<branch>" entry', async () => {
    const snap = await build(seed());
    expect(snap.channel).toBe(LEAD);
    expect(snap.members.map((m) => m.name)).toContain('impl-a');
    expect(snap.notes.map((n) => n.text)).toContain('live lead note');
    expect(snap.notes.map((n) => n.text)).not.toContain('stale main note');
  });
});

describe('crew runs', () => {
  test('workers become squad rows (state from pid/exit) and log lines become notes; Team differs from Channel', async () => {
    const snap = await build(seed());
    const ws = liveWorkers(snap, snap.now);
    expect(ws.find((w) => w.name === 'gw-broker')?.state).toBe('working');
    expect(ws.find((w) => w.name === 'auvik')?.state).toBe('done');
    expect(snap.notes.map((n) => n.text)).toContain('crew line one');

    const mk = (kind: string) => (props: Record<string, any>) => ({ kind, props });
    const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
    const m = { snapshot: snap, gates: [], ui: { recipient: null, expanded: null, draft: '' }, columns: 100, rows: 40, tick: 0 } as unknown as SidebarModel;
    const on = {} as SidebarHandlers;
    const team = (teamRows(els, m, on, 100) as any[]).map(textOf).join('\n');
    const chan = (channelRows(els, m, on, 100) as any[]).map(textOf).join('\n');
    expect(team).toContain('gw-broker');
    expect(chan).toContain('crew line one');
    expect(team).not.toBe(chan);
  });

  // Real port28 shape: gw-docs was killed by `atlas_crew.py kill`; its pid file stays, it has no exit file,
  // summary.json lists it with exit null, and the log ends with the lead's `final` line.
  const P28 = `${ROOT}/.atlas/.run/crew/port28`;
  const port28 = (over: boolean) => dirFs({
    [`${P28}/run.json`]: JSON.stringify({ run_id: 'port28', root: ROOT, plan: { goal: 'g', check: 'c', workers: [{ name: 'gw-broker', owns: [], task: 't' }, { name: 'gw-docs', owns: [], task: 't' }] } }),
    [`${P28}/irc/members.json`]: JSON.stringify({ channel: '#port28', members: ['gw-broker', 'gw-docs'], lead: 'lead' }),
    [`${P28}/pid/gw-broker`]: '36390',
    [`${P28}/pid/gw-docs`]: '36392',
    [`${P28}/logs/gw-docs.log`]: '{}\n',
    [`${P28}/exit/gw-broker.r0.json`]: JSON.stringify({ exit: 0, wall_s: 35.6, sid: 's' }),
    [`${P28}/irc/log.jsonl`]: [
      log({ seq: 1, ts: EPOCH_S, from: 'lead', to: '#port28', text: 'Kickoff.', kind: 'kickoff' }),
      log({ seq: 3, ts: EPOCH_S, from: 'gw-broker', to: '#port28', text: 'DONE gw-broker: check passes', kind: 'done', digest: 'x', peer_digests: {} }),
      ...(over ? [log({ seq: 12, ts: EPOCH_S, from: 'lead', to: '#port28', text: 'Crew finished: global check exit 0.', kind: 'final' })] : []),
    ].join('\n') + '\n',
    ...(over ? { [`${P28}/summary.json`]: JSON.stringify({ ok: true, run: 'port28', workers: [{ name: 'gw-broker', exit: 0 }, { name: 'gw-docs', exit: null }] }) } : {}),
  });
  const stateOf = async (fs: FsLike, now: number, name: string) => (await readCrew(fs, ROOT, now)).agents.find((a) => a.name === name)?.state;

  test('dead pid: a killed worker (pid file, no exit file, run summary written) is not running', async () => {
    const fs = port28(true);
    expect(await stateOf(fs, FIXTURE_EPOCH_MS + 1000, 'gw-docs')).toBe('dead');
    expect(await stateOf(fs, FIXTURE_EPOCH_MS + 1000, 'gw-broker')).toBe('finished');
  });

  test('dead pid: with no summary yet, a pid whose files went quiet past the stale window is dead, fresh is running', async () => {
    const fs = port28(false);
    expect(await stateOf(fs, FIXTURE_EPOCH_MS + 1000, 'gw-docs')).toBe('running');
    expect(await stateOf(fs, FIXTURE_EPOCH_MS + 15 * 60_000, 'gw-docs')).toBe('dead');
  });

  // Mutation kills (round 2): RECENT_MS, the missing-mtime floor and the exit-note filter.
  const RECENT = 30 * 60_000;
  const T = FIXTURE_EPOCH_MS;
  /** One run whose every present file reports mtime `mt` (`undefined`: stat finds nothing at all). */
  const aged = (mt: number | undefined) => {
    const fs = dirFs({
      [`${ROOT}/.atlas/.run/crew/aged/run.json`]: JSON.stringify({ run_id: 'aged', plan: { workers: [{ name: 'w1' }] } }),
      [`${ROOT}/.atlas/.run/crew/aged/irc/log.jsonl`]: [
        log({ seq: 1, ts: EPOCH_S, from: 'lead', text: 'kick', kind: 'kickoff' }),
        log({ seq: 2, ts: EPOCH_S, from: 'w1', text: 'bye', kind: 'exit' }),
        log({ seq: 3, ts: EPOCH_S, from: 'w1', text: 'plain' }),
      ].join('\n') + '\n',
    });
    return Object.assign(fs, { stat: async () => (mt === undefined ? undefined : { size: 1, mtimeMs: mt }) });
  };
  const liveCount = async (fs: FsLike, now: number) => (await readCrew(fs, ROOT, now)).agents.length;

  test('a run is live up to exactly 30 minutes after its newest file, history one millisecond later', async () => {
    const fs = aged(T);
    expect(await liveCount(fs, T + RECENT)).toBe(1);
    expect(await liveCount(fs, T + RECENT + 1)).toBe(0);
  });

  test('a file the fs cannot stat counts as mtime 0 (oldest), not 1', async () => {
    const fs = aged(undefined);
    expect(await liveCount(fs, RECENT)).toBe(1);
    expect(await liveCount(fs, RECENT + 1)).toBe(0);
  });

  test('log notes keep their kind, except an exit line, which carries none', async () => {
    const { notes } = await readCrew(aged(T), ROOT, T + 1000);
    expect(notes.map((n) => [n.text, n.kind])).toEqual([['kick', 'kickoff'], ['bye', undefined], ['plain', undefined]]);
  });

  test('crewSig changes when irc/log.jsonl grows', async () => {
    const fs = seed();
    const before = await crewSig(fs, ROOT);
    fs.write(`${CREW}/irc/log.jsonl`, log({ seq: 1, ts: EPOCH_S, from: 'auvik', text: 'a' }) + '\n' + log({ seq: 2, ts: EPOCH_S, from: 'auvik', text: 'b' }) + '\n');
    expect(await crewSig(fs, ROOT)).not.toBe(before);
  });
});
