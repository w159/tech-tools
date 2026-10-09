#!/usr/bin/env python3
"""WCAG 2.x contrast checker for the Atlas Command Center palette.

The PALETTE dicts below are the source of truth for the color tables in MASTER.md.
Run: python3 contrast.py            -> markdown tables + FAIL list; exit 1 on any FAIL.
Text pairs need >= 4.5 (AA), large/UI/focus pairs need >= 3.0.
Tint = status color mixed over the surface at TINT_ALPHA (what the badge background is).
"""

import sys

TINT_ALPHA = 0.16

DARK = {
    "bg": "#0c1215",
    "chrome": "#090e11",
    "s1": "#121a1e",
    "s2": "#19232a",
    "s3": "#212e36",
    "border": "#263540",
    "border-strong": "#62798a",
    "text": "#e6edf0",
    "text-dim": "#9fb0b8",
    "text-faint": "#8394a0",
    "accent": "#2fbd9f",
    "accent-hover": "#4fd1b5",
    "accent-ink": "#05211b",
    "accent-text": "#3fcfb0",
    "focus": "#7fe0cb",
    "ok": "#52c872",
    "working": "#62b8e6",
    "input": "#f2aa40",
    "fail": "#ff7570",
    "idle": "#93a4ac",
    "sub": "#b5a3fa",
}
LIGHT = {
    "bg": "#f2f6f7",
    "chrome": "#e8eef0",
    "s1": "#ffffff",
    "s2": "#edf2f4",
    "s3": "#e0e8eb",
    "border": "#d0dbdf",
    "border-strong": "#73868f",
    "text": "#12222a",
    "text-dim": "#465962",
    "text-faint": "#566a74",
    "accent": "#0c7d6c",
    "accent-hover": "#096354",
    "accent-ink": "#ffffff",
    "accent-text": "#0a6e5f",
    "focus": "#0a6e5f",
    "ok": "#17692f",
    "working": "#0a6396",
    "input": "#8a4b00",
    "fail": "#ac211a",
    "idle": "#4f616a",
    "sub": "#5b3bb8",
}
STATUS = ["ok", "working", "input", "fail", "idle", "sub"]


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def lum(c):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (f(x) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def mix(fg, bg, a):
    return tuple(round(fg[i] * a + bg[i] * (1 - a)) for i in range(3))


def hexs(c):
    return f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}"


def pairs(P):
    """(label, fg, bg, min) rows."""
    out = []
    for surf in ("bg", "s1", "s2", "s3", "chrome"):
        out.append((f"text on {surf}", rgb(P["text"]), rgb(P[surf]), 4.5))
    for surf in ("bg", "s1", "s2", "s3", "chrome"):
        out.append((f"text-dim on {surf}", rgb(P["text-dim"]), rgb(P[surf]), 4.5))
    for surf in ("bg", "s1", "s2", "chrome"):
        out.append((f"text-faint on {surf}", rgb(P["text-faint"]), rgb(P[surf]), 4.5))
    for surf in ("bg", "s1", "s2"):
        out.append((f"accent-text on {surf}", rgb(P["accent-text"]), rgb(P[surf]), 4.5))
    out.append(
        (
            "accent-ink on accent (primary button)",
            rgb(P["accent-ink"]),
            rgb(P["accent"]),
            4.5,
        )
    )
    out.append(
        (
            "accent-ink on accent-hover",
            rgb(P["accent-ink"]),
            rgb(P["accent-hover"]),
            4.5,
        )
    )
    for surf in ("bg", "s1", "s2", "s3"):
        out.append(
            (f"focus ring on {surf} (UI 3:1)", rgb(P["focus"]), rgb(P[surf]), 3.0)
        )
    for surf in ("bg", "s1", "s2"):
        out.append(
            (
                f"border-strong on {surf} (control edge, UI 3:1)",
                rgb(P["border-strong"]),
                rgb(P[surf]),
                3.0,
            )
        )
    for st in STATUS:
        for surf in ("s1", "s2"):
            out.append((f"{st} text/glyph on {surf}", rgb(P[st]), rgb(P[surf]), 4.5))
            tint = mix(rgb(P[st]), rgb(P[surf]), TINT_ALPHA)
            out.append((f"{st} text on its tint over {surf}", rgb(P[st]), tint, 4.5))
    return out


def main():
    fails = []
    for name, P in (("Dark", DARK), ("Light", LIGHT)):
        print(f"\n### {name}\n")
        print("| Pair | fg | bg | ratio | need | result |")
        print("|---|---|---|---|---|---|")
        for label, fg, bg, need in pairs(P):
            r = ratio(fg, bg)
            ok = r >= need
            if not ok:
                fails.append((name, label, round(r, 2), need))
            print(
                f"| {label} | {hexs(fg)} | {hexs(bg)} | {r:.2f} | {need} | {'pass' if ok else 'FAIL'} |"
            )
    print()
    if fails:
        print("FAILS:")
        for f in fails:
            print("  ", f)
        sys.exit(1)
    print("ALL PAIRS PASS")


if __name__ == "__main__":
    main()
