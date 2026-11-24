// host/poll.ts: the poll loop: fingerprint, rebuild, dock tick, gates, mux and herdr ticks.
// Split out of mod/register.ts (plan docs/plans/2026-11-18_atlas-mod-reorg-plan.md section 7); no behavior change.
import { atom, type EngineInterface, read, update } from 'claude-code';
import type { AtlasSnapshot, SquadAgent } from '../contract';
import { noteEnded, notifiedEnds } from '../data/live';
import type { GateGroup } from '../view/panel/pane/sidebar';
import type { GateLine } from '../view/panel/pane/sidebar-types';
import { crewSig } from '../data/crew';
import { boardOwners } from '../data/channels';
import { gatesError, parseGates } from './gates';
import { noteUsage } from './usage';
import { lastHookAt } from './hook-log';
import { noteHeaderPattern } from '../view/transcript/restyle';
import { isOlder } from './notify';
import { placeFinished } from '../view/transcript/placed';
import { ownRows, paneExit, paneTool, parseMuxStatus, teamsOf } from '../data/mux';
import type { TeamTool } from '../orchestra-types';
import { EMPTY_ORCH, onComplete, parseWt, pushCall, type WtRow } from '../data/orchestration';
import { DOCK_MIN_COLUMNS, engineFs, PANE_DOCK, reportFailure, rootOf, S, statSig, toastUnplaced } from './atoms';
import { HOST_DONE, mapListed, syncAgentsFromList } from './agents';
import { noteGatesRead } from '../data/readinfo';

export const POLL_MS = 500; // the poll of the cheap stat fingerprint; a rebuild runs only when it moved
const WT_MS = 5000;
export const MUX_MS = 5000;
export const HERDR_MS = 5000;
export const GATES_MS = 30_000; // the backstop run; a change to a gate file runs the gates on the next poll instead
export const IDLE_AFTER_MS = 10_000; // nothing moved and nothing runs for this long: the timers stretch
export const IDLE_POLL_MS = 5000; // the fingerprint poll while idle (a hook event or a fingerprint change snaps it back to POLL_MS)
export const IDLE_TICK_MS = 30_000; // the WT, mux, herdr and core ticks while idle
const GATES_MIN_MS = 5000; // the shortest gap between two gate runs (a hook writes the gate DB on every tool call; a run spawns python)

const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null);
const usageState = atom({ plugin: 'atlas', key: 'usage' } as const, { tokens: null, contextPct: null });
const taskAgentsState = atom({ plugin: 'atlas', key: 'taskAgents' } as const, []);
const orchState = atom({ plugin: 'atlas', key: 'orch' } as const, EMPTY_ORCH);
const killedState = atom({ plugin: 'atlas', key: 'killed' } as const, []); // ids/names a TaskStop ended (discipline.ts's tool.call hook writes it)
const headerPhaseState = atom({ plugin: 'atlas', key: 'headerPhase' } as const, null);
const paneOpenedState = atom({ plugin: 'atlas', key: 'paneOpened' } as const, false); // herdrTick stays idle until the pane has been opened

const gatesState = atom({ plugin: 'atlas', key: 'gates' } as const, []);

let herdrStdout = '';
let lastFingerprint = '';
const crewDone = new Set<string>(); // crew run dirs that are over or history: crewSig stats them no more
let rebuildRun: Promise<void> | null = null; // the rebuild in flight (see rebuild)
let rebuildFollow: Promise<void> | null = null; // the one queued run behind it
let movedAt = -Infinity; // clock ms of the last fingerprint change
let busy = false; // a host turn, a running agent or a worker's tool call was seen by the last fingerprint
const lastRun = new Map<string, number>(); // key -> clock ms of the last tick that ran while idle
let rebuildSeq = 0; // stamped on each snapshot; never reset, so a re-boot's snapshots stay newer than any late write

/** Forget the idle state (a new session starts awake). */
export function resetPollIdle(): void {
	movedAt = -Infinity;
	busy = false;
	lastRun.clear();
}

/** True when this tick of `key` should be skipped: the session is idle (no turn or live work, no hook event and no fingerprint move for IDLE_AFTER_MS)
 * and the last run was less than `gapMs` ago. Awake, it never skips, so the first tick after a hook event runs at once. */
