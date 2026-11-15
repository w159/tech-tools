// vocab.ts: one wording for a gate on every surface (band, panel, card), so the same check is never counted or coloured two ways.
// Round 2 (D4): gates report denials, never a pass ratio. The counts come from the gate groups' own lines (a line that is not ok is a denial: deny = total - pass);
// the hooks hand over no timestamp of a gate's last firing, so no row carries an age.
//
// API
//   gateCounts(check) -> { pass, total }   one check's lines: pass = ok lines, total = all lines; a pending gate (Stop alone decides) and a group with no lines have total 0 (never fired);
//                                           a check with no group data counts as one line; a failing check always holds at least one denial
//   gateLine(name, pass, total, ascii?) -> { glyph, text, count, tone, pass, total, deny, fired }
//       fired:     `● name 8 pass · 0 deny`   tone `ok` (green), `bad` (red) when any deny; ascii swaps `●` for `*`
//       not fired: `○ name not fired`         tone `sub` (grey); ascii `o`
//   gatesTotal(gates) -> { pass, total, deny, fired, notFired, text, tone }   the sum over the gates that fired; text `ok` or `N denied`; tone `ok`, `bad`, or `sub` when no gate fired
import type { Tone } from './atlas-ui';

export type GateLine = { glyph: string; text: string; /** `8 pass · 0 deny`, or `not fired`. */ count: string; tone: Tone; pass: number; total: number; deny: number; fired: boolean };
export type GateTotal = { pass: number; total: number; deny: number; fired: number; notFired: number; text: string; tone: Tone };

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function gateCounts(c: { ok: boolean; pending?: boolean; lines?: number; pass?: number }): { pass: number; total: number } {
  if (c.pending) return { pass: 0, total: 0 };
  if (c.lines === undefined) return c.ok ? { pass: 1, total: 1 } : { pass: 0, total: 1 };
  const total = count(c.lines);
  if (total === 0) return c.ok ? { pass: 0, total: 0 } : { pass: 0, total: 1 };
  const pass = Math.min(count(c.pass), total);
  return { pass: !c.ok && pass === total ? total - 1 : pass, total };
}

export function gateLine(name: string, pass: number, total: number, ascii = false): GateLine {
  const t = count(total);
  const p = Math.min(count(pass), t);
  const deny = t - p;
  const fired = t > 0;
  const glyph = fired ? (ascii ? '*' : '●') : ascii ? 'o' : '○';
  const words = fired ? `${p} pass ${ascii ? '-' : '·'} ${deny} deny` : 'not fired';
  return { glyph, text: `${glyph} ${name} ${words}`, count: words, tone: !fired ? 'sub' : deny > 0 ? 'bad' : 'ok', pass: p, total: t, deny, fired };
}

export function gatesTotal(gates: readonly { pass: number; total: number }[]): GateTotal {
  const lines = gates.map((g) => gateLine('', g.pass, g.total));
  const pass = lines.reduce((n, g) => n + g.pass, 0);
  const total = lines.reduce((n, g) => n + g.total, 0);
  const deny = total - pass;
  const fired = lines.filter((g) => g.fired).length;
  return { pass, total, deny, fired, notFired: lines.length - fired, text: deny > 0 ? `${deny} denied` : 'ok', tone: deny > 0 ? 'bad' : fired > 0 ? 'ok' : 'sub' };
}
