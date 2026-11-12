/** Palette and paint primitives shared by mission-panel.ts and todo-panel.ts (kept apart so the two panels do not import each other). */
import { PALETTE5, PALETTES } from "../mod/atlas-ui";
export type Rgb = readonly [number, number, number];
export const hx = (s: string): Rgb => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
// One restrained palette (critique 25): the same tokens the Claude mod draws with (mod/atlas-ui.ts PALETTES.mocha and PALETTE5), not a second pastel set. The names stay for the callers;
// the hues collapse to the five roles: accent 141, ok 114, warn 179, error 203 and the neutrals 240 / 245 / 252.
export const PANEL = hx(PALETTES.mocha.panel);
export const PANEL2 = hx(PALETTES.mocha.panel);
export const BASE = hx(PALETTES.mocha.base);
export const TXT = hx(PALETTE5.body);
export const MUT = hx(PALETTE5.secondary);
export const DIM = hx(PALETTE5.dim);
export const VIOLET = hx(PALETTE5.accent);
export const TEAL = hx(PALETTE5.accent);
export const SKY = hx(PALETTE5.accent);
export const BLUE = hx(PALETTE5.accent);
export const GREEN = hx(PALETTES.mocha.ok);
export const PEACH = hx(PALETTES.mocha.warn);
export const RED = hx(PALETTES.mocha.bad);
export const YEL = hx(PALETTES.mocha.warn);
export const PINK = hx(PALETTE5.accent);
export const WHITE: Rgb = [255, 255, 255];

const EIGHTHS = " ▏▎▍▌▋▊▉█";

export const RST = "\x1b[0m";
export const fg = (c: Rgb) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
export const bg = (c: Rgb) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
export const lerp = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map(i => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as unknown as Rgb;
export const seg = (text: string, f?: Rgb, b: Rgb = PANEL, bold = false) => `${bold ? "\x1b[1m" : ""}${f ? fg(f) : ""}${bg(b)}${text}${RST}`;
export const chip = (text: string, col: Rgb) => seg(` ${text} `, BASE, col, true);
/** Palette entries todo-panel.ts draws with. */
export const C = { YEL, GREEN, RED, MUT, TXT, VIOLET, TEAL, WHITE, PANEL2 };

/** Visible columns: code points outside escape sequences (every glyph this panel draws is one column wide). */
export const visibleWidth = (s: string) => [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;

/** Pad or cut (with an ellipsis) to exactly `w` code points. */
export function cut(s: string, w: number): string {
	const cs = [...s];
	if (w <= 0) return "";
	return cs.length > w ? `${cs.slice(0, w - 1).join("")}…` : s + " ".repeat(w - cs.length);
}

/** One bar cell: full block, the eighth-block edge, or empty track; filled cells take the gradient color. */
function barCell(i: number, width: number, cells: number, a: Rgb, b: Rgb): string {
	const whole = Math.floor(cells);
	const ch = i < whole ? "█" : i === whole ? EIGHTHS[Math.floor((cells - whole) * 8)]! : " ";
	return fg(i <= whole ? lerp(a, b, i / Math.max(1, width - 1)) : DIM) + bg(PANEL2) + ch;
}

export function bar(frac: number, width: number, a: Rgb, b: Rgb): string {
	const cells = Math.max(0, Math.min(1, frac)) * width;
	return Array.from({ length: width }, (_, i) => barCell(i, width, cells, a, b)).join("") + RST;
}
