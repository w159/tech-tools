/**
 * Shell command unwrapping for lane targets: a TypeScript port of unwrap_shell in
 * plugins/atlas/scripts/atlas_panefeed.py. Both sides run the same fixture strings (cmd-unwrap.test.ts and
 * test_atlas_panefeed.py), so a pane feed and an omp lane show the same text for the same command.
 * ponytail: display only; no heredoc or subshell awareness.
 */
import * as nodePath from "node:path";

const VAR_RE = /\$\{?([A-Za-z_]\w*)\}?/g;
const ASSIGN_RE = /^[A-Za-z_]\w*=/;
const NOISE_FLAGS = new Set(["--root", "--channel", "--owner"]);
const KEYWORDS = ["do ", "then ", "else ", "{ ", "( "];
const SETUP = new Set(["cd", "pushd", "export", "set", "source", "."]); // shown only when nothing else runs
const SKIP = /^(done|fi|esac|\}|\)|for |while |if |case )/;
// statement split: a quoted run (to its close or the end), a separator, or plain text
const STMT_TOKEN = /'[^']*'?|"[^"]*"?|&&|\|\||[;\n]|[^'";\n&|]+|[&|]/g;
const SEPARATORS = new Set(["&&", "||", ";", "\n"]);
// shlex: one whole word is a run of quoted parts, escapes, and plain characters
const WORD = /(?:'[^']*'|"(?:\\[\s\S]|[^"\\])*"|\\[\s\S]|[^\s'"\\])+/g;
const PART = /'([^']*)'|"((?:\\[\s\S]|[^"\\])*)"|\\([\s\S])/g;
const DQ_ESCAPE = /\\([\\"$`\n])/g;

interface UnwrapState {
	env: Record<string, string>;
	loops: Record<string, string[]>; // `for p in a b` -> {p: [a, b]}, so `--to $p` names each peer
	first: string;
	setup: string;
	notes: [string, string][];
}

/** Split on ; && || and newlines outside quotes. */
function statements(cmd: string): string[] {
	const out = [""];
	for (const tok of cmd.match(STMT_TOKEN) ?? []) {
		if (SEPARATORS.has(tok)) out.push("");
		else out[out.length - 1] += tok;
	}
	return out.map((s) => s.trim()).filter(Boolean);
}

const unquote = (word: string) => word.replace(PART, (_m, sq?: string, dq?: string, esc?: string) => sq ?? esc ?? (dq as string).replace(DQ_ESCAPE, "$1"));

/** POSIX word split like Python shlex.split; throws on an unterminated quote or trailing escape. */
function shlexSplit(s: string): string[] {
	if (s.replace(WORD, "").trim()) throw new Error("No closing quotation");
	return (s.match(WORD) ?? []).map(unquote);
}

function words(stmt: string): string[] {
	try {
		return shlexSplit(stmt);
	} catch {
		return stmt.split(/\s+/).filter(Boolean);
	}
}

/** Python shlex.quote. */
const shQuote = (w: string) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replaceAll("'", `'"'"'`)}'`);

function unwrapLeanCtx(cmd: string): string {
	const w = words(cmd.trim());
	return w.length >= 3 && nodePath.basename(w[0]) === "lean-ctx" && w[1] === "-c" ? w[2] : cmd;
}

function stripKeyword(stmt: string): string {
	const kw = KEYWORDS.find((k) => stmt.startsWith(k));
	return kw ? stmt.slice(kw.length).trim() : stmt;
}

const expand = (stmt: string, env: Record<string, string>) => stmt.replace(VAR_RE, (m, name: string) => env[name] ?? m);

/** Consume leading NAME=value words into env; the command words that remain. */
function recordAssignments(w: string[], env: Record<string, string>): string[] {
	while (w.length && ASSIGN_RE.test(w[0])) {
		const a = w.shift() as string;
		const eq = a.indexOf("=");
		env[a.slice(0, eq)] = a.slice(eq + 1);
	}
	return w;
}

/** An absolute path shortened to its basename, quoted when it holds a space. */
function shortWord(x: string): string {
	const s = x.startsWith("/") && x.slice(1).includes("/") ? nodePath.basename(x.replace(/\/+$/, "")) : x;
	return s.includes(" ") ? shQuote(s) : s;
}

/** Words without the board noise flags, absolute paths shortened to their basename. */
function display(w: string[]): string {
	const shown: string[] = [];
	for (let i = 0; i < w.length; i++) {
		if (NOISE_FLAGS.has(w[i])) i++;
		else shown.push(shortWord(w[i]));
	}
	return shown.join(" ");
}

const runsTodo = (w: string[]) => w.some((x) => x.endsWith("atlas_todo.py"));
const isNoteCall = (w: string[]) => w.includes("note") && w.includes("--to") && !w.includes("--help") && runsTodo(w);
const endsArgs = (x: string) => x === "|" || /^\d?>/.test(x); // a pipe or redirect ends the note's own arguments

function noteArgs(w: string[]): string[] {
	const after = w.slice(w.indexOf("note") + 1);
	const end = after.findIndex(endsArgs);
	return end < 0 ? after : after.slice(0, end);
}

/** Message words: everything but `--flag value` pairs. */
function noteMessage(args: string[]): string {
	const rest: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith("--")) i++;
		else rest.push(args[i]);
	}
	return rest.join(" ");
}

