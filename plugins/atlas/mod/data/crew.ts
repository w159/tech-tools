// atlas_crew runs: .atlas/.run/crew/<run-id>/{run.json,summary.json,pid/,exit/,logs/,irc/{log.jsonl,members.json}}
// -> squad rows + channel notes. Pure over FsLike; never throws (a torn or missing file just drops that piece).
// The mod cannot signal processes, so liveness comes from the files alone: summary.json (written when the
// supervisor ends the run, including after `atlas_crew.py kill`) or a `final` log line marks the run over, and a
// pid without an exit file whose pid and transcript files have gone quiet for STALE_MS is a dead worker.
import type { AgentState, ChannelNote, FsLike, SquadAgent } from '../contract';
import { isoTs } from './channels';

const RECENT_MS = 30 * 60_000; // a run whose files are all older than this is history, not live
const STALE_MS = 10 * 60_000; // a pid with no exit file and no transcript growth for this long is dead
const MAX_NOTES = 100;
type Rec = Record<string, unknown>;
type Exit = { code: number; mt: number };
type CrewRead = { agents: SquadAgent[]; notes: ChannelNote[] };

const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
const asRec = (v: unknown): Rec | undefined => (v && typeof v === 'object' ? (v as Rec) : undefined);
const field = (v: unknown, k: string): unknown => asRec(v)?.[k];
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const isStr = (v: string | undefined): v is string => !!v;
const parse = (raw: string): unknown => {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined; // blank or torn: drop it
	}
};
const readText = async (fs: FsLike, path: string): Promise<string> => (await fs.read(path).catch(() => undefined)) ?? '';
const json = async (fs: FsLike, path: string): Promise<Rec | undefined> => asRec(parse(await readText(fs, path)));

const names = async (fs: FsLike, dir: string): Promise<string[]> => (await fs.list(dir).catch(() => [])).map(base);
const mtime = async (fs: FsLike, p: string): Promise<number> => (await fs.stat(p).catch(() => undefined))?.mtimeMs ?? 0;

const nameOf = (w: unknown): string | undefined => str(w) ?? str(field(w, 'name'));
const pick = (xs: unknown): string[] => arr(xs).map(nameOf).filter(isStr);

/** Worker names: run.json plan.workers, else irc/members.json members (strings or {name}). */
function workerNames(run: Rec, members: Rec | undefined): string[] {
	const plan = pick(field(run.plan, 'workers'));
	const lead = field(members, 'lead');
	return plan.length ? plan : pick(field(members, 'members')).filter((n) => n !== lead);
}

interface RunFacts {
	dir: string;
	now: number;
	over: boolean;
	sumExit: Map<string, unknown>;
	exits: Map<string, Exit>;
	pids: Set<string>;
	logFiles: string[];
}

function parseLines(raw: string): Rec[] {
	return raw.split('\n').map((l) => asRec(parse(l))).filter((r): r is Rec => r !== undefined);
}

function summaryExits(summary: Rec | undefined): Map<string, unknown> {
	const out = new Map<string, unknown>();
	for (const w of arr(field(summary, 'workers'))) {
		const name = str(field(w, 'name'));
		if (name !== undefined) out.set(name, field(w, 'exit'));
	}
	return out;
}

const roundOf = (f: string): { name: string; round: number } | undefined => {
	const m = /^(.+)\.r(\d+)\.json$/.exec(f);
	return m ? { name: m[1]!, round: Number(m[2]) } : undefined;
};
const newer = (rounds: Map<string, number>, r: { name: string; round: number }): boolean => r.round >= (rounds.get(r.name) ?? -1);
const exitCode = (v: unknown): number => (typeof v === 'number' ? v : 1);

/** worker -> exit of its highest round */
async function readExits(fs: FsLike, dir: string): Promise<Map<string, Exit>> {
	const exits = new Map<string, Exit>();
	const rounds = new Map<string, number>();
	for (const f of await names(fs, `${dir}/exit`)) {
		const r = roundOf(f);
		if (!r || !newer(rounds, r)) continue;
		rounds.set(r.name, r.round);
		const code = exitCode(field(await json(fs, `${dir}/exit/${f}`), 'exit'));
		exits.set(r.name, { code, mt: await mtime(fs, `${dir}/exit/${f}`) });
	}
	return exits;
}

const byCode = (code: number): AgentState => (code === 0 ? 'finished' : 'failed');

/** An exit file decides the state once the run is over or no newer pid file follows it. */
const exitCounts = (f: RunFacts, ex: Exit | undefined, pidMt: number): ex is Exit => ex !== undefined && (f.over || pidMt <= ex.mt);

async function pidTime(fs: FsLike, f: RunFacts, name: string): Promise<number> {
	return f.pids.has(name) ? mtime(fs, `${f.dir}/pid/${name}`) : 0;
}

function overState(f: RunFacts, name: string): AgentState {
	const s = f.sumExit.get(name);
	return typeof s === 'number' ? byCode(s) : 'dead'; // killed or never exited
}

