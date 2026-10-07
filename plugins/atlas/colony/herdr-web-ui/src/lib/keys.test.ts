import { describe, expect, it } from "bun:test";
import { altSequence, controlCode, ctrlEnterSequence, isPrintable, keySequence, modifyOtherKeysLevel, sanitizeKeyBarExtras } from "./keys.ts";

describe("controlCode", () => {
  it("maps letters to their control code regardless of case", () => {
    expect(controlCode("c")).toBe("\u0003");
    expect(controlCode("C")).toBe("\u0003");
    expect(controlCode("a")).toBe("\u0001");
    expect(controlCode("z")).toBe("\u001a");
  });

  it("maps the six punctuation keys terminals define control codes for", () => {
    expect(controlCode("@")).toBe("\u0000");
    expect(controlCode("[")).toBe("\u001b");
    expect(controlCode("\\")).toBe("\u001c");
    expect(controlCode("]")).toBe("\u001d");
    expect(controlCode("^")).toBe("\u001e");
    expect(controlCode("_")).toBe("\u001f");
  });

  it("returns null for anything else, so the character is sent as typed", () => {
    for (const ch of ["1", " ", "?", "é", "ㄱ", "ab", ""]) expect(controlCode(ch)).toBeNull();
  });
});

describe("isPrintable", () => {
  it("accepts one printable character and rejects control characters, DEL and multi-character input", () => {
    expect(isPrintable("a")).toBe(true);
    expect(isPrintable(" ")).toBe(true);
    expect(isPrintable("ㄱ")).toBe(true);
    expect(isPrintable("\u001b")).toBe(false);
    expect(isPrintable("\u007f")).toBe(false);
    expect(isPrintable("ab")).toBe(false);
    expect(isPrintable("")).toBe(false);
  });
});

describe("keySequence", () => {
  it("sends the fixed bytes for Escape, Tab and Ctrl+C", () => {
    expect(keySequence("Escape", false)).toBe("\u001b");
    expect(keySequence("Tab", false)).toBe("\t");
    expect(keySequence("ctrl-c", true)).toBe("\u0003");
  });

  it("sends CSI arrows normally and SS3 arrows under application cursor keys mode", () => {
    expect(keySequence("ArrowUp", false)).toBe("\u001b[A");
    expect(keySequence("ArrowDown", false)).toBe("\u001b[B");
    expect(keySequence("ArrowRight", false)).toBe("\u001b[C");
    expect(keySequence("ArrowLeft", false)).toBe("\u001b[D");
    expect(keySequence("ArrowUp", true)).toBe("\u001bOA");
    expect(keySequence("ArrowLeft", true)).toBe("\u001bOD");
  });

  it("sends the optional keys as xterm does: Home/End follow DECCKM, the rest are fixed", () => {
    expect(keySequence("BackTab", false)).toBe("\u001b[Z");
    expect(keySequence("Home", false)).toBe("\u001b[H");
    expect(keySequence("End", false)).toBe("\u001b[F");
    expect(keySequence("Home", true)).toBe("\u001bOH");
    expect(keySequence("End", true)).toBe("\u001bOF");
    expect(keySequence("PageUp", true)).toBe("\u001b[5~");
    expect(keySequence("PageDown", false)).toBe("\u001b[6~");
    expect(keySequence("ctrl-d", false)).toBe("\u0004");
    expect(keySequence("ctrl-z", false)).toBe("\u001a");
    expect([keySequence("pipe", false), keySequence("tilde", false), keySequence("slash", false)]).toEqual(["|", "~", "/"]);
  });
});

describe("altSequence", () => {
  it("puts ESC before one character, control characters and IME syllables included", () => {
    expect(altSequence("b")).toBe("\u001bb");
    expect(altSequence("\u007f")).toBe("\u001b\u007f");
    expect(altSequence("\r")).toBe("\u001b\r");
    expect(altSequence("\u0003")).toBe("\u001b\u0003");
    expect(altSequence("한")).toBe("\u001b한");
    expect(altSequence("😀")).toBe("\u001b😀");
  });

  it("adds the Alt modifier to cursor and editing keys in either cursor mode", () => {
    expect(altSequence("\u001b[D")).toBe("\u001b[1;3D");
    expect(altSequence("\u001bOA")).toBe("\u001b[1;3A");
    expect(altSequence("\u001bOH")).toBe("\u001b[1;3H");
    expect(altSequence("\u001b[5~")).toBe("\u001b[5;3~");
  });

  it("leaves pastes and terminal reports alone, so they do not use up the armed Alt", () => {
    for (const data of ["ab", "", "\u001b[12;5R", "\u001b[I", "\u001b[<0;3;4M", "\u001b[200~x\u001b[201~", "\u001b[Z"]) expect(altSequence(data)).toBeNull();
  });
});

describe("sanitizeKeyBarExtras", () => {
  it("keeps known keys once, in the bar's order, and the default for a missing list", () => {
    expect(sanitizeKeyBarExtras(["slash", "alt", "nope", "alt", 3], ["alt"])).toEqual(["alt", "slash"]);
    expect(sanitizeKeyBarExtras([], ["alt"])).toEqual([]);
    expect(sanitizeKeyBarExtras(undefined, ["alt"])).toEqual(["alt"]);
    expect(sanitizeKeyBarExtras("alt", ["alt"])).toEqual(["alt"]);
  });
});

describe("modifyOtherKeysLevel", () => {
  it("follows CSI > 4 ; Pv m and turns off on CSI > 4 m and CSI > 4 n", () => {
    expect(modifyOtherKeysLevel(0, "m", [4, 2])).toBe(2);
    expect(modifyOtherKeysLevel(0, "m", [4, 1])).toBe(1);
    // herdr turns it off as CSI > 4 ; 0 m, a program may leave the value out
    expect(modifyOtherKeysLevel(2, "m", [4, 0])).toBe(0);
    expect(modifyOtherKeysLevel(2, "m", [4])).toBe(0);
    expect(modifyOtherKeysLevel(2, "n", [4])).toBe(0);
    // a bare CSI > m or CSI > n resets every resource; xterm.js reports it as [0] or []
    expect(modifyOtherKeysLevel(2, "m", [0])).toBe(0);
    expect(modifyOtherKeysLevel(2, "n", [0])).toBe(0);
    expect(modifyOtherKeysLevel(2, "m", [])).toBe(0);
  });

  it("leaves the level alone for the other key modifier resources", () => {
    expect(modifyOtherKeysLevel(2, "m", [1, 2])).toBe(2);
    expect(modifyOtherKeysLevel(2, "n", [1])).toBe(2);
    expect(modifyOtherKeysLevel(0, "m", [[4, 2]])).toBe(0);
  });
});

describe("ctrlEnterSequence", () => {
  it("keeps xterm.js's CR until the program asks for modifyOtherKeys", () => {
    expect(ctrlEnterSequence(0)).toBeNull();
    expect(ctrlEnterSequence(1)).toBe("\u001b[27;5;13~");
    expect(ctrlEnterSequence(2)).toBe("\u001b[27;5;13~");
  });
});
