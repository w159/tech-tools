// lasttext.ts: the text of a LAST column or a team tab `last` line, made fit to read. Pure.
//   lastText  - strip list markers (`1.`), backticks and absolute paths (the file name stays)
//   clipWords - fit a width on a whole word, never mid-word
import { cells } from '../atlas-ui';

const MARKER = new RegExp(`^\\s*(?:[-*${String.fromCharCode(0x2022)}]|\\d{1,3}[.)])\\s+`); // a dash, star, bullet or `1.` / `2)` that heads the text
const ABS_PATH = /(^|[\s(=:])\/(?:[^\s/]+\/)+([^\s/]+)/g;

/** `1. \`atlas_todo.py list\` -> ok` reads `atlas_todo.py list -> ok`; `Read /a/b/c.ts:9` reads `Read c.ts:9`. */
export function lastText(text: string | null | undefined): string {
  let s = (text ?? '').replace(/\s+/g, ' ').trim();
  for (let prev = ''; prev !== s; ) { prev = s; s = s.replace(MARKER, ''); }
  return s.replace(/`/g, '').replace(ABS_PATH, '$1$2').trim();
}

/** `text` in `n` cells ending on a whole word: the longest word prefix plus `...` that fits; empty when not even one word does. */
export function clipWords(text: string, n: number): string {
  if (cells(text) <= n) return text;
  const words = text.split(' ');
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (cells(next) + 3 > n) break;
    out = next;
  }
  return out ? `${out}...` : '';
}
