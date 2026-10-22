#!/usr/bin/env python3
"""WCAG 2.x contrast checker for the Atlas Command Center palette.

The DARK/LIGHT dicts below mirror css/tokens.css; this script is the gate for that palette.
Run: python3 contrast.py            -> markdown tables + FAIL list; exit 1 on any FAIL.
Text pairs need >= 4.5 (AA), large/UI/focus pairs need >= 3.0.
Tint = status color mixed over the surface at TINT_ALPHA (what the badge background is).
"""

import re
import sys
from pathlib import Path

TINT_ALPHA = 0.16

# Names match css/tokens.css (the contract.ts palette). Edit both together;
# tokens.css hex values must equal these (checked by the sync assertion in main()).
DARK = {
    "canvas": "#0c1215",
    "chrome": "#0a0e11",
    "well": "#121a1e",
    "rule": "#263540",
    "rule-2": "#62798a",
    "text": "#e6edf0",
    "dim": "#9fb0b8",
    "faint": "#7a8b96",
    "brand": "#2fbd9f",
    "brand-ink": "#05211b",
    "focus": "#7fe0cb",
    "ok": "#52c872",
    "working": "#62b8e6",
    "needs": "#f2aa40",
    "fail": "#ff7570",
    "idle": "#93a4ac",
    "sub": "#b5a3fa",
}
LIGHT = {
    "canvas": "#f2f6f7",
    "chrome": "#e8eef0",
    "well": "#ffffff",
    "rule": "#d0dbdf",
    "rule-2": "#73868f",
    "text": "#12222a",
    "dim": "#465962",
    "faint": "#566a74",
    "brand": "#0c7d6c",
    "brand-ink": "#ffffff",
    "focus": "#0a6e5f",
    "ok": "#17692f",
    "working": "#0a6396",
    "needs": "#8a4b00",
    "fail": "#ac211a",
    "idle": "#4f616a",
    "sub": "#5b3bb8",
}
STATUS = ["ok", "working", "needs", "fail", "idle", "sub"]
SURF = ("canvas", "well")  # surfaces text sits on; chrome is the rail/topbar


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
    for tok in ("text", "dim", "faint"):
        for surf in ("canvas", "well", "chrome"):
            out.append((f"{tok} on {surf}", rgb(P[tok]), rgb(P[surf]), 4.5))
    for surf in SURF:
        out.append((f"brand text on {surf}", rgb(P["brand"]), rgb(P[surf]), 4.5))
    out.append(("brand-ink on brand (primary button)", rgb(P["brand-ink"]), rgb(P["brand"]), 4.5))
    for surf in ("canvas", "well", "chrome"):
        out.append((f"focus ring on {surf} (UI 3:1)", rgb(P["focus"]), rgb(P[surf]), 3.0))
        out.append((f"rule-2 on {surf} (control edge, UI 3:1)", rgb(P["rule-2"]), rgb(P[surf]), 3.0))
    for surf in SURF:
        # rule is a hairline divider, not a control edge: only required to be visible.
        out.append((f"rule on {surf} (divider, visible 1.2)", rgb(P["rule"]), rgb(P[surf]), 1.2))
    for st in STATUS:
        for surf in SURF:
            out.append((f"{st} text/glyph on {surf}", rgb(P[st]), rgb(P[surf]), 4.5))
            tint = mix(rgb(P[st]), rgb(P[surf]), TINT_ALPHA)
            out.append((f"{st} text on its tint over {surf}", rgb(P[st]), tint, 4.5))
    return out


def css_block(css, selector):
    m = re.search(re.escape(selector) + r"\s*\{(.*?)\n\s*\}", css, re.S)
    return dict(re.findall(r"--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;", m.group(1))) if m else {}


def sync_fails():
    """tokens.css hex values must equal the dicts above, in all three theme blocks."""
    css = (Path(__file__).resolve().parent.parent / "css" / "tokens.css").read_text()
    blocks = [
        ("Dark", DARK, ":root"),
        ("Light", LIGHT, ':root[data-theme="light"]'),
        ("Light", LIGHT, ':root[data-theme="system"]'),
    ]
    out = []
    for name, P, sel in blocks:
        got = css_block(css, sel)
        for k, v in P.items():
            if got.get(k, "").lower() != v:
                out.append((name, f"tokens.css {sel} --{k}={got.get(k)} != {v}", 0, 0))
    return out


def main():
    fails = sync_fails()
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
