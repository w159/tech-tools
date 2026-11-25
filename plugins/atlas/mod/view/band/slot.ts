// slot.ts: the AbovePrompt slot as one pure plan. register.ts hands it the band builder, the HUD input and the row budget; it answers with the HUD rows, the band
// model, the blank row between them and the rows the slot holds. Pure: nothing here reads the host or keeps state (the caller keeps `held`).
import { bandRowCount, type BandModel } from './band';
import { isAlive, namedAgents, type HudInput, type HudOpts } from '../hud/hud';
import type { Segment } from '../../design/runs';

/** The Mission Control band keeps at least this many rows; the HUD takes the rest of the budget. */
export const BAND_MIN_ROWS = 7;
/** The band never draws more than this many rows: status row(s), health strip, key chips. */
const BAND_MAX_ROWS = 3;

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

/** The band model with the HUD's own verdict on its agents: one the SUBAGENTS block draws running (listed, resumed or named by an open dispatch row) keeps the band working, so the band never reads `idle` beside a turning spinner (wave 33). */
const withAgents = (i: SlotInput): SlotInput => {
	const running = [...i.hudIn.agents, ...namedAgents(i.hudIn.todos, i.hudIn.agents)].some(isAlive); // wave 34: only an agent that works holds the band working; a queued one (an open dispatch row the host never listed) is drawn but does nothing once the turn is over
	return running ? { ...i, bandIn: (rows, maxRows) => ({ ...i.bandIn(rows, maxRows), agentsRunning: true }) } : i;
};

/** The slot is the band alone: the todo and subagent lists live in the side panel's status tab, so the HUD rows are always empty and the band takes up to BAND_MAX_ROWS. The held height
 * still keeps one value for the whole run (slotHold), so a bottom-anchored band stays on one screen row. */
export function composeSlot(input: SlotInput): SlotPlan {
	const i = withAgents(input);
	const maxRows = i.hasSlot ? Math.min(i.budget, BAND_MAX_ROWS) : undefined;
	const band = i.bandIn([], maxRows);
	const used = bandRowCount(band, true);
	const held = i.hudOn && i.hasSlot ? slotHold(i.held, i.runOn, used, used, i.budget) : 0;
	return { hud: [], band, gap: 0, pad: Math.max(0, held - used), held, lead: 0 };
}