export async function idleSkip($: EngineInterface, key: string, gapMs: number): Promise<boolean> {
	const now = await $.clock.now();
	if (busy || S.hostWorking || now - Math.max(movedAt, lastHookAt()) < IDLE_AFTER_MS) {
		lastRun.set(key, now);
		return false;
	}
	if (now - (lastRun.get(key) ?? -Infinity) < gapMs) return true;
	lastRun.set(key, now);
	return false;
}

/** Todos + channels + board note-file fingerprint: what a rebuild is due on. */
export async function dataFingerprint($: EngineInterface): Promise<string> {
	// The host's agent list moves without any data file changing (a subagent
	// finishing writes nothing), so its id:status pairs belong in the fingerprint,
	// or the pane keeps showing a finished agent as running.
	let agentRunning = false;
	const agentSig = await Promise.resolve()
		.then(() => $.agent.list())
		// A running subagent's transcript tail moves with no data file: re-bucket every 5 s while any runs.
		.then(async (rows) => (agentRunning = rows.some((a) => a.status === 'running'), `${rows.map((a) => `${a.id}:${a.status}`).join(',')}${rows.some((a) => a.status === 'running') ? `@${Math.floor((await $.clock.now()) / MUX_MS)}` : ''}`))
		.catch(() => '-');
	// Usage, header phase and header misses move on session.measure / turn.complete
	// with no file change; they feed the snapshot, so they belong here too.
	const liveSig = `${JSON.stringify(await read($, usageState))}:${await read($, headerPhaseState)}`;
	// Tool calls, moods and comms move on events with no file change; a 5 s bucket
	// keeps the elapsed counters fresh while anything is working.
	const orch = await read($, orchState);
	const acts = Object.entries(orch.activity);
	const orchSig = `${orch.comms.length}:${acts.map(([k, a]) => `${k}=${a.tool ?? ''}${a.toolCount}${a.mood}`).join(',')}:${acts.some(([, a]) => a.tool !== null) ? Math.floor((await $.clock.now()) / 5000) : 0}`;
	busy = agentRunning || acts.some(([, a]) => a.tool !== null);
	const snap = await read($, snapshotState);
	const root = snap?.root;
	if (root === undefined || root === null || root === '') return `no-root|${agentSig}|${liveSig}`;
	const base = `${root.replace(/\/+$/, '')}/.atlas/.run`;
	const stats = [`${base}/todos.json`, `${base}/channels.json`, `${base}/findings.json`, `${base}/board`]; // the board dir moves when a new owner's file appears
	// Only the board files the snapshot can show (a note by anyone else is picked up by the 5 s bucket below while work runs), never every file on disk.
	for (const owner of boardOwners(snap ?? {})) stats.push(`${base}/board/${owner}.jsonl`);
	const parts = [agentSig, liveSig, orchSig, ...(await Promise.all(stats.map((p) => statSig($, p))))];
	if (busy || S.hostWorking) parts.push(`w${Math.floor((await $.clock.now()) / MUX_MS)}`);
	parts.push(await crewSig(engineFs($), root, crewDone, await $.clock.now()));
	return parts.join('|');
}

/** `atlas_wt.py status` rows, re-run at most every WT_MS (git is the slow part). */
async function worktrees($: EngineInterface, now: number): Promise<WtRow[]> {
	if (now - S.wtAt >= WT_MS && !(await idleSkip($, 'wt', IDLE_TICK_MS))) {
		S.wtAt = now;
		const root = (await read($, snapshotState))?.root;
		const out = root ? await $.process.run(['python3', `${$.plugin.root}/scripts/atlas_wt.py`, '--root', root, 'status']).catch(() => undefined) : undefined;
		S.wtRows = out?.exitCode === 0 ? parseWt(out.stdout) : [];
	}
	return S.wtRows;
}

/**
 * Rebuild the snapshot from disk + live state; never throws. Serialized: one run in flight, every request that arrives
 * meanwhile (rebuild, mux, herdr and core ticks, the file watcher) shares ONE follow-up run, so two runs never resolve out of
 * order and the last write is always the newest build.
 */
