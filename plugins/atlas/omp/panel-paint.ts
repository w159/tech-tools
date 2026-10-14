/** Palette and paint primitives shared by mission-panel.ts and todo-panel.ts (kept apart so the two panels do not import each other). */
export type Rgb = readonly [number, number, number];
export const hx = (s: string): Rgb => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
export const PANEL = hx("#11111b");
export const PANEL2 = hx("#181825");
export const BASE = hx("#1e1e2e");
export const TXT = hx("#cdd6f4");
export const MUT = hx("#6c7086");
export const DIM = hx("#45475a");
export const VIOLET = hx("#cba6f7");
export const TEAL = hx("#94e2d5");
export const SKY = hx("#89dceb");
export const BLUE = hx("#89b4fa");
export const GREEN = hx("#a6e3a1");
export const PEACH = hx("#fab387");
export const RED = hx("#f38ba8");
export const YEL = hx("#f9e2af");
export const PINK = hx("#f5c2e7");
export const WHITE: Rgb = [255, 255, 255];

const EIGHTHS = " ▏▎▍▌▋▊▉█";

export const RST = "\x1b[0m";
export const fg = (c: Rgb) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
export const bg = (c: Rgb) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
export const lerp = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)) as unknown as Rgb;
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
