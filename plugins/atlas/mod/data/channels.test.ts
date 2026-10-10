// Tests for plugins/atlas/mod/data/channels.ts — pure logic over an in-memory FsLike (claude-code/testing kit).
import { expect, test } from 'claude-code/testing';
import type { ChannelNote, FsLike } from '../contract';
import { formatNote, NoteReader, readRoster, systemLine, unreadCount } from './channels';

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

test('unreadCount: counts newer notes to the owners or all, excluding their own', () => {
	const notes: ChannelNote[] = [
		{ ts: '', seq: 1, owner: 'lead', to: 'all', text: 'old', channel: 'c' },
		{ ts: '', seq: 5, owner: 'lead-1', to: 'all', text: 'mine', channel: 'c' },
		{ ts: '', seq: 6, owner: 'fix-1', to: 'all', text: 'shout', channel: 'c' },
		{ ts: '', seq: 7, owner: 'fix-2', to: 'lead-1', text: 'dm', channel: 'c' },
		{ ts: '', seq: 8, owner: 'fix-2', to: 'other', text: 'not-mine', channel: 'c' },
		{ ts: '', seq: 9, owner: 'fix-3', text: 'broadcast-no-to', channel: 'c' },
	];
	expect(unreadCount(notes, 4, ['lead-1'])).toBe(3); // 6, 7, 9 — not 5 (own), not 8 (to other)
	expect(unreadCount(notes, 9, ['lead-1'])).toBe(0);
});
