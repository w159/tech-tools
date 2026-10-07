/**
 * Key-bar key mappings, kept free of DOM and xterm so they can be unit-tested.
 * PaneTerminal feeds the result to term.input(), which takes the same
 * onData -> socket path as typed keys. The keyboard's own keys xterm.js encodes
 * differently from a terminal are below them.
 */

/** Keys a soft keyboard has no room for; ctrl-* are chords, pipe/tilde/slash the characters, the rest DOM key names. */
export type KeyBarKey =
  | "Escape" | "Tab" | "BackTab" | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
  | "Home" | "End" | "PageUp" | "PageDown" | "ctrl-c" | "ctrl-d" | "ctrl-z" | "pipe" | "tilde" | "slash";

/** The key bar's optional keys, as Settings lists them; a pair is one choice. Esc, Tab, Ctrl, the arrows and ^C are always there. */
export type KeyBarExtra = "alt" | "shift-tab" | "home-end" | "page-up-down" | "ctrl-d" | "ctrl-z" | "pipe" | "tilde" | "slash";
export const KEY_BAR_EXTRAS: readonly KeyBarExtra[] = ["alt", "shift-tab", "home-end", "page-up-down", "ctrl-d", "ctrl-z", "pipe", "tilde", "slash"];

/** The chosen optional keys: known ones only, each once, in KEY_BAR_EXTRAS order; anything but a list keeps the default. */
export function sanitizeKeyBarExtras(value: unknown, fallback: readonly KeyBarExtra[]): KeyBarExtra[] {
  if (!Array.isArray(value)) return [...fallback];
  return KEY_BAR_EXTRAS.filter((extra) => value.includes(extra));
}

/** A single printable character: what the one-shot Control modifier consumes. */
export function isPrintable(data: string): boolean {
  if (data.length !== 1) return false;
  const code = data.charCodeAt(0);
  return code >= 0x20 && code !== 0x7f;
}

/** The control code for A-Z and @ [ \ ] ^ _ (Ctrl+C = 0x03, Ctrl+[ = ESC, ...), null otherwise. */
export function controlCode(ch: string): string | null {
  if (!/^[A-Za-z@[\\\]^_]$/.test(ch)) return null;
  return String.fromCharCode(ch.toUpperCase().charCodeAt(0) & 0x1f);
}

/**
 * What a key-bar tap feeds xterm. Arrows follow DECCKM like a real keyboard: SS3
 * while a full-screen program has application cursor keys on, CSI otherwise.
 */
export function keySequence(key: KeyBarKey, applicationCursorKeys: boolean): string {
  const cursor = (final: "A" | "B" | "C" | "D" | "H" | "F"): string => (applicationCursorKeys ? "\u001bO" : "\u001b[") + final;
  switch (key) {
    case "Escape":
      return "\u001b";
    case "Tab":
      return "\t";
    case "BackTab":
      return "\u001b[Z";
    case "ctrl-c":
      return "\u0003";
    case "ctrl-d":
      return "\u0004";
    case "ctrl-z":
      return "\u001a";
    case "pipe":
      return "|";
    case "tilde":
      return "~";
    case "slash":
      return "/";
    case "Home":
      return cursor("H");
    case "End":
      return cursor("F");
    case "PageUp":
      return "\u001b[5~";
    case "PageDown":
      return "\u001b[6~";
    case "ArrowUp":
      return cursor("A");
    case "ArrowDown":
      return cursor("B");
    case "ArrowRight":
      return cursor("C");
    case "ArrowLeft":
      return cursor("D");
  }
}

/**
 * One keystroke under the key bar's one-shot Alt, as xterm sends it with metaSendsEscape: ESC
 * before a single character (Alt+b, Alt+Backspace, Alt+Enter), and the Alt modifier in a cursor
 * or editing key's sequence (Alt+Left is CSI 1;3D, Alt+PageUp CSI 5;3~). Null for anything else,
 * such as a paste or a report the terminal answers with, which the armed Alt lets through as it is.
 */
export function altSequence(data: string): string | null {
  if ([...data].length === 1) return "\u001b" + data;
  const cursor = /^\u001b[[O]([A-DHF])$/.exec(data);
  if (cursor) return `\u001b[1;3${cursor[1]}`;
  const editing = /^\u001b\[(\d+)~$/.exec(data);
  if (editing) return `\u001b[${editing[1]};3~`;
  return null;
}

/**
 * xterm's modifyOtherKeys level after CSI > 4 ; Pv m, or CSI > 4 n, which turns it off. Other
 * resources leave it as it was. xterm.js 5.5 ignores the request and types Ctrl+Enter as a plain
 * CR, the same as Enter, so PaneTerminal keeps the level here and sends that key itself.
 * herdr passes the pane program's request on to the attached client, and again on every
 * attach; Claude Code asks for level 2.
 */
export function modifyOtherKeysLevel(level: number, final: "m" | "n", params: ReadonlyArray<number | number[]>): number {
  // a bare CSI > m or CSI > n resets every key-modifier resource (xterm). xterm.js hands it over
  // as [0], the same as an explicit resource 0 (modifyKeyboard, which this does not track): off
  // is the safe reading, since a level left on would type CSI 27;5;13~ into a shell
  if (params.length === 0 || (params.length === 1 && params[0] === 0)) return 0;
  if (params[0] !== 4) return level;
  const value = params[1];
  return final === "m" && typeof value === "number" ? value : 0;
}

/** Ctrl+Enter under modifyOtherKeys, as xterm encodes it; null keeps xterm.js's own CR. */
export function ctrlEnterSequence(modifyOtherKeys: number): string | null {
  return modifyOtherKeys > 0 ? "\u001b[27;5;13~" : null;
}
