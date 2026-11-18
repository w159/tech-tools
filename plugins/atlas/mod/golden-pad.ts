// golden-pad.ts: test helper. The frozen side panel goldens (contracts/panel-golden.ts) draw the tab strip flush against the left
// rule; the strip now takes STRIP_PAD cells of padding (mod/view/panel/panel-layout.ts). Rather than rewrite the contract file, the tests
// that compare against it pad the strip row (the row of the six names) by the same cells.
import { STRIP_PAD } from './view/panel/panel-layout';

const STRIP = /^status {3}team {3}channel/;
/** Rows with the strip row and the rule row under it moved right by STRIP_PAD cells. */
export function padStrip(rows: readonly string[]): string[] {
  const pad = ' '.repeat(STRIP_PAD);
  return rows.map((row) => (STRIP.test(row) ? pad + row : row));
}
