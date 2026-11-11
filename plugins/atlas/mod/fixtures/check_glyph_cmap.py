#!/usr/bin/env python3
"""Check (or regenerate) the DejaVu Sans Mono glyph coverage of ATLAS_GLYPHS.

usage: python3 check_glyph_cmap.py [--write] [path/to/DejaVuSansMono.ttf]

Reads the single-line ATLAS_GLYPHS literal from mod/atlas-ui.ts, looks each code point up in the font's cmap (fontTools)
and exits 1 listing any that are missing. With --write it rewrites dejavu-sans-mono-glyphs.ts, the checked-in list that
mod/theme.test.ts asserts against (the mod test host cannot read the font).
"""
import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--write"]
    font = TTFont(args[0] if args else FONT)
    cmap = font.getBestCmap()
    src = (HERE.parent / "atlas-ui.ts").read_text(encoding="utf-8")
    glyphs = re.search(r"export const ATLAS_GLYPHS = '([^']+)';", src).group(1)
    missing = [c for c in glyphs if ord(c) not in cmap]
    if missing:
        print("missing from DejaVu Sans Mono:", "".join(missing))
        return 1
    if "--write" in sys.argv:
        name = font["name"].getDebugName(5) or "DejaVu Sans Mono"
        (HERE / "dejavu-sans-mono-glyphs.ts").write_text(
            "// Glyphs of ATLAS_GLYPHS (mod/atlas-ui.ts) confirmed present in the cmap of DejaVu Sans Mono.\n"
            f"// Source: fontTools TTFont.getBestCmap() on {name}. Regenerate: python3 mod/fixtures/check_glyph_cmap.py --write\n"
            f"export const DEJAVU_SANS_MONO_HAS = '{glyphs}';\n",
            encoding="utf-8",
        )
    print(f"ok: {len(glyphs)} glyphs present in DejaVu Sans Mono")
    return 0


if __name__ == "__main__":
    sys.exit(main())