export function rebuild($: EngineInterface): Promise<void> {
	if (rebuildRun === null) {
		const run: Promise<void> = rebuildOnce($).finally(() => {
			if (rebuildRun === run) rebuildRun = null;
		});
		rebuildRun = run;
		return run;
	}
	rebuildFollow ??= rebuildRun.then(() => {
		rebuildFollow = null;
		return rebuild($);
	});
	return rebuildFollow;
}

/** Wave 37: the completion signal the transcript card is drawn from (the lead's `<task-notification>`) ends the named worker in data/live.ts at once, then a rebuild redraws the HUD rows and the band, so the card and the rows change in one render. */
export async function noteNotified($: EngineInterface, text: string): Promise<void> {
	const ends = notifiedEnds(text);
	if (ends.length === 0) return;
	const at = await $.clock.now().catch(() => Date.now());
	for (const x of ends) noteEnded(S.nameMemo[x.id] ?? x.id, x.outcome, at);
	void rebuild($).catch(() => undefined);
}

async function rebuildOnce($: EngineInterface): Promise<void> {
	if (S.builder === null) return;
	const seq = ++rebuildSeq;
	let listed: { id: string; status: string }[] = [];
	const names: Record<string, string> = {};
	try {
		const rows = await $.agent.list();
		listed = rows.map((a) => ({ id: a.id, status: a.status }));
		const { meta } = await read($, orchState);
		const spawnNow = await $.clock.now();
		const killedIds = await read($, killedState);
		await update($, taskAgentsState, (agents) => {
			// the same rows the squad gets, keyed by host id: a label belongs to one id, never to a list position
			for (const m of mapListed(rows, agents, meta, S.nameMemo)) names[m.id] = m.agent.name;
			return syncAgentsFromList(rows, agents, meta, spawnNow, S.nameMemo, killedIds);
		});
		Object.assign(S.nameMemo, names);
		// A worker the host lists as finished whose own turn.complete never reached us (or carried no
		// agentId): report it by the host row's id, never by guessing a running worker.
		const gone = rows.filter((a) => HOST_DONE[a.status] !== undefined);
		if (gone.length > 0) {
			await update($, orchState, (o) =>
				gone.reduce(
					(acc, a) =>
						acc.stage[a.id] === undefined || acc.stage[a.id] === 'reported'
							? acc
							: onComplete(acc, a.id, { reason: HOST_DONE[a.status] ?? 'answer', answer: '', tokens: 0 }, spawnNow),
					o,
				),
			);
		}
	} catch {
		// no agent list in this harness: keep spawn-recorded agents
	}
	try {
		const now = await $.clock.now();
		const snap = await S.builder.build({
			headerPhase: await read($, headerPhaseState),
			taskAgents: await read($, taskAgentsState),
			mux: S.muxAgents,
			herdrStdout,
			usage: await read($, usageState),
			now,
			orch: await read($, orchState),
			names: { ...S.nameMemo },
			listed,
			wt: await worktrees($, now),
		});
		// The snapshot write redraws the band, pane and restyles that read it. Stamped; an older build never replaces a newer one.
		const stamped = { ...snap, seq };
		const prior: { snap: AtlasSnapshot | null } = { snap: null };
		await update($, snapshotState, (cur) => { prior.snap = cur; return cur && isOlder(cur, stamped) ? cur : stamped; });
		noteHeaderPattern(stamped.contract.headerFirstLinePattern); // the chip draws from this copy, with no state read (restyle.tsx)
		// A worker that finished in this build gets its transcript card now, from the tick that moved its HUD row (critique 14 B3: the host's own row
		// came 5 s later, when the lead took the notification up). An older build never places one.
		if (!prior.snap || !isOlder(prior.snap, stamped)) await placeFinished($, prior.snap, stamped);
		// The board keeps its last good rows; say why they may be stale.
		if (S.builder.todoError !== undefined) reportFailure($, `atlas: todos.json is ${S.builder.todoError}, showing the last good board`);
	} catch (err) {
		reportFailure($, `atlas: rebuild failed: ${String(err)}`, 'mod.error.rebuild');
		lastFingerprint = ''; // the poll recorded this build's fingerprint before it ran: forget it so the next tick retries instead of waiting for another file change
		// keep the last good snapshot
	}
}

