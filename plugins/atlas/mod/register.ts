// register.ts: the Atlas mod entrypoint, a thin re-export of mod/host/ (plan docs/plans/2026-10-09_atlas-mod.md section 3; split
// docs/plans/2026-11-18_atlas-mod-reorg-plan.md section 7). hooks/hooks.json lists "../mod/register.ts" under "modules" and the host
// calls its `register(on, options)`; tests import the names below from here. The file holds no state; `register` is the only declaration.
// Kill switch: ATLAS_MOD=off turns every wired handler into a pass-through (read at session.start, inside host/hooks.ts).
import type { On, PluginOptions } from 'claude-code';
import { register as registerHost } from './host/hooks';

/** The host entry (hooks.json "modules"): the host reads `register` from this file, so it is declared here and runs host/hooks.ts. */
export function register(on: On, options: PluginOptions): Promise<void> {
	return registerHost(on, options);
}

export { BOARD_ID, shouldDockAsked, shouldDockRest } from './host/atoms';
export { headerPhaseOf, headerTallyOf, mapListed, syncAgentsFromList } from './host/agents';
export { dockTick, rebuild, rebuildTick, withStopVerdict } from './host/poll';
export { buildCore, coreTick, resetCore } from './host/core-tick';
export { atlasSlot, effectiveRows, inlineBelowRows, openBoard, publishHudState, readStatuslineRows, resetHudStateSig, resetSessionStart, resetSlotHold, slotHold } from './host/handlers';
export type { HudState, StatuslineRows } from './host/handlers';
export { hostTurnRunning, isWorkingNow, resetBlockedDebounce, resetBlockedMark, STOP_SETTLE_MS, turnEnded } from './host/frame';
