// host/core-tick.ts: the Atlas core poll: reads, core model, toasts.
// Split out of mod/register.ts (plan docs/plans/2026-11-18_atlas-mod-reorg-plan.md section 7); no behavior change.
import { atom, type EngineInterface, read, update } from 'claude-code';
import type { AtlasSnapshot } from '../contract';
import type { GateGroup } from '../view/panel/pane/sidebar';
import { planBasis } from '../data/todos';
import { headerGroup, openGateCount } from './gates';
import { channelMembers, coreModel, type CoreModel, hasCore, type ReportNote } from '../data/core';
import { drawnHeaderTally } from '../view/transcript/restyle';
import { EMPTY_ORCH } from '../data/orchestration';
import { reportFailure, S } from './atoms';
import { noteRoutesRead } from '../data/readinfo';
import { boardOwners } from '../data/channels';

const isModOn = atom({ plugin: 'atlas', key: 'isModOn' } as const, true); // ATLAS_MOD kill switch, set at session.start
const isInteractive = atom({ plugin: 'atlas', key: 'isInteractive' } as const, false);
const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null);

const orchState = atom({ plugin: 'atlas', key: 'orch' } as const, EMPTY_ORCH);

const lastHeaderState = atom({ plugin: 'atlas', key: 'lastHeader' } as const, null);
const gatesState = atom({ plugin: 'atlas', key: 'gates' } as const, []);

const coreState = atom({ plugin: 'atlas', key: 'core' } as const, null); // CoreModel or null; written by coreTick, read by the band and pane renders
const headerTallyState = atom({ plugin: 'atlas', key: 'headerTally' } as const, { ok: 0, total: 0 }); // main-agent answers that opened with the ATLAS header, of all answers

let coreSeen: Set<string> | null = null; // verdict `id:status` seen by the last coreTick; null until its first (baseline) read
let coreFinished: Record<string, boolean> = {}; // worker -> its offload had finished at the last coreTick
let coreFiles: Record<string, { key: string; text: string }> = {}; // core inputs keyed by path, re-read only when size or mtime moved
let reportMemo: Record<string, { text: string; notes: ReportNote[] }> = {}; // parsed board reports per path; re-parsed only when the cached text changed
let coreTouched = new Set<string>(); // paths read by the build in progress; the rest are evicted after it
let coreFindingsOk = true; // findings.json was readable in the last buildCore

// ---- the Atlas core -----------------------------------------------------------

/** A fresh session: the next coreTick is a baseline again. */
export function resetCore(): void {
	S.gatesSig = '';
	S.gatesDirty = false;
	S.gatesUrgent = false;
	S.verdictSig = '';
	S.gatesRunAt = -Infinity;
	coreSeen = null;
	coreFinished = {};
	coreFiles = {};
	reportMemo = {};
	coreTouched = new Set();
	coreFindingsOk = true;
	S.wtAt = -Infinity;
	S.wtRows = [];
}

/** `<path>` text, re-read only when its size or mtime moved; null when missing or unreadable. */
async function readCached($: EngineInterface, path: string): Promise<string | null> {
	const st = await $.fs.stat(path).catch(() => undefined);
	if (st === undefined) return null;
	coreTouched.add(path);
	const key = `${st.size}:${st.mtimeMs}`;
	const hit = coreFiles[path];
	if (hit?.key === key) return hit.text;
	const text = await $.fs.read(path).catch(() => undefined);
	if (text === undefined) return null;
	coreFiles[path] = { key, text };
	return text;
}

const parses = (text: string): boolean => {
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
};

/** `readCached`, '' when missing. */
async function readGrown($: EngineInterface, path: string): Promise<string> {
	return (await readCached($, path)) ?? '';
}

async function namesIn($: EngineInterface, dir: string, keep: (name: string) => boolean): Promise<string[]> {
	return (await $.fs.list(dir).catch(() => [])).map((e) => e.name).filter(keep).sort();
}

/** Board `report` notes (ts in epoch seconds) from .atlas/.run/board/*.jsonl. */
function reportsOf(text: string): ReportNote[] {
	return text.split('\n').flatMap((line): ReportNote[] => {
		try {
			const n = JSON.parse(line) as { kind?: unknown; owner?: unknown; text?: unknown; ts?: unknown };
			return n.kind === 'report' && typeof n.owner === 'string' && typeof n.text === 'string' ? [{ owner: n.owner, text: n.text, at: (typeof n.ts === 'number' ? n.ts : 0) * 1000 }] : [];
		} catch {
			return [];
		}
	});
}

function reportsMemo(path: string, text: string): ReportNote[] {
	const hit = reportMemo[path];
	if (hit?.text === text) return hit.notes;
	const notes = reportsOf(text);
	reportMemo[path] = { text, notes };
	return notes;
}
/** The lead's transcript rows; empty when the host gives none. */
export async function leadMessages($: EngineInterface): Promise<{ role: string; text: string }[]> {
	try {
		const rows = await $.session.messages();
		return Array.isArray(rows) ? (rows as { role: string; text: string }[]) : [];
	} catch {
		return [];
	}
}

