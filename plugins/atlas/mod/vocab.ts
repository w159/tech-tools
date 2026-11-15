// vocab.ts: one wording for a gate on every surface (band, panel, card), so the same check is never counted or coloured two ways.
//
// API
//   gateLine(name, pass, total, ascii?) -> { glyph, text, tone, pass, total }
//       text `● name n/m`; tone `ok` (green) when pass >= total > 0, `bad` (red) when pass < total, `sub` (grey neutral) when total is 0 (shown `0/0`);
//       ascii swaps `●` for `*`. Unreadable or negative counts clamp to 0.
//   gatesTotal(gates) -> { pass, total, text, tone }   the sum of the shown n/m (`11/11`), same tone rule, so every surface reports one check count
import type { Tone } from './atlas-ui';

export type GateLine = { glyph: string; text: string; tone: Tone; pass: number; total: number };
export type GateTotal = { pass: number; total: number; text: string; tone: Tone };

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const toneOf = (pass: number, total: number): Tone => (total === 0 ? 'sub' : pass >= total ? 'ok' : 'bad');

export function gateLine(name: string, pass: number, total: number, ascii = false): GateLine {
  const p = count(pass);
  const t = count(total);
  const glyph = ascii ? '*' : '●';
  return { glyph, text: `${glyph} ${name} ${p}/${t}`, tone: toneOf(p, t), pass: p, total: t };
}

export function gatesTotal(gates: readonly { pass: number; total: number }[]): GateTotal {
  const pass = gates.reduce((n, g) => n + count(g.pass), 0);
  const total = gates.reduce((n, g) => n + count(g.total), 0);
  return { pass, total, text: `${pass}/${total}`, tone: toneOf(pass, total) };
}
