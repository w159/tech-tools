// slot.ts: the AbovePrompt slot as one pure plan. register.ts hands it the band builder, the HUD input and the row budget; it answers with the HUD rows, the band
// model, the blank row between them and the rows the slot holds. Pure: nothing here reads the host or keeps state (the caller keeps `held`).
import { bandKindOf, bandRowCount, bandSpareRows, type BandModel } from './band';
import { hudBudget, hudCompactRows, hudFloorRows, hudHoldRows, hudListsAgents, hudRows, hudWantRows, reclaimBlanks, type HudInput, type HudOpts } from './hud';
import type { Segment } from './runs';

/** The Mission Control band keeps at least this many rows; the HUD takes the rest of the budget. */
export const BAND_MIN_ROWS = 7;
/** Rows the band keeps once the HUD has taken the SUBAGENTS column names and the blank under the agents: its title row. */
export const BAND_KEEP_ROWS = 1;

/** Rows the HUD may take of `budget`. `hudBudget` gives the compact floor (the plan, the agents, no column names); where the slot can also hold the
 * blank between the plan and the agents, the floor is raised to hold it. `want` (hud.ts hudWantRows) is what the HUD asks for: every plan row and agent row with both closing rules. The HUD is given
 * that much whenever the band keeps its title row and, with agents listed, the one blank under them, so a slot that fits the plan shows every row; hud-surface fitRows gives up decoration (rules, column
 * names) before a row (critique 23: `2 more todos not shown` at 150 columns beside spare rows). */
export function hudSlotCap(budget: number, compact: number, floor: number, bandRows: number, running: boolean, agentsListed: boolean, want = 0): number {
	const base = hudBudget(budget, compact, bandRows, running);
	const room = budget - BAND_KEEP_ROWS - (agentsListed ? 1 : 0); // the most the HUD can take while the band keeps its title row (and the blank under the agents)
	const asked = want > 0 ? Math.min(want, room) : 0;
	if (!agentsListed) return Math.max(base, asked);
	const cap = Math.max(budget - floor - 1 >= BAND_KEEP_ROWS ? Math.max(base, floor) : base, asked); // floor: hudFloorRows, the compact form with the blank between the blocks
	// While an agent runs the band keeps its row (critique 17: 110 columns, 10 rows, 3 agents: the HUD took all 10 and no band line was drawn); the HUD folds to fit (hud-surface fitRows).
	return running && budget > BAND_KEEP_ROWS + 1 ? Math.min(cap, budget - BAND_KEEP_ROWS) : cap;
}

/** The HUD rows that leave the band at least one row of the budget (band row, never the HUD, is the one thing that must not vanish: round 3). `gapOf` is the breathing blank the rows would draw.
 * A budget below one row means the slot is closed (the band draws nothing by design), so nothing is trimmed. */
export function fitHudToBand<R>(hud: readonly R[], budget: number, gapOf: (rows: readonly R[]) => number): readonly R[] {
	if (budget < 1) return hud;
	let rows = hud;
	while (rows.length > 0 && rows.length + gapOf(rows) > budget - 1) rows = rows.slice(0, -1);
	return rows;
}

/** Blank rows between the last agent row and the band: one, while the band keeps its title row. */
export function hudGapRows(listsAgents: boolean, hudRowCount: number, budget: number): number {
	return listsAgents && budget - hudRowCount - 1 >= BAND_KEEP_ROWS ? 1 : 0;
}

/** Rows the slot holds (band, blank, HUD, pad) from the first frame of a run to its last (critique 26: the band jumped from row 31 to row 24 when SUBAGENTS appeared). It starts at what the run's full HUD
 * asks (`reserve`, hud.ts hudRunRows), never falls while the run lasts and never passes the budget; at rest nothing is held (0). The slot is bottom-anchored above the prompt, so a constant height is a band that stays on one screen row. */
export function slotHold(prev: number, running: boolean, used: number, reserve: number, budget: number): number {
	if (!running || budget < 1) return 0;
	return Math.min(budget, Math.max(prev, used, reserve));
}

