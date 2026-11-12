// Board + roster readers for the Atlas mod: pure logic over FsLike (register.ts adapts $.fs).
// Ported from plugins/atlas/omp/channel-view.ts (readChannelNotes/formatNote) — mods have no Node APIs,
// so paths join with '/' and parsing is defensive. Never shells out to atlas_todo.py.
import type { ChannelMember, ChannelNote, FsLike } from '../contract';

const MAX_NOTES = 500;
const MAX_LINE = 110;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Board ts as a string the rest of the mod can rely on: ISO when parseable, '' when absent. */
export function isoTs(ts: unknown): string {
	if (typeof ts === 'number' && Number.isFinite(ts)) {
		const ms = ts < 1e12 ? ts * 1000 : ts; // epoch seconds vs ms
		const d = new Date(ms);
		return Number.isNaN(d.getTime()) ? '' : d.toISOString();
	}
	if (typeof ts === 'string') {
		const ms = Date.parse(ts);
		return Number.isNaN(ms) ? ts : new Date(ms).toISOString();
	}
	return '';
}

/** One JSONL line -> ChannelNote of `channel`; undefined for blank/torn/malformed lines and other channels. */
function parseNote(raw: string, channel: string): ChannelNote | undefined {
	if (!raw.trim()) return undefined;
	let rec: unknown;
	try {
		rec = JSON.parse(raw);
	} catch {
		return undefined; // blank or torn line: skip it, keep the rest
	}
	if (!rec || typeof rec !== 'object') return undefined;
	const r = rec as Record<string, unknown>;
	if (r.channel !== channel) return undefined;
	const seq = Number(r.seq);
	return {
		ts: isoTs(r.ts),
		seq: Number.isFinite(seq) ? seq : 0,
		owner: typeof r.owner === 'string' ? r.owner : '',
		to: str(r.to),
		item: str(r.item),
		text: typeof r.text === 'string' ? r.text : '',
		channel,
		kind: str(r.kind),
	};
}


/**
 * Incremental reader over <root>/.atlas/.run/board/*.jsonl. Keeps a per-file byte cursor from stat.size:
 * a file is re-read (and re-parsed) only when its size grew or shrank; unchanged files reuse their notes.
 */
export class NoteReader {
	private cursors = new Map<string, number>();
	private parsed = new Map<string, ChannelNote[]>();

	constructor(private readonly fs: FsLike, private readonly root: string) {}

	/** All notes of `channel`, oldest first, capped at the last 500; [] when the board is missing/unreadable. */
	async read(channel: string): Promise<ChannelNote[]> {
		const dir = `${this.root}/.atlas/.run/board`;
		let files: string[];
		try {
			files = await this.fs.list(dir);
		} catch {
			return [];
		}
		const out: ChannelNote[] = [];
		for (const file of files) {
			if (!file.endsWith('.jsonl')) continue;
			const path = `${dir}/${file}`;
			let size: number | undefined;
			try {
				size = (await this.fs.stat(path))?.size;
			} catch {
				size = undefined;
			}
			if (size !== undefined && size === this.cursors.get(file)) {
				out.push(...(this.parsed.get(file) ?? []));
				continue;
			}
			// size grew, shrank, or first sight: re-read and re-parse the whole file
			let raw: string | undefined;
			try {
				raw = await this.fs.read(path);
			} catch {
				raw = undefined;
			}
			if (raw === undefined) {
				this.cursors.delete(file);
				this.parsed.delete(file);
				continue;
			}
			const notes: ChannelNote[] = [];
			for (const line of raw.split('\n')) {
				const note = parseNote(line, channel);
				if (note) notes.push(note);
			}
			// ponytail: whole-file reparse on any size change; tail-read from the cursor if boards grow past a few MB
			this.cursors.set(file, size ?? 0);
			this.parsed.set(file, notes);
			out.push(...notes);
		}
		// ISO strings compare lexicographically; '' (missing ts) sorts first, seq dominates anyway
		return out.sort((a, b) => a.seq - b.seq || (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)).slice(-MAX_NOTES);
	}
}

/**
 * Roster for the first candidate channel present in <root>/.atlas/.run/channels.json
 * (`channels[name].members[]`); `{channel: null, members: []}` when nothing matches or the file is unreadable.
 */
export async function readRoster(
	fs: FsLike,
	root: string,
	candidates: string[],
): Promise<{ channel: string | null; members: ChannelMember[] }> {
	let reg: unknown;
	try {
		const raw = await fs.read(`${root}/.atlas/.run/channels.json`);
		reg = raw === undefined ? undefined : JSON.parse(raw);
	} catch {
		reg = undefined;
	}
	const channels = (reg as { channels?: Record<string, unknown> } | undefined)?.channels;
	if (!channels || typeof channels !== 'object') return { channel: null, members: [] };
	const keys = Object.keys(channels);
	const found = (name: string): ChannelMember[] | undefined => {
		const members = (channels[name] as { members?: unknown } | undefined)?.members;
		return Array.isArray(members) ? membersOf(members) : undefined;
	};
	for (const candidate of candidates) {
		// Real keys are "<folder>@<branch>/lead-<s6>": a bare "lead-<s6>" candidate matches by suffix.
		const name = candidate in channels ? candidate : keys.find((k) => k.endsWith(`/${candidate}`)) ?? candidate;
		const members = found(name);
		if (members) return { channel: name, members };
	}
	// No candidate matched (the host's session id is not the lead's, or the script keyed the main channel without the branch
	// `atlas_todo.py _main_parts`, as in a repo with no readable branch): the project's main channel, `<folder>` or `<folder>@<ref>`.
	for (const candidate of candidates) {
		const folder = candidate.split('@')[0]!;
		if (folder === '' || folder.includes('/')) continue;
		const name = keys.find((k) => (k === folder || k.startsWith(`${folder}@`)) && !k.includes('/'));
		const members = name === undefined ? undefined : found(name);
		if (name !== undefined && members) return { channel: name, members };
	}
	return { channel: null, members: [] };
}

