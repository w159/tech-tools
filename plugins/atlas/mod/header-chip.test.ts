// Critique 7 B6: the raw `ATLAS | <glyph> <phase> | <state>` header line renders as a chip from the first frame the mod is asked to draw it.
// The mod side has no delay: assistantTree decides from the text and the contract pattern alone. These tests pin that with the SHIPPED contract
// pattern and the exact first lines the live runs showed raw for 3-5 frames (150-1 f0128-f0130, 150-3 f0123-f0127, 110-3 f0098-f0100).
import { expect, test } from 'claude-code/testing';
import contract from '../contracts/operating-contract.json';
import { assistantTree } from './restyle';
import type { AtlasSnapshot } from './contract';

const pattern = (contract as { headerFirstLinePattern: string }).headerFirstLinePattern;
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

// Critique 11 C3: 15 raw `● ATLAS | ...` frames at build 5d6a53ef. These are the complete first lines of those frames (live-150-5d6a53ef-2 f0043-f0044,
// live-110-5d6a53ef-1 f0040-f0041, and the single-frame ones). The text was whole when the host drew it raw and the same text is a chip two frames later,
// so detection is not what missed: the mod's decision is a pure function of the text and the contract pattern, and it chips every one on the first call.
// The raw frame is the host drawing a new message before the async `ui.render` hook (one `await read`) has answered; the host gives the mod no earlier site.
const LIVE_11 = [
  'ATLAS | 🔍 research | step 2 done: 3 explorers running, 0 of 3 returned',
  'ATLAS | 🔍 research | 0/3 explorers returned; plan on board (5 open)',
  'ATLAS | 🔍 research | 0/3 explorers returned, board 0/5',
  'ATLAS | 🔍 research | 3/5 dispatched, waiting on explorers',
  'ATLAS | 🔍 research | 3/3 explorers returned, board updating T2 then T3',
  'ATLAS | 🏁 done | 5/5 board items complete',
];

test('C3: every first line the 5d6a53ef live runs drew raw is a chip on the first call, at 110 and 150 columns, alone or with a body', () => {
  for (const line of LIVE_11) for (const cols of [110, 150]) {
    expect([line, cols, assistantTree(snap, { text: line }, cols) !== null]).toEqual([line, cols, true]);
    expect([line, cols, assistantTree(snap, { text: `${line}\n\nbody`, isFirstOfReply: true }, cols) !== null]).toEqual([line, cols, true]);
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