/** The rest-time pane open the first render asked for, done from a tick where `$.state` writes are allowed. Below 144 columns the engine keeps it undrawn (no toast: the first prompt opens it). */
export async function dockTick($: EngineInterface): Promise<void> {
	if (!S.dockWanted) return;
	S.dockWanted = false;
	await update($, paneOpenedState, () => true);
	const wide = (S.lastViewport?.columns ?? 0) >= DOCK_MIN_COLUMNS;
	void $.ui.open(PANE_DOCK).then((r) => { S.dockedAtRest = r.isPlaced; if (wide) toastUnplaced($, r); });
	void noteUsage($, 'mod.open.dock');
}

/** Signature of the files that mark the gates stale: todos.json and findings.json under <root>/.atlas/.run. */
async function gatesSigOf($: EngineInterface, root: string): Promise<string> {
	const run = `${root.replace(/\/+$/, '')}/.atlas/.run`;
	// The gate DB and its WAL are not inputs here: a hook writes the WAL on every tool call, so watching it re-ran python at the throttle rate for as long as the session lived.
	// The DB-backed checks refresh at Stop / turn.complete and on the backstop while a turn runs (hooks.ts).
	const paths = [`${run}/todos.json`, `${run}/findings.json`];
	return (await Promise.all(paths.map((p) => statSig($, p)))).join('|');
}

/** The gate groups with this session's Stop verdict (`stop-verdict.json`, completion_gate_core's record) written into the completion group as the `stop-verdict` line
 * atlas_gates.py would print: `Last Stop blocked` with the recorded plain words as its detail, or `Last Stop allowed`. A record without this session leaves the groups as they are. */
export function withStopVerdict(groups: readonly GateGroup[], text: string, session: string): GateGroup[] {
	let rec: { blocked?: unknown; why?: unknown } | undefined;
	try {
		rec = (JSON.parse(text) as { sessions?: Record<string, { blocked?: unknown; why?: unknown }> }).sessions?.[session];
	} catch {
		return [...groups];
	}
	if (!rec) return [...groups];
	const why = (Array.isArray(rec.why) ? rec.why : []).map((x) => String(x).trim()).filter(Boolean);
	const line: GateLine = rec.blocked === true ? { id: 'stop-verdict', label: 'Last Stop blocked', ok: true, detail: why.join(', ') || 'gate' } : { id: 'stop-verdict', label: 'Last Stop allowed', ok: true };
	if (!groups.some((g) => g.id === 'completion')) return [...groups, { id: 'completion', title: 'Completion gate', lines: [line] }];
	return groups.map((g) => (g.id === 'completion' ? { ...g, lines: [...g.lines.filter((l) => l.id !== 'stop-verdict'), line] } : g));
}

/** One stat of the Stop verdict file. When it moved, the verdict is read and written into the gate groups on THIS call (the band flips to BLOCKED on the refusal's own frame, not
 * after the atlas_gates.py run that follows), and the full run is queued as urgent. Called every poll and, while Atlas works, every spinner tick. */
export async function verdictPoll($: EngineInterface, root: string): Promise<void> {
	if (root === '' || S.sessionUuid === '') return;
	const path = `${root.replace(/\/+$/, '')}/.atlas/.run/stop-verdict.json`;
	const vsig = await statSig($, path);
	const moved = S.verdictSig !== '' && vsig !== S.verdictSig;
	S.verdictSig = vsig;
	if (!moved) return;
	S.gatesUrgent = S.gatesDirty = true;
	const text = await $.fs.read(path).catch(() => undefined);
	if (text === undefined) return;
	const groups = await read($, gatesState);
	const next = withStopVerdict(groups, text, S.sessionUuid);
	if (JSON.stringify(next) !== JSON.stringify(groups)) await update($, gatesState, () => next);
}

/** POLL_MS tick: a change to a gate file marks the gates stale; they re-run on this poll once GATES_MIN_MS has passed since
 * the last run (never wait out the 30 s backstop to show a check that just failed). The run starts here and is not awaited:
 * the tick must not wait on a python run (gatesBusy keeps a second one from starting). */