/** [to, message] when the words run `atlas_todo.py note --to X msg`, else undefined. */
function note(w: string[]): [string, string] | undefined {
	if (!isNoteCall(w)) return undefined;
	const args = noteArgs(w);
	const to = noteTo(args);
	return to ? [to, noteMessage(args)] : undefined;
}

const noteTo = (args: string[]) => (args.includes("--to") ? (args[args.lastIndexOf("--to") + 1] ?? "") : "");

/** Record each peer a note goes to; the words with the note's flags reduced to `--to a,b`. */
function withNoteTargets(w: string[], st: UnwrapState): string[] {
	const n = note(w);
	if (!n) return w;
	const targets = n[0].startsWith("$") ? (st.loops[n[0].slice(1)] ?? [n[0]]) : [n[0]];
	st.notes.push(...targets.map((t): [string, string] => [t, n[1]]));
	return [...w.slice(0, w.indexOf("note") + 1), "--to", targets.join(",")];
}

function recordLoop(stmt: string, st: UnwrapState): void {
	const loop = /^for (\w+) in (.+)/.exec(stmt);
	if (loop) st.loops[loop[1]] = words(expand(loop[2], st.env));
}

function step(stmt: string, st: UnwrapState): void {
	recordLoop(stmt, st);
	if (SKIP.test(stmt)) return;
	const w = withNoteTargets(recordAssignments(words(expand(stmt, st.env)), st.env), st);
	if (w.length) place(w, st);
}

/** The first setup command (cd, export, ...) and the first real command, each kept once. */
function place(w: string[], st: UnwrapState): void {
	const key = SETUP.has(w[0]) ? "setup" : "first";
	st[key] ||= display(w);
}

/** [the first meaningful command for display, [to, msg] per peer note]. Mirrors atlas_panefeed.unwrap_shell. */
export function unwrapShell(cmd: string): [string, [string, string][]] {
	const st: UnwrapState = { env: {}, loops: {}, first: "", setup: "", notes: [] };
	for (const stmt of statements(unwrapLeanCtx(cmd))) step(stripKeyword(stmt), st);
	return [st.first || st.setup, st.notes];
}

/** Lane target of a shell command: a peer note shows as `note → peer`, anything else as the unwrapped command. */
export function shellTarget(cmd: string): string {
	const [first, notes] = unwrapShell(cmd);
	return notes.length ? `note → ${[...new Set(notes.map(([to]) => to))].join(",")}` : first;
}
