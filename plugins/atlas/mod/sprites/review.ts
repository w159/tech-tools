// Sprite review image: draws spriteRows() Run[][] as SVG cells so the picture matches what the terminal paints.
import { spriteTile } from '../theme';
import type { Run } from './api';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One SVG fragment per row set: bg rect per cell, fg half/full rects for ▀ ▄ █, chip text as <text>. Pure. */
export function runsToSvg(rows: Run[][], opts: { cellW?: number; cellH?: number } = {}): string {
  const w = opts.cellW ?? 8;
  const h = opts.cellH ?? 16;
  const out: string[] = [];
  let width = 0;
  rows.forEach((row, y) => {
    let x = 0;
    for (const r of row) {
      for (const ch of r.text) {
        const px = x * w;
        const py = y * h;
        const rect = (dy: number, rh: number, fill: string): void => {
          out.push(`<rect x="${px}" y="${py + dy}" width="${w}" height="${rh}" fill="${fill}"/>`);
        };
        const block = ch === '▀' || ch === '▄' || ch === '█';
        rect(0, h, r.bg ?? spriteTile);
        if (ch === '▀') rect(0, h / 2, r.fg ?? spriteTile);
        else if (ch === '▄') rect(h / 2, h / 2, r.fg ?? spriteTile);
        else if (ch === '█') rect(0, h, r.fg ?? spriteTile);
        else if (!block && ch !== ' ') {
          out.push(
            `<text x="${px}" y="${py + h * 0.8}" font-family="monospace" font-size="${h * 0.8}" textLength="${w}" fill="${r.fg ?? '#fff'}"${r.bold ? ' font-weight="bold"' : ''}>${esc(ch)}</text>`,
          );
        }
        x++;
      }
    }
    width = Math.max(width, x);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * w}" height="${rows.length * h}" viewBox="0 0 ${width * w} ${rows.length * h}">${out.join('')}</svg>`;
}
