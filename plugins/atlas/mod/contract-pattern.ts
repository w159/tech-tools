// The operating contract's header first-line pattern and phase table, as a code module. The host loader refuses a .json import from a hooks module
// (live: `is not named like code and was not loaded`), so the mod reads these constants; mod/contract-pattern.test.ts keeps them equal to
// contracts/operating-contract.json `headerFirstLinePattern` and `phases`, and no other mod file may hold a phase or glyph table of its own.
import type { PhaseId } from './contract'

export const HEADER_FIRST_LINE_PATTERN = "^(?:ATLAS|\\*\\*ATLAS\\*\\*) \\| (?=(?:\\S+ )?(research|theory|test|validate|implement|verify|done|blocked)\\b)(?:\\S+ (?:research|theory|test|validate|implement|verify|done|blocked)( \\d+/\\d+)?|(?:research|theory|test|validate|implement|verify|done|blocked)( \\d+/\\d+)? \\S+( \\d+/\\d+)?) \\| \\S"

/** operating-contract.json `phases`; `tone` names an atlas-ui Token. */
export const PHASE_TABLE: readonly { id: PhaseId; glyph: string; label: string; tone: 'cyan' | 'accent' | 'warn' | 'sub' | 'blue' | 'text' | 'ok' | 'bad' }[] = [
  { id: 'research', glyph: '🔍', label: 'research', tone: 'cyan' },
  { id: 'theory', glyph: '💡', label: 'theory', tone: 'accent' },
  { id: 'test', glyph: '🧪', label: 'test', tone: 'warn' },
  { id: 'validate', glyph: '📋', label: 'validate', tone: 'sub' },
  { id: 'implement', glyph: '🔧', label: 'implement', tone: 'blue' },
  { id: 'verify', glyph: '✅', label: 'verify', tone: 'text' },
  { id: 'done', glyph: '🏁', label: 'done', tone: 'ok' },
  { id: 'blocked', glyph: '⛔', label: 'blocked', tone: 'bad' },
]

/** The line a reply's header is read from, and what follows it: the first non-empty line, stripped. The completion gate reads a reply the same way (completion_gate_core.py), so a leading
 * blank line or space is no header for one and a header for the other no more (audit-C9; contracts/header-corpus.json pins both). `rest` is the text after that line. */
export function firstHeaderLine(text: string): { line: string; rest: string } {
  let from = 0
  for (;;) {
    const nl = text.indexOf('\n', from)
    const raw = nl < 0 ? text.slice(from) : text.slice(from, nl)
    if (raw.trim() !== '' || nl < 0) return { line: raw.trim(), rest: nl < 0 ? '' : text.slice(nl + 1) }
    from = nl + 1
  }
}
