// The operating contract's header first-line pattern and phase table, as a code module. The host loader refuses a .json import from a hooks module
// (live: `is not named like code and was not loaded`), so the mod reads these constants; mod/contract-pattern.test.ts keeps them equal to
// contracts/operating-contract.json `headerFirstLinePattern` and `phases`, and no other mod or omp file may hold a phase or glyph table of its own.
import type { PhaseId } from './contract'

export const HEADER_FIRST_LINE_PATTERN = "^(?:ATLAS|\\*\\*ATLAS\\*\\*) \\| (?=(?:\\S+ )?(research|theory|test|validate|implement|verify|done|blocked)\\b)(?:\\S+ (?:research|theory|test|validate|implement|verify|done|blocked)( \\d+/\\d+)?|(?:research|theory|test|validate|implement|verify|done|blocked)( \\d+/\\d+)? \\S+( \\d+/\\d+)?) \\| \\S"

/** operating-contract.json `phases`; `tone` names an atlas-ui Token, `cell` is the single-cell glyph a narrow surface prints (theme.ts contractGlyph). */
export const PHASE_TABLE: readonly { id: PhaseId; glyph: string; label: string; tone: 'cyan' | 'accent' | 'warn' | 'sub' | 'blue' | 'text' | 'ok' | 'bad'; cell: string }[] = [
  { id: 'research', glyph: '🔍', label: 'research', tone: 'cyan', cell: '◎' },
  { id: 'theory', glyph: '💡', label: 'theory', tone: 'accent', cell: '◇' },
  { id: 'test', glyph: '🧪', label: 'test', tone: 'warn', cell: '⚗' },
  { id: 'validate', glyph: '📋', label: 'validate', tone: 'sub', cell: '☰' },
  { id: 'implement', glyph: '🔧', label: 'implement', tone: 'blue', cell: '⚒' },
  { id: 'verify', glyph: '✅', label: 'verify', tone: 'text', cell: '\u2713' },
  { id: 'done', glyph: '🏁', label: 'done', tone: 'ok', cell: '⚑' },
  { id: 'blocked', glyph: '⛔', label: 'blocked', tone: 'bad', cell: '■' },
]

/** ASCII whitespace only. JavaScript trim() also strips U+FEFF, U+00A0 and U+2028; Python strip() strips U+0085 and FS-US instead, and splitlines() breaks on VT, FF and U+2028. Neither is used:
 * the gate (completion_gate_core.py parse_status_header) splits on \n and strips these same six characters, and contracts/header-corpus.json pins both. */
const trimAscii = (s: string): string => s.replace(/^[ \t\r\v\f]+|[ \t\r\v\f]+$/g, '')

/** The line a reply's header is read from, and what follows it: the first line (split on \n only) that is not empty after stripping ASCII whitespace, stripped. The completion gate reads a reply the
 * same way, so a leading blank line or space is no header for one and a header for the other no more (audit-C9). `rest` is the text after that line. */
export function firstHeaderLine(text: string): { line: string; rest: string } {
  let from = 0
  for (;;) {
    const nl = text.indexOf('\n', from)
    const raw = trimAscii(nl < 0 ? text.slice(from) : text.slice(from, nl))
    if (raw !== '' || nl < 0) return { line: raw, rest: nl < 0 ? '' : text.slice(nl + 1) }
    from = nl + 1
  }
}
