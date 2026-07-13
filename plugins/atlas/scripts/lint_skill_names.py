#!/usr/bin/env python3
"""Assert every atlas skill dir starts with `atlas-` and uses valid slug characters.

Anthropic's skill spec allows lowercase letters, numbers, and hyphens, with a 64-char max.
We keep the `atlas-` prefix as our project convention but no longer enforce exactly one dash,
because command-like skills (atlas-db-audit, atlas-vendor-assessment) need descriptive names.
"""

import os
import re
import sys

skills = os.path.join(os.path.dirname(__file__), "..", "skills")
bad = []
for name in sorted(os.listdir(skills)):
    if not os.path.isdir(os.path.join(skills, name)):
        continue
    # Skip hidden/cache dirs (e.g. .ruff_cache) and the shared docs subdir;
    # only actual skill dirs are subject to the naming convention.
    if name.startswith(".") or name == "docs":
        continue
    if not name.startswith("atlas-") or not re.fullmatch(
        r"atlas-[a-z0-9-]{1,59}", name
    ):
        bad.append(name)
if bad:
    print("NON-CONFORMANT:", bad)
    sys.exit(1)
print("all skill names conform (atlas- prefix, valid slug, ≤64 chars)")
