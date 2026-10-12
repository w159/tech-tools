// Characterization cases: sprite rows, badges, speech bubbles and code point widths serialized for sprites.golden.test.ts.
import { textWidth } from '../theme';
import { badge, frameCount, MOODS, PERSONA_KEYS, speechBubble, spriteRows, type Run } from './api';

const ser = (rows: Run[][]): string => rows.map((r) => r.map((x) => `${x.text}|${x.fg ?? ''}|${x.bg ?? ''}|${x.bold ? 1 : 0}`).join(';')).join('\n');
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
// Frames past the mood's own count and negative ones exercise the wrap-around.
const framesOf = (mood: (typeof MOODS)[number]): number[] => [-1, ...range(frameCount(mood) + 2)];

// FNV-1a 32-bit: a short stable digest so the fixture stays a few KB.
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const PERSONAS = [...PERSONA_KEYS, 'atlas:explorer', 'armada-x', 'no-such-persona'];

// Every frame and size of one persona x mood, plus the badge, in one digest.
function moodDigest(p: string, m: (typeof MOODS)[number]): string {
  const parts = framesOf(m).flatMap((f) => [...(['s', 'm', 'l'] as const).map((s) => ser(spriteRows(p, m, f, s))), ser([badge(p, m, f)])]);
  return fnv(parts.join('\n--\n'));
}

function spriteSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PERSONAS) for (const m of MOODS) out[`${p}/${m}`] = moodDigest(p, m);
  return out;
}

const BUBBLE_TEXTS = [
  '', 'hi', 'found 3 call sites in the auth flow and more words to wrap around', 'x'.repeat(60),
  'a\tb\nc  d', '✦ star ✔ check \u{1F600} emoji 中文 wide é combining', 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen',
];

function bubbleSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of BUBBLE_TEXTS) {
    for (const cols of [5, 6, 10, 24, 40]) {
      for (const side of ['l', 'r'] as const) out[`${t}/${cols}/${side}`] = fnv(ser(speechBubble(t, cols, side)));
    }
  }
  return out;
}

// Run-length encode a per-code-point value so 0..0x3FFFF fits in a small fixture.
function encode(cps: number[], valueOf: (cp: number) => string): string[] {
  const out: string[] = [];
  let prev: string | undefined;
  for (const cp of cps) {
    const v = valueOf(cp);
    if (v !== prev) out.push(`${cp}:${v}`);
    prev = v;
  }
  return out;
}

const EDGES = [0x40000, 0x10ffff];
const CODE_POINTS = [...range(0x40000), ...EDGES];
const kindOf = (cp: number): string => {
  const ch = String.fromCodePoint(cp);
  const got = (((speechBubble(`a${ch}b`, 20, 'l')[1] as Run[])[1]) as Run).text;
  return got === `a${ch}b` ? 'same' : got;
};
const widthSnapshot = (): { theme: string; bubble: string } => ({
  theme: fnv(encode(CODE_POINTS, (cp) => String(textWidth(String.fromCodePoint(cp)))).join(',')),
  bubble: fnv(encode(CODE_POINTS, kindOf).join(',')),
});

export const serializeGolden = (): string => JSON.stringify({ sprites: spriteSnapshot(), bubbles: bubbleSnapshot(), widths: widthSnapshot() }, null, 1);