function membersOf(members: unknown[]): ChannelMember[] {
	return members.flatMap((m) => {
		if (!m || typeof m !== 'object') return [];
		const e = m as Record<string, unknown>;
		if (typeof e.name !== 'string') return [];
		return [
			{
				name: e.name,
				...(e.role !== undefined ? { role: str(e.role) } : {}),
				...(e.pane_id !== undefined ? { pane_id: str(e.pane_id) } : {}),
				...(typeof e.pid === 'number' ? { pid: e.pid } : {}),
				...(e.ended_at !== undefined ? { ended_at: str(e.ended_at) ?? null } : {}),
				...(typeof e.exit_code === 'number' ? { exit_code: e.exit_code } : {}),
			},
		];
	});
}

/** `HH:MM owner → to │ text`, whitespace collapsed, cut to 110; HH:MM from `n.ts`, falling back to `now`. */
export function formatNote(n: ChannelNote, now: number): string {
	const d = new Date(Date.parse(n.ts));
	const t = Number.isNaN(d.getTime()) ? new Date(now) : d;
	const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
	const line = `${hhmm} ${n.owner || '?'} → ${n.to || 'all'} │ ${(n.text ?? '').replace(/\s+/g, ' ').trim()}`;
	return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line;
}

/** The departure line for a `kind: 'exit'` note; undefined for every other kind. */
export function systemLine(n: ChannelNote): string | undefined {
	if (n.kind !== 'exit') return undefined;
	const code = n.text.match(/\bexit (\d+)\b/)?.[1] ?? String(n.seq);
	return `*** ${n.owner || '?'} has quit (exit ${code})`;
}

/** Critique 19 C5: what went wrong is a channel row. A killed (failed) worker, a blocked one and a refused Stop are facts the store and the squad already hold; the channel tab read
 * `no messages yet` after a kill and a refusal because only board notes became rows. Pure: the rows come from the inputs, so the same inputs make the same rows (a kill's time is
 * the instant the worker ended, never the clock). A Stop refusal carries no time of its own (the gates tab's verdict line does not): its `ts` is '' and the panel draws no time for it. */
export function failureNotes(i: { workers: readonly { name: string; state: string; endedMs?: number | undefined; detail?: string | undefined }[]; stop: { blocked: boolean; gates: readonly string[] } | null; channel?: string }): ChannelNote[] {
	const channel = i.channel ?? '';
	const rows: ChannelNote[] = [];
	for (const w of i.workers) {
		if (w.state !== 'failed' && w.state !== 'blocked') continue;
		const text = w.state === 'failed' ? `worker killed${w.detail && w.detail !== 'failed' ? ` · ${w.detail}` : ''}` : `blocked${w.detail ? `: ${w.detail}` : ''}`;
		rows.push({ ts: w.endedMs !== undefined ? isoTs(w.endedMs) : '', seq: 0, owner: w.name, to: 'lead', text, channel, kind: 'blocked' });
	}
	if (i.stop?.blocked) {
		const words = i.stop.gates.filter((g) => g !== '' && g !== 'stop refused');
		rows.push({ ts: '', seq: 0, owner: 'stop gate', to: 'lead', text: words.length ? `Stop refused: ${words.join(', ')}` : 'Stop refused', channel, kind: 'blocked' });
	}
	return rows;
}

/** Critique 23: a refusal is a fact of the run, not of the moment. The gates tab's `Last Stop blocked` line is the LAST verdict, so once the lead closed the open row and Stop passed, the
 * channel tab lost the refusal row (stoprun-150-513bb41c-2/tab-channel.png: the kill, the done and the closure, nothing between them). The refusal is remembered when the verdict is first seen
 * blocked, with the clock of that sighting: the data carries no time of the refusal itself, so the time is APPROXIMATE (the first panel build that saw the verdict, a second or less after the Stop hook wrote it). */
const refusals: { channel: string; ts: string; text: string }[] = [];
const refusedBefore = new Map<string, boolean>(); // per channel: the last verdict read there
const REFUSALS_MAX = 20;

/** Record a refusal on the flip of the last verdict to blocked; the same verdict read again records nothing. `nowMs` is the snapshot clock. */
export function noteRefusal(stop: { blocked: boolean; gates: readonly string[] } | null, nowMs: number, channel = ''): void {
	const blocked = !!stop?.blocked;
	if (blocked && !refusedBefore.get(channel)) {
		const words = (stop?.gates ?? []).filter((g) => g !== '' && g !== 'stop refused');
		refusals.push({ channel, ts: isoTs(nowMs), text: words.length ? `Stop refused: ${words.join(', ')}` : 'Stop refused' });
		if (refusals.length > REFUSALS_MAX) refusals.shift();
	}
	refusedBefore.set(channel, blocked);
}

/** The refusals this session saw, oldest first, as channel rows from the stop gate. */
export const refusalNotes = (channel = ''): ChannelNote[] => refusals.filter((x) => x.channel === channel).map((x) => ({ ts: x.ts, seq: 0, owner: 'stop gate', to: 'lead', text: x.text, channel, kind: 'blocked' }));

export const forgetRefusals = (): void => { refusals.length = 0; refusedBefore.clear(); };