async function gatesPoll($: EngineInterface): Promise<void> {
	const root = rootOf(await read($, snapshotState));
	if (root === '' || S.sessionUuid === '') return;
	const sig = await gatesSigOf($, root);
	if (S.gatesSig !== '' && sig !== S.gatesSig) S.gatesDirty = true; // the first sight only records
	S.gatesSig = sig;
	// The Stop verdict is the one file that is not throttled: a refusal must reach the band on the poll that sees it. One stat per poll.
	await verdictPoll($, root);
	if (S.gatesDirty && !S.gatesBusy && (S.gatesUrgent || (await $.clock.now()) - S.gatesRunAt >= GATES_MIN_MS)) void runGates($).catch(() => undefined);
}

/** POLL_MS tick: rebuild only when the data files moved. */
export async function rebuildTick($: EngineInterface): Promise<void> {
	await dockTick($);
	if (S.builder === null) return;
	if (await idleSkip($, 'poll', IDLE_POLL_MS)) return;
	await gatesPoll($).catch(() => undefined);
	const fingerprint = await dataFingerprint($);
	if (fingerprint === lastFingerprint && (await read($, snapshotState)) !== null) return;
	lastFingerprint = fingerprint;
	movedAt = await $.clock.now();
	await rebuild($);
}

/** 5 s tick: herdr pane status, only once the pane was opened. */
export async function herdrTick($: EngineInterface): Promise<void> {
	if (!(await read($, paneOpenedState)) || (await read($, snapshotState)) === null) return;
	if (await idleSkip($, 'herdr', IDLE_TICK_MS)) return;
	const out = await $.process
		.run(['python3', `${$.plugin.root}/scripts/atlas_herdr.py`, 'status'])
		.catch(() => undefined);
	if (out === undefined || out.stdout === herdrStdout) return;
	herdrStdout = out.stdout;
	await rebuild($);
}

/** 5 s tick: atlas_mux.py status of the lead channel's run (`--run` is the channel's last segment) and of each
 * spawn-team team on that channel (a team registers under its team id); rebuilds when the output or a pane tool moved. */
export async function muxTick($: EngineInterface): Promise<void> {
	const snap = await read($, snapshotState);
	const root = rootOf(snap);
	if (root === '' || snap === null) return;
	if (await idleSkip($, 'mux', IDLE_TICK_MS)) return;
	// No early return on zero runs: a reaped team (record archived, no board channel) must clear its lanes, not freeze them.
	const { runs, own } = await muxRuns($, root, snap);
	const outs = await Promise.all(runs.map((r) => muxStatus($, root, r.id)));
	const agents = await withPaneTools($, root, ownRows(outs.flatMap((o, i) => parseMuxStatus(o, runs[i]!.members)), own));
	const sig = `${outs.join('\n')}|${agents.map((a) => `${a.tool ?? ''}${a.lastTool ?? ''}${a.target ?? ''}${a.uses ?? ''}`).join(',')}`;
	if (sig === S.muxStdout) return;
	S.muxStdout = sig;
	S.muxAgents = agents;
	await rebuild($);
}

/** `--root` is a `status` option: before the subcommand argparse rejects it (exit 2), which kept every mux row out. */
async function muxStatus($: EngineInterface, root: string, run: string): Promise<string> {
	const out = await $.process.run(['python3', `${$.plugin.root}/scripts/atlas_mux.py`, 'status', '--run', run, '--root', root]).catch(() => undefined);
	return out?.exitCode === 0 ? out.stdout : '';
}

/** Status runs: the board channel's, plus each `.atlas/.run/teams/<id>.json` team on the board channel or on this
 * session's lead channel (`<folder>@<branch>/lead-<session6>`, which the board channel need not be). `own`: the
 * worker names this session may show (team members and board members). */
