// Tests for plugins/atlas/mod/data/channels.ts — pure logic over an in-memory FsLike (claude-code/testing kit).
import { expect, test } from 'claude-code/testing';
import type { ChannelNote, FsLike } from '../contract';
import { formatNote, NoteReader, readRoster, systemLine } from './channels';

/** In-memory FsLike over `${root}/.atlas/.run/...`; counts read() calls so cursor behaviour is observable. */
class MemFs implements FsLike {
	files = new Map<string, string>();
	reads = 0;

	async read(path: string): Promise<string | undefined> {
		this.reads++;
		return this.files.get(path);
	}
	async stat(path: string): Promise<{ size: number; mtimeMs: number } | undefined> {
		const content = this.files.get(path);
		return content === undefined ? undefined : { size: content.length, mtimeMs: 0 };
	}
	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}
	async list(path: string): Promise<string[]> {
		return [...this.files.keys()]
			.filter((k) => k.startsWith(`${path}/`))
			.map((k) => k.slice(path.length + 1));
	}
}

const ROOT = '/proj';
let fileNo = 0;

/** Seed one board file; owner names are unique per file so channel-filter cross-talk is visible. */
function boardFile(fs: MemFs, lines: object[]): string {
	const name = `board/owner${fileNo++}.jsonl`;
	fs.files.set(`${ROOT}/.atlas/.run/${name}`, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
	return name;
}

function note(seq: number, ts: number, text: string, extra: Partial<ChannelNote> = {}): object {
	return { ts, seq, owner: 'a', to: 'b', item: null, text, channel: 'proj@main', ...extra };
}

test('read: filters channel, sorts by seq then ts, caps at the last 500', async () => {
	const fs = new MemFs();
	boardFile(fs, [note(3, 100, 'third'), note(1, 200, 'first'), note(1, 300, 'first-tie-later'), note(9, 0, 'other-channel-note', { channel: 'other@x' })]);
	boardFile(fs, [note(2, 0, 'second'), { broken: 'not a note' }]); // valid JSON but no channel -> not a note
	const reader = new NoteReader(fs, ROOT);
	const notes = await reader.read('proj@main');
	expect(notes.map((n) => n.text)).toEqual(['first', 'first-tie-later', 'second', 'third']);

	// cap at 500: 501 valid notes -> the oldest (lowest seq) drops
	const fs2 = new MemFs();
	boardFile(fs2, Array.from({ length: 501 }, (_, i) => note(i + 1, i, `n${i}`)));
	expect((await new NoteReader(fs2, ROOT).read('proj@main')).map((n) => n.seq)).toEqual(
		Array.from({ length: 500 }, (_, i) => i + 2),
	);
});

test('read: cursor re-reads only grown files, resets on shrink, skips unchanged ones', async () => {
	const fs = new MemFs();
	const file = boardFile(fs, [note(1, 1, 'one'), note(2, 2, 'two')]);
	const reader = new NoteReader(fs, ROOT);
	expect((await reader.read('proj@main')).map((n) => n.text)).toEqual(['one', 'two']);
	expect(fs.reads).toBe(1);

	// unchanged file: notes reused, no re-read
	expect((await reader.read('proj@main')).map((n) => n.text)).toEqual(['one', 'two']);
	expect(fs.reads).toBe(1);

	// growth: only the new lines surface, file re-read exactly once
	const path = `${ROOT}/.atlas/.run/${file}`;
	fs.files.set(path, fs.files.get(path)! + [note(3, 3, 'three'), note(4, 4, 'four')].map((l) => JSON.stringify(l)).join('\n') + '\n');
	expect((await reader.read('proj@main')).map((n) => n.text)).toEqual(['one', 'two', 'three', 'four']);
	expect(fs.reads).toBe(2);

	// shrink (truncate): re-read from start, cursor follows the smaller size
	fs.files.set(path, JSON.stringify(note(1, 1, 'one')) + '\n');
	expect((await reader.read('proj@main')).map((n) => n.text)).toEqual(['one']);
	expect(fs.reads).toBe(3);
});

test('read: tolerates blank and torn lines between valid ones', async () => {
	const fs = new MemFs();
	fs.files.set(
		`${ROOT}/.atlas/.run/board/torn.jsonl`,
		[
			JSON.stringify(note(1, 1, 'good-one')),
			'',
			'{"ts": 2, "seq": 2, "owner": "a", "text": "torn", "channel": "proj@mai', // cut mid-write
			'not json at all',
			JSON.stringify(note(3, 3, 'good-three')),
			'null',
		].join('\n'),
	);
	expect((await new NoteReader(fs, ROOT).read('proj@main')).map((n) => n.text)).toEqual(['good-one', 'good-three']);
});

test('read: missing board dir and missing files resolve to []', async () => {
	expect(await new NoteReader(new MemFs(), ROOT).read('proj@main')).toEqual([]);
	const fs = new MemFs();
	fs.list = async () => {
		throw new Error('no board');
	};
	expect(await new NoteReader(fs, ROOT).read('proj@main')).toEqual([]);
});

test('systemLine: exit kind renders *** quit with the code from the text, undefined otherwise', () => {
	const exit: ChannelNote = { ts: '', seq: 7, owner: 'fix-1', text: 'exit 2 [failed: nonzero exit]', channel: 'proj@main', kind: 'exit' };
	expect(systemLine(exit)).toBe('*** fix-1 has quit (exit 2)');
	// no code in the text -> fall back to the note's seq
	expect(systemLine({ ...exit, text: 'gone' })).toBe('*** fix-1 has quit (exit 7)');
	expect(systemLine({ ...exit, kind: undefined })).toBeUndefined();
});

test('formatNote: HH:MM owner → to │ text, collapsed; missing ts/to fall back', () => {
	// 2026-10-09T12:59Z rendered in the host's local timezone; assert structure and the fallback, not a fixed HH:MM
	const n: ChannelNote = { ts: '2026-10-09T12:59:00.000Z', seq: 1, owner: 'lead', to: 'Shell', text: 'do  this\nthing', channel: 'proj@main' };
	expect(formatNote(n, 0)).toMatch(/^\d\d:\d\d lead → Shell │ do this thing$/);
	const now = Date.parse('2026-03-01T08:05:00Z');
	// unusable ts -> clock comes from the injected now
	const fallback = formatNote({ ...n, ts: '' }, now);
	expect(fallback.slice(0, 5)).toBe(
		`${String(new Date(now).getHours()).padStart(2, '0')}:${String(new Date(now).getMinutes()).padStart(2, '0')}`,
	);
	expect(formatNote(n, 0)).toContain(` → Shell │ do this thing`);
	expect(formatNote({ ...n, to: undefined }, 0)).toContain(' → all │ ');
	// cut to 110 with an ellipsis
	const long = formatNote({ ...n, text: 'x'.repeat(300) }, 0);
	expect(long.length).toBe(110);
	expect(long.endsWith('…')).toBe(true);
});

test('readRoster: first present candidate wins; unreadable/missing file yields null', async () => {
	const fs = new MemFs();
	fs.files.set(
		`${ROOT}/.atlas/.run/channels.json`,
		JSON.stringify({
			channels: {
				'proj@main': { members: [{ name: 'lead-1', role: 'lead', parent: null, joined: 1 }, { parent: null }] },
				'proj@main/lead-1': { members: [{ name: 'fix-1', ended_at: '2026-10-09T00:00:00Z', exit_code: 0 }] },
			},
		}),
	);
	const lead = await readRoster(fs, ROOT, ['proj@main/lead-1', 'proj@main']);
	expect(lead).toEqual({ channel: 'proj@main/lead-1', members: [{ name: 'fix-1', ended_at: '2026-10-09T00:00:00Z', exit_code: 0 }] });
	const main = await readRoster(fs, ROOT, ['proj@main/missing', 'proj@main']);
	expect(main.channel).toBe('proj@main');
	expect(main.members.map((m) => m.name)).toEqual(['lead-1']); // nameless entries dropped, unknown fields (parent/joined) not carried
	expect(await readRoster(fs, ROOT, ['nope'])).toEqual({ channel: null, members: [] });
	const broken = new MemFs();
	broken.files.set(`${ROOT}/.atlas/.run/channels.json`, '{oops');
	expect(await readRoster(broken, ROOT, ['proj@main'])).toEqual({ channel: null, members: [] });
});

async function readTs(ts: unknown): Promise<string> {
	const fs = new MemFs();
	boardFile(fs, [{ ...(note(1, 0, 't') as object), ts }]);
	const [n] = await new NoteReader(fs, ROOT).read('proj@main');
	return n!.ts;
}

test('ts normalisation: epoch seconds and ms both become ISO; strings parse or pass through; others are empty', async () => {
	expect(await readTs(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z'); // seconds
	expect(await readTs(1_700_000_000_000)).toBe('2023-11-14T22:13:20.000Z'); // ms
	expect(await readTs('2023-11-14T22:13:20Z')).toBe('2023-11-14T22:13:20.000Z');
	expect(await readTs('not a date')).toBe('not a date');
	expect(await readTs(null)).toBe('');
	expect(await readTs(true)).toBe('');
	expect(await readTs(1e18)).toBe(''); // out of Date range
});

test('note field normalisation: owner/text defaults, seq coercion, optional fields, channel is stamped', async () => {
	const fs = new MemFs();
	boardFile(fs, [
		{ channel: 'proj@main', seq: '5', ts: 1_700_000_000, to: 'x', item: 'i-1', kind: 'exit', owner: 'o', text: 'hi' },
		{ channel: 'proj@main', seq: 'junk', owner: 7, text: 9 },
		'a string line' as unknown as object,
		null as unknown as object,
		{ channel: 'other', seq: 1 },
	]);
	const notes = await new NoteReader(fs, ROOT).read('proj@main');
	expect(notes).toEqual([
		{ ts: '', seq: 0, owner: '', to: undefined, item: undefined, text: '', channel: 'proj@main', kind: undefined },
		{ ts: '2023-11-14T22:13:20.000Z', seq: 5, owner: 'o', to: 'x', item: 'i-1', text: 'hi', channel: 'proj@main', kind: 'exit' },
	]);
});

test('read: ties on seq break by ts ascending; non-jsonl files are ignored', async () => {
	const fs = new MemFs();
	boardFile(fs, [note(1, 1_700_000_200, 'late'), note(1, 1_700_000_100, 'early'), note(1, 1_700_000_300, 'latest')]);
	fs.files.set(`${ROOT}/.atlas/.run/board/readme.txt`, JSON.stringify(note(0, 1, 'ignored')));
	const notes = await new NoteReader(fs, ROOT).read('proj@main');
	expect(notes.map((n) => n.text)).toEqual(['early', 'late', 'latest']);
});

test('read: a failing stat forces a re-read, and a vanished file drops its cached notes', async () => {
	const fs = new MemFs();
	const name = boardFile(fs, [note(1, 1, 'one')]);
	const reader = new NoteReader(fs, ROOT);
	expect((await reader.read('proj@main')).length).toBe(1);
	const realStat = fs.stat.bind(fs);
	fs.stat = async () => {
		throw new Error('stat boom');
	};
	const before = fs.reads;
	expect((await reader.read('proj@main')).length).toBe(1);
	expect(fs.reads).toBe(before + 1);
	fs.stat = realStat;
	fs.files.delete(`${ROOT}/.atlas/.run/${name}`);
	fs.list = async () => [name.replace('board/', '')];
	expect(await reader.read('proj@main')).toEqual([]);
});

test('read: a read that throws skips that file only', async () => {
	const fs = new MemFs();
	boardFile(fs, [note(1, 1, 'a')]);
	const good = boardFile(fs, [note(2, 2, 'b')]);
	const realRead = fs.read.bind(fs);
	fs.read = async (p: string) => {
		if (p.endsWith('owner' + (fileNo - 2) + '.jsonl')) throw new Error('EIO');
		return realRead(p);
	};
	expect(good).toContain('board/');
	expect((await new NoteReader(fs, ROOT).read('proj@main')).map((n) => n.text)).toEqual(['b']);
});

test('readRoster: null or non-object channels, and junk members, are tolerated; all member fields map through', async () => {
	const withChannels = (channels: unknown) => {
		const fs = new MemFs();
		fs.files.set(`${ROOT}/.atlas/.run/channels.json`, JSON.stringify({ channels }));
		return fs;
	};
	expect(await readRoster(withChannels(null), ROOT, ['c'])).toEqual({ channel: null, members: [] });
	expect(await readRoster(withChannels('str'), ROOT, ['c'])).toEqual({ channel: null, members: [] });
	const empty = new MemFs();
	empty.files.set(`${ROOT}/.atlas/.run/channels.json`, '{}');
	expect(await readRoster(empty, ROOT, ['c'])).toEqual({ channel: null, members: [] });
	expect(await readRoster(new MemFs(), ROOT, ['c'])).toEqual({ channel: null, members: [] });
	const r = await readRoster(
		withChannels({
			c: {
				members: [
					null,
					'x',
					7,
					{ name: 5 },
					{ name: 'full', role: 'r', pane_id: '%3', pid: 42, ended_at: 'T', exit_code: 3 },
					{ name: 'odd', role: 5, pane_id: 9, pid: '42', ended_at: 5, exit_code: '3' },
				],
			},
			notArray: { members: 'nope' },
		}),
		ROOT,
		['notArray', 'c'],
	);
	expect(r.channel).toBe('c');
	expect(r.members).toEqual([
		{ name: 'full', role: 'r', pane_id: '%3', pid: 42, ended_at: 'T', exit_code: 3 },
		{ name: 'odd', role: undefined, pane_id: undefined, ended_at: null },
	]);
});
