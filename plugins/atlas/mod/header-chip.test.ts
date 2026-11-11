// Critique 7 B6: the raw `ATLAS | <glyph> <phase> | <state>` header line renders as a chip from the first frame the mod is asked to draw it.
// The mod side has no delay: assistantTree decides from the text and the contract pattern alone. These tests pin that with the SHIPPED contract
// pattern and the exact first lines the live runs showed raw for 3-5 frames (150-1 f0128-f0130, 150-3 f0123-f0127, 110-3 f0098-f0100).
import { expect, test } from 'claude-code/testing';
import { readFileSync } from 'node:fs';
import { assistantTree } from './restyle';
import type { AtlasSnapshot } from './contract';

const pattern = (JSON.parse(readFileSync(new URL('../contracts/operating-contract.json', import.meta.url), 'utf8')) as { headerFirstLinePattern: string }).headerFirstLinePattern;
const snap = { contract: { headerFirstLinePattern: pattern } } as unknown as AtlasSnapshot;
const chipped = (text: string): boolean => assistantTree(snap, { text, isFirstOfReply: true }, 100) !== null;

const LIVE = [
  'ATLAS | ⛔ blocked | Stop gate open: the run used in-process Agent calls, and no tmux team record exists',
  'ATLAS | ⛔ blocked | team gate open, work done',
  'ATLAS | 🏁 done | 5/5',
  'ATLAS | ✅ verify | scenario steps run; team gate still open',
];

test('B6: every live header line that showed raw is a chip on its first render, alone or with a body', () => {
  for (const line of LIVE) {
    expect([line, chipped(line)]).toEqual([line, true]);
    expect([line, chipped(`${line}\n\nThe three files match.`)]).toEqual([line, true]);
  }
});

test('B6: the host draws a still-streaming first line before its state text has begun: that frame is the only one the mod cannot chip', () => {
  // The pattern needs one non-space character after the second pipe. A line cut before it is not yet a header; from the first
  // character of the state on, it is. Nothing in register.ts or restyle.tsx adds frames beyond that.
  const full = LIVE[0]!;
  const cut = full.indexOf('| Stop') + 2;
  expect(chipped(full.slice(0, cut))).toBe(false);
  expect(chipped(full.slice(0, cut + 1))).toBe(true);
});
