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

test('B6 (wave 24): a still-streaming first line is a chip from the first `ATLAS |` on, so no raw `● ATLAS | ...` frame is drawn', () => {
  // Critique 21: 22 raw header frames in 11 of 12 runs. The strict pattern needs one non-space character after the second pipe; before it the brand pill
  // draws alone (then with the phase pill once the phase word is whole), and from the state's first character the strict pattern takes over. Only a line
  // too short to be told from prose (`ATLAS`, `ATLAS |` without its space) stays the host's own row.
  const full = LIVE[0]!;
  const cut = full.indexOf('| Stop') + 2;
  const frames = Array.from({ length: full.length - 'ATLAS |'.length + 1 }, (_, k) => full.slice(0, 'ATLAS |'.length + k));
  expect(frames.filter((f) => !chipped(f))).toEqual([]);
  expect(chipped(full.slice(0, cut))).toBe(true);
  expect(chipped(full.slice(0, cut + 1))).toBe(true);
  for (const f of ['A', 'ATLAS', 'ATLAS ', 'ATLA']) expect([f, chipped(f)]).toEqual([f, false]);
  expect(chipped('ATLAS | x | y\nbody')).toBe(false); // a finished first line that is no header stays the host's
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
