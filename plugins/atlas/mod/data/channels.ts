// Board + roster readers for the Atlas mod: pure logic over FsLike (register.ts adapts $.fs).
// Ported from plugins/atlas/omp/channel-view.ts (readChannelNotes/formatNote) — mods have no Node APIs,
// so paths join with '/' and parsing is defensive. Never shells out to atlas_todo.py.
import type { ChannelMember, ChannelNote, FsLike } from '../contract';

const MAX_NOTES = 500;
const MAX_LINE = 110;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Board ts as a string the rest of the mod can rely on: ISO when parseable, '' when absent. */
function isoTs(ts: unknown): string {
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
	for (const name of candidates) {
		const members = (channels[name] as { members?: unknown } | undefined)?.members;
		if (!Array.isArray(members)) continue;
		return {
			channel: name,
			members: members.flatMap((m) => {
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
			}),
		};
	}
	return { channel: null, members: [] };
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

/** Notes newer than `lastSeenSeq` addressed to one of `forOwners` (or to everyone), excluding their own notes. */
export function unreadCount(notes: ChannelNote[], lastSeenSeq: number, forOwners: string[]): number {
	return notes.filter(
		(n) =>
			n.seq > lastSeenSeq &&
			!(n.owner && forOwners.includes(n.owner)) &&
			(!n.to || n.to === 'all' || forOwners.includes(n.to)),
	).length;
}
