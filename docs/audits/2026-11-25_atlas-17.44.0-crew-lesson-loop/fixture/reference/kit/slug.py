"""kit.slug: see SPEC.md."""
import re

MAX = 32
SEP = "_"


def slugify(text):
    words = re.findall(r"[a-z0-9]+", str(text).lower())
    out = ""
    for w in words:
        cand = w if not out else out + SEP + w
        if len(cand) > MAX:
            if not out:
                out = w[:MAX]
            break
        out = cand
    return out
