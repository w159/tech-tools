// channel-bubbles.ts: the message rows of the channel chat room (channel-chat.ts): one coloured speaker per agent, HH:MM:SS on every
// message, the user's own messages right-aligned on the accent tint, agent-to-agent notes as `alpha -> beta`.
import { PALETTES, type Run, type Ui } from '../../design/atlas-ui';
import { BLANK, r, type PanelLine } from './panel-shared';
import { g, padL, tint, w, wrapWords } from './tab-kit';

/** Palette tokens a speaker may wear, in the order agents first speak. `accent` is the lead's own colour, so it is left out; `info` (the accent's twin on mocha) comes last. */
const SPEAKER_TOKENS = ['cyan', 'ok', 'warn', 'blue', 'bad', 'info'] as const;

/** One distinct colour per agent (by order of first appearance), the same on every row and every render. Under NO_COLOR it is undefined: the name stays in the text colour. */
export function speakerColours(ui: Pick<Ui, 'theme' | 'color'>, names: readonly string[]): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const n of names) if (!out.has(n)) out.set(n, ui.color === 'none' ? undefined : PALETTES[ui.theme][SPEAKER_TOKENS[out.size % SPEAKER_TOKENS.length]!]);
  return out;
}
/** `HH:MM:SS` out of a note's stamp (sidebar-model hms), `--:--:--` when the stamp is unreadable, empty when there is none. */
export const hms = (at: string): string => /(\d{2}:\d{2}:\d{2}|--:--:--)/.exec(at)?.[1] ?? '';

/** Header row: the speaker (coloured, bold) and, for a note addressed to someone, `-> recipient`; the time flush right. Never wider than `U + 1` cells. */
export function speakerHeader(ui: Ui, U: number, name: string, fg: string | undefined, to: string | undefined, at: string, lead: boolean): PanelLine {
  const who: Run = lead ? r(name, 'accent', { bold: true }) : r(name, 'text', { bold: true, ...(fg ? { fg } : {}) });
  const left: Run[] = [r(' '), r(`${g(ui, '◆', '+')} `, 'muted'), who, ...(to ? [r(' -> ', 'muted'), r(to, 'sub')] : [])];
  const time = hms(at);
  const room = U + 1 - w(left) - time.length; // the gap before the time; the time ends at the margin, where the user's bubbles end
  return { runs: [...left, ...(time ? [r(' '.repeat(Math.max(1, room)) + time, 'dim')] : [])] };
}
/** A message body wrapped under a 3-cell indent. */
export const bodyRows = (ui: Ui, U: number, text: string, tone: 'text' | 'bad' | 'warn', lead: readonly Run[] = []): PanelLine[] =>
  wrapWords(ui, text, Math.max(8, U - 4)).map((t, i): PanelLine => ({ runs: [r('   '), ...(i === 0 ? lead : []), r(t, tone)] }));

/** The user's own message: a time row and bubbles pushed to the right edge (a `|` rule stands in for the tint under NO_COLOR). */
export function userBlock(ui: Ui, U: number, text: string, at: string): PanelLine[] {
  const none = ui.color === 'none';
  const bubbles = wrapWords(ui, text, Math.max(10, U - 8)).map((t): PanelLine => {
    const body = `${none ? g(ui, '│ ', '| ') : '  '}${t}  `;
    return { runs: [r(' '.repeat(Math.max(1, U - [...body].length + 1))), r(body, 'text', none ? {} : { bgHex: tint(ui) })] };
  });
  return [BLANK, { runs: [r(` ${padL(`you  ${hms(at)}`.trimEnd(), U)}`, 'dim')] }, ...bubbles];
}