async function muxRuns($: EngineInterface, root: string, snap: AtlasSnapshot): Promise<{ runs: { id: string; members: string[] }[]; own: Set<string> }> {
	const dir = `${root.replace(/\/+$/, '')}/.atlas/.run/teams`;
	const names = (await $.fs.list(dir).catch(() => [])).map((e) => e.name).filter((n) => n.endsWith('.json'));
	const records = await Promise.all(names.map(async (name) => ({ name, text: (await $.fs.read(`${dir}/${name}`).catch(() => undefined)) ?? '' })));
	const board = snap.channel ?? '';
	const teams = teamsOf(records, [board, `lead-${snap.sessionId.slice(0, 6)}`]);
	const runs = [...(board ? [{ id: board.split('/').pop() ?? board, members: [] }] : []), ...teams];
	return { runs, own: new Set([...teams.flatMap((t) => t.members), ...snap.members.map((m) => m.name)]) };
}

/** Tool uses that appeared in a pane log since the last read become calls at `now` (the first read is the baseline). */
function paneCalls(name: string, uses: number, now: number): number[] {
	const prev = (S.muxCalls[name] ??= { uses, calls: [] });
	for (let n = prev.uses; n < uses; n++) prev.calls = pushCall(prev.calls, now);
	prev.uses = uses;
	return prev.calls;
}

/** Running team workers get their tool / last tool / target from their pane log (the pane feed writes stream-json there)
 * and a first-seen start, so the lane's age counts up. ponytail: reads each running worker's whole log every MUX_MS;
 * tail-read if logs grow past a few MB. */
async function withPaneTools($: EngineInterface, root: string, agents: SquadAgent[]): Promise<(SquadAgent & TeamTool)[]> {
	const logs = `${root.replace(/\/+$/, '')}/.atlas/.run/logs`;
	const now = await $.clock.now();
	return Promise.all(
		agents.map(async (a) => {
			const startedAt = (S.muxFirstSeen[a.name] ??= now);
			if (a.state !== 'running') return a;
			const log = (await $.fs.read(`${logs}/${a.name}.log`).catch(() => undefined)) ?? '';
			const pane = paneTool(log);
			return { ...a, state: paneExit(log) ?? a.state, startedAt, ...pane, calls: paneCalls(a.name, pane.uses ?? 0, now) };
		}),
	);
}

/** Current branch of `cwd` (fall back to 'main' outside a repo). */
export async function gitBranch($: EngineInterface, cwd: string): Promise<string> {
	try {
		const out = await $.process.run(['git', '-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD']);
		const branch = out.stdout.trim();
		S.branchName = branch === '' ? undefined : branch; // wave 42: the health card prints the branch git really said, never the `main` fallback below
		return branch === '' ? 'main' : branch;
	} catch {
		return 'main';
	}
}

/** Z4: whether `tmux` runs on this machine, probed once at boot (a missing binary is a plain `no`); never throws. */
export async function probeTmux($: EngineInterface): Promise<void> {
	try {
		const out = await $.process.run(['tmux', '-V']);
		S.tmuxHere = out.exitCode === 0;
	} catch {
		S.tmuxHere = false;
	}
}

/** Gate groups from one atlas_gates.py run; a nonzero exit or bad JSON becomes a single error group. */
function groupsFromRun(out: { exitCode: number; stdout: string; stderr: string }): GateGroup[] {
	try {
		if (out.exitCode !== 0) throw new Error(out.stderr.trim().split('\n').pop() || `exit ${out.exitCode}`);
		return parseGates(out.stdout);
	} catch (err) {
		return [gatesError(err instanceof Error ? err.message : String(err))];
	}
}

/** Run atlas_gates.py and store its groups; a missing script, nonzero exit or bad JSON becomes an error group. Skips when a run is in flight. */
export async function runGates($: EngineInterface): Promise<void> {
	if (S.gatesBusy || S.sessionUuid === '') return;
	const root = rootOf(await read($, snapshotState));
	if (root === '') return;
	S.gatesBusy = true;
	S.gatesRunAt = await $.clock.now();
	S.gatesDirty = false;
	S.gatesUrgent = false;
	try {
		const out = await $.process
			.run(['python3', `${$.plugin.root}/scripts/atlas_gates.py`, '--session', S.sessionUuid, '--root', root, '--json'])
			.catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }));
		const groups = groupsFromRun(out);
		noteGatesRead(groups, await $.clock.now());
		await update($, gatesState, () => groups);
	} finally {
		S.gatesBusy = false;
	}
}
