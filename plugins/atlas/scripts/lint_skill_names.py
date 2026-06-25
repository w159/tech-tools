#!/usr/bin/env python3
"""Assert every atlas skill dir is `atlas-<one themed word>`: exactly one dash."""

import os, sys

skills = os.path.join(os.path.dirname(__file__), "..", "skills")
bad = []
for name in sorted(os.listdir(skills)):
    if not os.path.isdir(os.path.join(skills, name)):
        continue
    if not name.startswith("atlas-") or name.count("-") != 1:
        bad.append(name)
if bad:
    print("NON-CONFORMANT:", bad)
    sys.exit(1)
print("all skill names conform (single dash, atlas- prefix)")
