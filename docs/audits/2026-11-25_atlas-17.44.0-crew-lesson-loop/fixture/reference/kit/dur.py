"""kit.dur: see SPEC.md."""
import re

UNITS = (("d", 86400), ("h", 3600), ("m", 60), ("s", 1))


def format_duration(seconds):
    if isinstance(seconds, bool) or not isinstance(seconds, int) or seconds < 0:
        raise ValueError("seconds must be a non-negative int")
    if seconds == 0:
        return "0s"
    parts = []
    for u, n in UNITS:
        q, seconds = divmod(seconds, n)
        if q:
            parts.append(f"{q}{u}")
    return " ".join(parts)


def parse_duration(text):
    t = text.strip()
    if not re.fullmatch(r"\d+[dhms](?: \d+[dhms])*", t):
        raise ValueError(f"bad duration: {text!r}")
    seen, total, last = set(), 0, -1
    order = {u: i for i, (u, _) in enumerate(UNITS)}
    for tok in t.split(" "):
        u = tok[-1]
        if u in seen or order[u] <= last:
            raise ValueError(f"bad duration: {text!r}")
        seen.add(u)
        last = order[u]
        total += int(tok[:-1]) * dict(UNITS)[u]
    return total