export type SlotInput = {
	/** The rows the slot may hold (0 when the host reported no slot: `hasSlot` false). */
	budget: number;
	hasSlot: boolean;
	hudOn: boolean;
	/** A run is on (the host turn, or the run clock): the slot keeps one height until it closes. */
	runOn: boolean;
	columns: number;
	hudIn: HudInput;
	hudView: Omit<HudOpts, 'maxRows'>;
	/** An agent runs / any agent is listed. */
	running: boolean;
	agentsListed: boolean;
	/** Whether a phase header, a plan or an agent exists: the run is orchestrated. */
	orchestrated: boolean;
	now: number;
	/** The band model for the HUD rows drawn: `maxRows` is the band's own allotment (undefined with no slot). */
	bandIn: (hudRowsDrawn: Segment[][], maxRows: number | undefined) => BandModel;
	/** The slot height held so far (the caller keeps it between renders). */
	held: number;
};
/** `lead`: empty host-coloured rows above the band that make up the budget (never filled bars); `held` is the content height (band area, blank, boxes) the run has reached. */
export type SlotPlan = { hud: Segment[][]; band: BandModel; gap: number; pad: number; held: number; lead: number };

/** The fixed shape (critique 31): from the first working frame to idle the slot is one height, the band is one row at its top and the HUD starts on the very next row in every state (the TODO box never moves under
 * the band). The slot is bottom-anchored and the host gives it `budget` (half the screen less the rows below it, the prompt and its own agent list). The height is the budget, or the roomiest HUD (both boxes
 * with the plan and agents a run is expected to have, the form every state fits in) and the band row when that is smaller, and never falls while the run lasts. Rows the HUD does not use are blank rows under it,
 * unfilled, never a 234 slab between the blocks. */
function composeFixed(i: SlotInput): SlotPlan {
	const { budget, columns, hudIn, hudView } = i;
	const reserve = BAND_KEEP_ROWS + hudHoldRows(hudIn, columns, i.now, true);
	const total = Math.max(1, Math.min(budget, Math.max(i.held, reserve))); // the content: never falls while the run lasts
	const hudCap = Math.max(0, total - BAND_KEEP_ROWS); // the band keeps its row; the HUD takes every other row it can use
	const idle = bandKindOf(i.bandIn([], 1)) === 'idle';
	const hud = hudRows(hudIn, { ...hudView, maxRows: hudCap, reserve: true, ...(idle ? { idle: true } : {}) }) as Segment[][];
	const band = i.bandIn(hud, 1);
	const pad = Math.max(0, total - BAND_KEEP_ROWS - hud.length);
	return { hud, band, gap: 0, pad, held: total, lead: Math.max(0, budget - total) }; // the host puts the slot at `screen - budget - below`: the unused budget goes ABOVE the band as empty rows, so the band keeps its screen row whatever the host list below does
}

export function composeSlot(i: SlotInput): SlotPlan {
	const fixed = i.hasSlot && i.hudOn && i.budget >= 1 && (i.runOn || i.agentsListed || i.hudIn.todos.length > 0);
	if (fixed) return composeFixed(i);
	const { budget, columns, hudIn, hudView } = i;
	const bandFor = (rows: Segment[][]): BandModel => i.bandIn(rows, i.hasSlot ? budget - rows.length - hudGapRows(hudListsAgents(rows), rows.length, budget) : undefined);
	const want = hudWantRows(hudIn, columns, i.now);
	const hudCap = hudSlotCap(budget, hudCompactRows(hudIn, columns), hudFloorRows(hudIn, columns, i.now), BAND_MIN_ROWS, i.running, i.agentsListed, want);
	const drawHud = (maxRows: number): Segment[][] => hudRows(hudIn, { ...hudView, maxRows });
	// The band's breathing blanks go to the plan before it is folded to "N more todos not shown".
	const hudFull = i.hudOn ? (reclaimBlanks(drawHud(hudCap), hudCap, budget, (rows) => bandSpareRows(bandFor(rows as Segment[][])), drawHud) as Segment[][]) : [];
	// The band row never goes: whatever the HUD drew, at least one row of the budget stays for the band (a frame with no band was the hole in the readout).
	const hud = i.hasSlot ? (fitHudToBand(hudFull, budget, (rows) => hudGapRows(hudListsAgents(rows as Segment[][]), rows.length, budget)) as Segment[][]) : hudFull;
	const gap = hudGapRows(hudListsAgents(hud), hud.length, budget);
	// One slot height for the whole run: the band sits at the top of a bottom-anchored slot, so a HUD that grows (the SUBAGENTS block appearing) or an idle row that goes would move it on screen.
	const used = bandRowCount(bandFor(hud), true) + gap + hud.length;
	const held = i.hudOn && i.hasSlot ? slotHold(i.held, i.runOn, used, BAND_KEEP_ROWS + 1 + hudHoldRows(hudIn, columns, i.now, i.orchestrated), budget) : 0;
	return { hud, band: bandFor(hud), gap, pad: Math.max(0, held - used), held, lead: 0 };
}
