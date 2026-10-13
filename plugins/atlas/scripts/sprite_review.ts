// Renders every persona x mood sprite (size m, frame 0) to /tmp/atlas-sprites.svg (+ .png via rsvg-convert).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { MOODS, PERSONA_KEYS, spriteRows } from '../mod/sprites/api';
import { runsToSvg } from '../mod/sprites/review';

const CW = 8, CH = 16, PAD = 12, LABEL = 34;
const cellPx = 12 * CW + PAD;
const rowPx = 6 * CH + LABEL + PAD;
const parts: string[] = [];
PERSONA_KEYS.forEach((p, i) => {
  MOODS.forEach((m, j) => {
    const x = 90 + j * cellPx;
    const y = 20 + i * rowPx;
    if (j === 0) parts.push(`<text x="4" y="${y + 6 * CH / 2}" font-family="monospace" font-size="12" fill="#ddd">${p}</text>`);
    if (i === 0) parts.push(`<text x="${x}" y="12" font-family="monospace" font-size="11" fill="#aaa">${m}</text>`);
    parts.push(`<g transform="translate(${x} ${y})">${runsToSvg(spriteRows(p, m, 0, 'm'), { cellW: CW, cellH: CH })}</g>`);
  });
});
const W = 90 + MOODS.length * cellPx, H = 20 + PERSONA_KEYS.length * rowPx;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#0d1017"/>${parts.join('')}</svg>`;
writeFileSync('/tmp/atlas-sprites.svg', svg);
console.log(`/tmp/atlas-sprites.svg ${svg.length} bytes`);
const r = spawnSync('rsvg-convert', ['-o', '/tmp/atlas-sprites.png', '/tmp/atlas-sprites.svg']);
console.log(r.error ? 'rsvg-convert missing: png skipped' : '/tmp/atlas-sprites.png written');