/** `report` notes of the board files the snapshot can show (`<owner>.jsonl` of its members, squad, notes and this session's dispatches); the rest of board/ is history. */
async function boardReports($: EngineInterface, base: string, snap: AtlasSnapshot): Promise<ReportNote[]> {
	const owners = boardOwners(snap);
	for (const name of Object.keys((await read($, orchState)).meta)) owners.add(name);
	const boards = await namesIn($, `${base}/board`, (n) => n.endsWith('.jsonl') && owners.has(n.slice(0, -'.jsonl'.length)));
	return (await Promise.all(boards.map(async (n) => reportsMemo(`${base}/board/${n}`, await readGrown($, `${base}/board/${n}`))))).flat();
}

/** This channel's member and dispatch logs by worker name; coreModel drops every other log, so only these are stat-ed (`logs/` holds hundreds). */
async function memberLogs($: EngineInterface, base: string, snap: AtlasSnapshot, teams: { text: string }[]) {
	const channels = [snap.channel ?? '', `lead-${(snap.sessionId ?? '').slice(0, 6)}`]; // a snapshot without a session id (older fixtures) matches no lead channel
	const dispatches = Object.values((await read($, orchState)).meta);
	const mine = channelMembers(teams, channels);
	for (const d of dispatches) if (d.name) mine.add(d.name);
	const names = await namesIn($, `${base}/logs`, (n) => n.endsWith('.log') && mine.has(n.slice(0, -'.log'.length)));
	const logs: Record<string, string> = {};
	for (const n of names) logs[n.replace(/\.log$/, '')] = await readGrown($, `${base}/logs/${n}`);
	return { channels, dispatches, logs };
}
/** The core model from the run scratch under the snapshot root; null without a board root. Reads only. */
export async function buildCore($: EngineInterface): Promise<CoreModel | null> {
	const snap = await read($, snapshotState);
	const root = snap?.root || '';
	if (snap === null || root === '') return null;
	const base = `${root.replace(/\/+$/, '')}/.atlas/.run`;
	coreTouched = new Set();
	const teamReads = await Promise.all((await namesIn($, `${base}/teams`, (n) => n.endsWith('.json'))).map(async (name) => ({ name, text: await readCached($, `${base}/teams/${name}`) }))); // null = stat or read failed
	const teams = teamReads.map((t) => ({ name: t.name, text: t.text ?? '' }));
	const { channels, dispatches, logs } = await memberLogs($, base, snap, teams);
	const reports = await boardReports($, base, snap);
	const findings = await readCached($, `${base}/findings.json`);
	coreFindingsOk = findings !== null && (findings.trim() === '' || parses(findings)); // a partial write keeps the seen set
	const matrixRead = await readCached($, `${$.plugin.root}/contracts/scope-matrix.json`);
	const matrix = matrixRead ?? '';
	noteRoutesRead({ matrix: matrixRead, teams: teamReads }, await $.clock.now()); // the routes tab marks a failed read (data/readinfo.ts)
	for (const path of Object.keys(coreFiles)) if (!coreTouched.has(path)) delete coreFiles[path];
	return coreModel({
		findings: findings ?? '',
		teams,
		matrix,
		logs,
		reports,
		todos: planBasis(snap.todos ?? [], snap.sessionId), // the plan the band counts: no dispatch rows, advisor notes or other sessions' rows
		header: ((t, d) => ({ ok: Math.max(t.ok, d.ok), total: Math.max(t.total, d.total) }))(await read($, headerTallyState), drawnHeaderTally()), // the transcript draws a chip per text block; turn.complete counts one answer per turn
		openGates: openGateCount(await gateGroups($)),
			// same channels teamsOf gets in muxRuns; dispatches are the orchestration spawn rows this mod already holds
			channels, // a snapshot without a session id (older fixtures) matches no lead channel
			dispatches,
		...(S.sessionStartMs !== null ? { since: S.sessionStartMs } : {}), // the ledger counts this session's findings, not the file lifetime
	});
}

/** What moved since the last read: a refuted verdict plays its sound. No host toast for a verdict or an offload that finished (critique 16 C2: the host box over
 * the transcript came back in the stop runs); the core tab says it. The first read does nothing. */
function coreToasts($: EngineInterface, m: CoreModel, seen: Set<string> | null): void {
	if (seen === null) return;
	for (const v of m.verdicts) {
		if (seen.has(`${v.id}:${v.status}`)) continue;
		if (v.status === 'rejected' && S.soundOn()) void $.audio.play({ asset: 'mod/motion/fx/fail.wav' }).catch(() => {});
	}
}

/** MUX_MS tick (interactive sessions, never from a render): rebuild the core, toast what moved, store it when it changed. */
export async function coreTick($: EngineInterface): Promise<void> {
	try {
		if (!(await read($, isModOn)) || !(await read($, isInteractive))) return;
		const built = await buildCore($);
		if (built === null) return;
		const first = coreSeen === null;
		coreToasts($, built, coreSeen);
		if (coreFindingsOk) coreSeen = new Set(built.verdicts.map((v) => `${v.id}:${v.status}`)); // a missing findings.json keeps the seen set
		coreFinished = Object.fromEntries(built.offload.workers.map((w) => [w.name, w.finished]));
		const model = hasCore(built) ? built : null;
		if (JSON.stringify(model) === JSON.stringify(await read($, coreState)) && !first) return;
		await update($, coreState, () => model);
	} catch (err) {
		reportFailure($, `atlas: core tick failed: ${String(err)}`);
	}
}

/** Script groups plus the header group built from the last answer. */
export async function gateGroups($: EngineInterface): Promise<GateGroup[]> {
	return [...(await read($, gatesState)).filter((g) => g.id !== 'header'), headerGroup(await read($, lastHeaderState))];
}
