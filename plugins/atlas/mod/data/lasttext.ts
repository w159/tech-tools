// lasttext.ts: the text of a LAST column or a team tab `last` line, made fit to read. Pure.
//   lastText  - strip list markers (`1.`), backticks and absolute paths (the file name stays), and a doubled leading verb (`read Read a.py`)
//   clipWords - fit a width on a whole word, never mid-word, and never inside an open bracket or quote
import { cells } from '../atlas-ui';

const MARKER = new RegExp(`^\\s*(?:[-*${String.fromCharCode(0x2022)}]|\\d{1,3}[.)])\\s+`); // a dash, star, bullet or `1.` / `2)` that heads the text
const ABS_PATH = /(^|[\s(=:])\/(?:[^\s/]+\/)+([^\s/]+)/g;
const SLUG_PATH = /(^|\s)-(?:home|Users|root|tmp|var|mnt|opt|private)(?:-\S*)?/g; // a project directory as the host names it (`-home-user-tech-tools`): a path with its slashes turned to dashes
const DOUBLED = /^(\p{L}[\p{L}\d_]*)\s+\1(?=\s|$)/iu; // `read Read gamma.py`: the tool word and the target's own verb

/** `1. \`atlas_todo.py list\` -> ok` reads `atlas_todo.py list -> ok`; `Read /a/b/c.ts:9` reads `Read c.ts:9`; `read Read c.ts` reads `read c.ts`. */
export function lastText(text: string | null | undefined): string {
  let s = (text ?? '').replace(/\s+/g, ' ').trim();
  for (let prev = ''; prev !== s; ) { prev = s; s = s.replace(MARKER, ''); }
  const clean = s.replace(/`/g, '').replace(ABS_PATH, '$1$2').replace(DOUBLED, '$1').trim();
  const bare = clean.replace(SLUG_PATH, '$1').replace(/\s+/g, ' ').trim();
  // A slug is no step: drop it, and the lone verb it leaves (`run`) says nothing, so the whole text goes (critique 15 C5).
  return bare === clean ? clean : /\s/.test(bare) ? bare : '';
}

const DANGLING = /(?:\s+(?:to|the|a|an|of|in|on|for|with|and|or|by|at|from|is|are))*\s*(?:->|[,;:])?$/i; // a cut that ends on a connector or a clause mark reads as cut mid-thought
const OPEN = '([{"';
const CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"' };
/** Where `s` ends inside an open bracket or quote: the index of the opener, else -1. */
function openAt(s: string): number {
  const stack: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const top = stack.length ? CLOSE[s[stack[stack.length - 1]!]!] : undefined;
    if (top === ch) stack.pop();
    else if (OPEN.includes(ch)) stack.push(i);
  }
  return stack.length ? stack[0]! : -1;
}

/** `text` in `n` cells ending on a whole word: the longest word prefix plus `...` that fits, taken back before an unclosed `(`, `[` or quote
 * and off a dangling `,` `;` `:` `->` or connector word (`to`, `the`), so the cut falls on a clause boundary; empty when not even one word does. */
export function clipWords(text: string, n: number): string {
  if (cells(text) <= n) return text;
  const words = text.split(' ');
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (cells(next) + 3 > n) break;
    out = next;
  }
  const at = openAt(out);
  const closed = at > 0 ? out.slice(0, at).trimEnd() : out;
  const tidy = (closed || out).replace(DANGLING, '');
  return tidy ? `${tidy}...` : '';
}
