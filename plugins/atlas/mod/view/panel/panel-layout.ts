// panel-layout.ts: the one side panel layout both harnesses draw (design system rev 4, "SIDEPANEL" surface).
// The Claude Code pane (mod/view/panel/pane/sidebar.tsx) and the omp painter (omp/panel-view.ts) are thin adapters: each builds a
// PanelModel from its own data, calls panelLines, and paints the runs (Elements on Claude Code, ANSI on omp). Parity
// is structural: the text both print comes from here, and the goldens (contracts/panel-golden.ts) assert it.
//
// Rules: marks come from the state glyph map in atlas-ui (queued, running, done, failed, blocked, waiting; never a
// literal check mark, bullet or ellipsis); every number carries its word; colour carries state only; truncation is
// `…` through `clipE`; the surface is the rev 4 panel token.
export { BLANK, fitRuns, runsText, lineText, forgetStamps } from './panel-shared';
export type { PanelTab, PanelTodo, PanelWorker, PanelGateLine, PanelGate, PanelNote, PanelModel, Press, PanelLine } from './panel-shared';
export { PANEL_TABS, STRIP_TABS, CHIP_PAD, STRIP_PAD, chipText, MORE_KEY, moreWord, backWord, SHORT_LABEL, stripRows, stripLayout, countWords, channelLabel, ribbonRow, tabRows, headerRows } from './panel-tabs';
export type { StripTab, StripForm } from './panel-tabs';
export { CARD_W, cardLines, CARD_WORD_W, cardBarTone, toastRuns, toastText, noteToastRuns, noteToastText } from './panel-cards';
export type { CardModel } from './panel-cards';
export { panelMotionItems, stageShort, shortAge, workersByTask, wrap } from './panel-rows-route';
export { recentRows, centred, emptyHint, emptyTab } from './panel-rows-team';
export { verifiedFigure } from './panel-rows-gates';
export { boardEmptyRows, frameTabOf, bodyLines, fillRows, panelLines, panelText } from './panel-body';
export { stateGlyph } from '../../design/atlas-ui';
