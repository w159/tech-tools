// motion-feed.ts: what the Motion observes. One pure function from the live snapshot to the keyed states of every animated
// surface, built from the same models the surfaces draw (hud.ts, board-model.ts, panel-layout.ts, band.tsx), so a key the feed
// reports is a key a builder looks up. register.ts calls it from its tick (never from a render) and hands each list to
// `Motion.observe`; the omp hosts call it the same way.
import type { BandModel } from './band';
import { bandCountItems, hudPhases } from './band';
import { boardMotionItems, boardRowsOf } from './board-model';
import { hudAgents, hudMotionItems } from './hud';
import { liveWorkers, queuedMembers, withOwnerStates, workerStates } from './data/live';
import { ownTodos } from './data/todos';
import type { CoreModel } from './data/core';
import type { MotionItem } from './motion';
import type { LiveSnapshot } from './orchestra-types';
import { panelModelOf } from './pane/sidebar-model';
import type { GateGroup } from './pane/sidebar-types';
import { panelMotionItems } from './panel-layout';
import type { Ui } from './atlas-ui';

/** The surfaces' observed names (the keys of the result). */
export type MotionFeed = { 'hud-todo': MotionItem[]; 'hud-agents': MotionItem[]; board: MotionItem[]; panel: MotionItem[]; band: MotionItem[] };

export function motionFeed(snapshot: LiveSnapshot, gates: GateGroup[], core: CoreModel | null, look: Ui): MotionFeed {
  const live = liveWorkers(snapshot, snapshot.now);
  const agents = hudAgents(live, snapshot.squad, queuedMembers(snapshot));
  const todos = ownTodos(snapshot.todos ?? [], snapshot.sessionId);
  const hud = hudMotionItems({ todos, agents, root: snapshot.root, phases: hudPhases(snapshot) }, { now: snapshot.now });
  const band: BandModel = { snapshot, live, gates, columns: 120, tick: 0, ui: look };
  return {
    'hud-todo': hud.todos,
    'hud-agents': hud.agents,
    board: boardMotionItems(boardRowsOf(withOwnerStates(todos, workerStates(snapshot, live)), Math.floor(snapshot.now / 1000))),
    panel: panelMotionItems(panelModelOf({ snapshot, gates, core, ui: { recipient: null, expanded: null, draft: '', view: 'route' }, look, columns: 120, rows: 40 }, look)),
    band: bandCountItems(band),
  };
}
