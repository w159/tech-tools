// scripts/sprite_review.ts renders the whole persona x mood gallery when it is run (there is no export), so the
// test runs it as a child process with a PATH it controls and checks the SVG it writes and what it prints.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MOODS, PERSONA_KEYS } from '../mod/sprites/api';

const SCRIPT = path.resolve(import.meta.dir, 'sprite_review.ts');
const SVG = '/tmp/atlas-sprites.svg';
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprite-review-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** Runs the script with PATH=`bin` only; returns stdout and the SVG once it is fully written. */
async function run(bin: string): Promise<{ out: string; svg: string; code: number }> {
  const proc = Bun.spawn([process.execPath, SCRIPT], { env: { PATH: bin, HOME: dir }, stdout: 'pipe', stderr: 'pipe' });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const bytes = Number(/atlas-sprites\.svg (\d+) bytes/.exec(out)?.[1]);
  // another run may be rewriting the same fixed path: wait until the file is whole
  const end = Date.now() + 5000;
  let svg = '';
  while (Date.now() < end) {
    svg = fs.existsSync(SVG) ? fs.readFileSync(SVG, 'utf8') : '';
    if (svg.length === bytes) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  return { out, svg, code };
}

function fakeRsvg(): { bin: string; log: string } {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'rsvg.log');
  const script = path.join(bin, 'rsvg-convert');
  fs.writeFileSync(script, `#!/bin/sh\necho "$@" > ${JSON.stringify(log)}\n`);
  fs.chmodSync(script, 0o755);
  return { bin, log };
}

describe('sprite_review gallery', () => {
  test('reports the SVG size and that the PNG was written when rsvg-convert runs, passing it the fixed paths', async () => {
    const { bin, log } = fakeRsvg();
    const { out, svg, code } = await run(bin);
    expect(code).toBe(0);
    expect(out).toBe(`/tmp/atlas-sprites.svg ${svg.length} bytes\n/tmp/atlas-sprites.png written\n`);
    expect(fs.readFileSync(log, 'utf8').trim()).toBe('-o /tmp/atlas-sprites.png /tmp/atlas-sprites.svg');
  });

  test('says the PNG was skipped when rsvg-convert is not installed, and still writes the SVG', async () => {
    const empty = path.join(dir, 'empty');
    fs.mkdirSync(empty);
    const { out, svg, code } = await run(empty);
    expect(code).toBe(0);
    expect(out).toBe(`/tmp/atlas-sprites.svg ${svg.length} bytes\nrsvg-convert missing: png skipped\n`);
    expect(svg.startsWith('<svg')).toBe(true);
  });

  test('the SVG is sized from the persona and mood grid and drawn on the dark backdrop', async () => {
    const { svg } = await run(fakeRsvg().bin);
    const cellPx = 12 * 8 + 12;
    const rowPx = 6 * 16 + 34 + 12;
    const w = 90 + MOODS.length * cellPx;
    const h = 20 + PERSONA_KEYS.length * rowPx;
    expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#0d1017"/>`)).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  test('one cell per persona and mood, each placed on the grid', async () => {
    const { svg } = await run(fakeRsvg().bin);
    const cells = [...svg.matchAll(/<g transform="translate\((\d+) (\d+)\)">/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(cells).toHaveLength(PERSONA_KEYS.length * MOODS.length);
    const xs = [...new Set(cells.map((c) => c[0]))];
    const ys = [...new Set(cells.map((c) => c[1]))];
    expect(xs).toEqual(MOODS.map((_, j) => 90 + j * 108));
    expect(ys).toEqual(PERSONA_KEYS.map((_, i) => 20 + i * 142));
    expect(cells[0]).toEqual([90, 20]);
  });

  test('every persona labels its row and every mood labels its column', async () => {
    const { svg } = await run(fakeRsvg().bin);
    PERSONA_KEYS.forEach((p, i) => {
      expect(svg).toContain(`<text x="4" y="${20 + i * 142 + 48}" font-family="monospace" font-size="12" fill="#ddd">${p}</text>`);
    });
    MOODS.forEach((m, j) => {
      expect(svg).toContain(`<text x="${90 + j * 108}" y="12" font-family="monospace" font-size="11" fill="#aaa">${m}</text>`);
    });
    expect(svg.match(/font-size="12" fill="#ddd"/g)).toHaveLength(PERSONA_KEYS.length);
    expect(svg.match(/font-size="11" fill="#aaa"/g)).toHaveLength(MOODS.length);
  });

  test('each cell carries the sprite runs for that persona, so personas differ', async () => {
    const { svg } = await run(fakeRsvg().bin);
    const cells = svg.split('<g transform=').slice(1).map((c) => c.split('</g>')[0]!);
    expect(cells.every((c) => c.length > 40)).toBe(true);
    expect(new Set(cells).size).toBeGreaterThan(PERSONA_KEYS.length);
  });
});