async function freshness(fs: FsLike, f: RunFacts, name: string, pidMt: number): Promise<number> {
	let fresh = pidMt;
	for (const l of f.logFiles) if (l.startsWith(`${name}.`)) fresh = Math.max(fresh, await mtime(fs, `${f.dir}/logs/${l}`));
	return fresh;
}

async function liveState(fs: FsLike, f: RunFacts, name: string, pidMt: number): Promise<AgentState> {
	if (!f.pids.has(name)) return 'spawning';
	return f.now - (await freshness(fs, f, name, pidMt)) > STALE_MS ? 'dead' : 'running';
}

async function workerState(fs: FsLike, f: RunFacts, name: string): Promise<AgentState> {
	const ex = f.exits.get(name);
	const pidMt = await pidTime(fs, f, name);
	if (exitCounts(f, ex, pidMt)) return byCode(ex.code);
	if (f.over) return overState(f, name);
	return liveState(fs, f, name, pidMt);
}

const seqOf = (v: unknown): number => Number(v) || 0;
const noteKind = (v: unknown): string | undefined => {
	const k = str(v);
	return k !== 'exit' ? k : undefined;
};

function logNote(r: Rec, id: string): ChannelNote | undefined {
	const text = str(r.text);
	if (text === undefined) return undefined;
	return { ts: isoTs(r.ts), seq: seqOf(r.seq), owner: str(r.from) ?? '', to: str(r.to), text, channel: `#${id}`, kind: noteKind(r.kind) };
}

function logNotes(lines: Rec[], id: string): ChannelNote[] {
	return lines.slice(-MAX_NOTES).map((r) => logNote(r, id)).filter((n): n is ChannelNote => n !== undefined);
}

async function lastTouched(fs: FsLike, dir: string): Promise<number> {
	return Math.max(...(await Promise.all(['run.json', 'irc/log.jsonl', 'summary.json'].map((f) => mtime(fs, `${dir}/${f}`)))));
}

/** run.json of a run touched within RECENT_MS, else undefined. */
async function liveRun(fs: FsLike, dir: string, now: number): Promise<Rec | undefined> {
	const run = await json(fs, `${dir}/run.json`);
	if (!run) return undefined;
	return now - (await lastTouched(fs, dir)) > RECENT_MS ? undefined : run;
}

const runOver = (summary: Rec | undefined, lines: Rec[]): boolean => summary !== undefined || lines.some((r) => r.kind === 'final');

async function runFacts(fs: FsLike, dir: string, now: number, lines: Rec[]): Promise<RunFacts> {
	const summary = await json(fs, `${dir}/summary.json`);
	return {
		dir, now,
		over: runOver(summary, lines),
		sumExit: summaryExits(summary),
		exits: await readExits(fs, dir),
		pids: new Set(await names(fs, `${dir}/pid`)),
		logFiles: (await names(fs, `${dir}/logs`)).filter((f) => f.endsWith('.log')),
	};
}

async function readRun(fs: FsLike, crewDir: string, id: string, now: number): Promise<CrewRead | undefined> {
	const dir = `${crewDir}/${id}`;
	const run = await liveRun(fs, dir, now);
	if (!run) return undefined;
	const lines = parseLines(await readText(fs, `${dir}/irc/log.jsonl`));
	const facts = await runFacts(fs, dir, now, lines);
	const agents: SquadAgent[] = [];
	for (const name of workerNames(run, await json(fs, `${dir}/irc/members.json`))) {
		agents.push({ name, persona: 'unknown', source: 'task', transport: 'crew', state: await workerState(fs, facts, name) });
	}
	return { agents, notes: logNotes(lines, id) };
}

/** Worker rows and log notes of every live or recent crew run under `root`. */
export async function readCrew(fs: FsLike, root: string, now: number): Promise<CrewRead> {
	const agents: SquadAgent[] = [];
	const notes: ChannelNote[] = [];
	const crewDir = `${root.replace(/\/+$/, '')}/.atlas/.run/crew`;
	for (const id of await names(fs, crewDir)) {
		const r = await readRun(fs, crewDir, id, now);
		if (!r) continue;
		agents.push(...r.agents);
		notes.push(...r.notes);
	}
	return { agents, notes };
}

/** Change signature of every crew run: run.json, summary.json, irc/log.jsonl and the exit/pid/logs dirs (their mtime moves on add). */
export async function crewSig(fs: FsLike, root: string): Promise<string> {
	const crewDir = `${root.replace(/\/+$/, '')}/.atlas/.run/crew`;
	const sig = async (p: string): Promise<string> => {
		const s = await fs.stat(p).catch(() => undefined);
		return s ? `${s.mtimeMs}:${s.size}` : '-';
	};
	const parts: string[] = [];
	for (const id of await names(fs, crewDir)) {
		for (const f of ['run.json', 'summary.json', 'irc/log.jsonl', 'exit', 'pid', 'logs']) parts.push(`${id}/${f}=${await sig(`${crewDir}/${id}/${f}`)}`);
	}
	return parts.join(',');
}
