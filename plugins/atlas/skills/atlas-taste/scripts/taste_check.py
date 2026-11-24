#!/usr/bin/env python3
"""atlas-taste static consistency check and finish gate. Stdlib only, never starts a browser.

Reads docs/standards/design-system.md (frontmatter: applies_to, tokens, icon_library,
allow_raw_values_in), parses the listed token files, scans the UI source and reports
FAIL/WARN with file:line:
  FAIL  raw color literal (hex/rgb/hsl) that equals no token value
  FAIL  import from an icon library other than `icon_library`
  WARN  px/rem spacing or radius literal off the token scale (only when the tokens define that scale)
  WARN  unsupported token format, no tokens listed, icon_library unset

Exit: 1 on any FAIL, 0 otherwise, 2 when no design-system standard exists.
`--arm [--rounds N]` / `--gate` implement the Stop-hook finish gate (see SKILL.md).
"""
import argparse
import fnmatch
import json
import os
import re
import sys
from pathlib import PurePosixPath

STANDARD = "docs/standards/design-system.md"
ARMED = ".atlas/.run/taste/armed.json"
SKIP_DIRS = {"node_modules", ".git", ".atlas", "dist", "build", ".next", ".venv", "venv", "__pycache__"}
MAX_BYTES = 1_000_000

HEX = re.compile(r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b")
FUNC = re.compile(r"\b(?:rgba?|hsla?)\(\s*[^)]*\)", re.I)
DIM = re.compile(r"(?<![\w.#-])(\d*\.?\d+)(px|rem)\b")
SPACING_PROP = re.compile(r"\b(?:padding|margin|gap|row-gap|column-gap|inset)[\w-]*\s*[:=]")
RADIUS_PROP = re.compile(r"\b(?:border-)?(?:[a-z]+-)*radius\s*[:=]|\brounded\b", re.I)
IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*|@import\s+(?:url\()?\s*)['"]([^'"]+)['"]""")
# ponytail: icon packages are recognised by name keywords; a library with an unrelated name slips through.
ICONISH = re.compile(r"icon|lucide|fontawesome|heroicons|phosphor|tabler|feather|remix|iconify|material-symbols", re.I)


# ---- standard frontmatter -------------------------------------------------

def parse_frontmatter(text):
    m = re.match(r"---\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", text, re.S)
    out = {}
    if not m:
        return out
    key = None
    for line in m.group(1).splitlines():
        item = re.match(r"\s+-\s*(.+?)\s*$", line)
        if item and key:
            out.setdefault(key, []).append(item.group(1).strip("\"'"))
            continue
        kv = re.match(r"([A-Za-z_]+):\s*(.*?)\s*$", line)
        if not kv:
            continue
        key, val = kv.group(1), kv.group(2)
        if val.startswith("[") and val.endswith("]"):
            out[key] = [v.strip().strip("\"'") for v in val[1:-1].split(",") if v.strip()]
        elif val:
            out[key] = val.strip("\"'")
        else:
            out[key] = []
    return out


def as_list(v):
    if not v:
        return []
    return v if isinstance(v, list) else [v]


# ---- tokens ---------------------------------------------------------------

def norm_color(v):
    """Canonical lowercase form so #FFF, #ffffff and rgb(255,255,255) compare equal."""
    v = v.strip().lower()
    if v.startswith("#"):
        h = v[1:]
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        return "#" + h
    m = re.match(r"rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)$", v)
    if m and max(int(x) for x in m.groups()) <= 255:
        return "#%02x%02x%02x" % tuple(int(x) for x in m.groups())
    return re.sub(r"\s+", "", v)


def to_px(num, unit):
    return float(num) * (16 if unit == "rem" else 1)


def flatten_json(node, path=()):
    if isinstance(node, dict):
        if "$value" in node or "value" in node and not isinstance(node.get("value"), dict):
            yield ".".join(path), str(node.get("$value", node.get("value")))
            return
        for k, v in node.items():
            if not k.startswith("$"):
                yield from flatten_json(v, path + (k,))
    elif isinstance(node, (str, int, float)):
        yield ".".join(path), str(node)


def load_tokens(root, files):
    """Returns (colors:set, spacing:set px, radius:set px, warnings:[(file, msg)])."""
    colors, spacing, radius, warns = set(), set(), set(), []
    for rel in files:
        path = os.path.join(root, rel)
        ext = os.path.splitext(rel)[1].lower()
        if not os.path.isfile(path):
            warns.append((rel, "token file not found"))
            continue
        try:
            text = open(path, encoding="utf-8").read()
            if ext in (".css", ".pcss", ".postcss"):
                pairs = re.findall(r"(--[\w-]+)\s*:\s*([^;}]+)", text)
            elif ext == ".json":
                pairs = list(flatten_json(json.loads(text)))
            else:
                warns.append((rel, "unsupported token format %r (supported: .css custom properties incl. @theme, .json)" % ext))
                continue
        except (OSError, ValueError) as exc:
            warns.append((rel, "token file unreadable: %s" % exc))
            continue
        for name, value in pairs:
            value = value.strip()
            lname = name.lower()
            if HEX.fullmatch(value) or FUNC.fullmatch(value):
                colors.add(norm_color(value))
                continue
            d = re.fullmatch(r"(\d*\.?\d+)(px|rem)", value)
            if d and re.search(r"radius|rounded", lname):
                radius.add(to_px(*d.groups()))
            elif d and re.search(r"space|spacing|gap", lname):
                spacing.add(to_px(*d.groups()))
    return colors, spacing, radius, warns


# ---- scanning -------------------------------------------------------------

def match(rel, glob):
    p = PurePosixPath(rel)
    if hasattr(p, "full_match"):
        return p.full_match(glob)
    # ponytail: fnmatch '*' crosses '/', so pre-3.13 over-matches; fine for a lint
    return fnmatch.fnmatch(rel, glob)


def source_files(root, applies, skip_globs, token_files):
    skip = set(token_files)
    for dirpath, dirs, names in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for n in sorted(names):
            rel = os.path.relpath(os.path.join(dirpath, n), root).replace(os.sep, "/")
            if rel == STANDARD or rel in skip:
                continue
            if any(match(rel, g) for g in skip_globs):
                continue
            if any(match(rel, g) for g in applies):
                yield rel


def scan(root, applies, skip_globs, token_files, icon_library, colors, spacing, radius):
    findings = []

    def add(level, rel, line, msg):
        findings.append({"level": level, "file": rel, "line": line, "message": msg})

    for rel in source_files(root, applies, skip_globs, token_files):
        full = os.path.join(root, rel)
        try:
            if os.path.getsize(full) > MAX_BYTES:
                continue
            lines = open(full, encoding="utf-8").read().splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        for i, line in enumerate(lines, 1):
            stripped = line.strip()
            if stripped.startswith(("//", "*", "/*", "<!--")):
                continue
            # ponytail: '#abc' in a selector or URL fragment with only hex letters reads as a color.
            for m in list(HEX.finditer(line)) + list(FUNC.finditer(line)):
                if "var(" in line[max(0, m.start() - 4):m.start()]:
                    continue
                if norm_color(m.group(0)) not in colors:
                    add("FAIL", rel, i, "raw color %s equals no token value; use a token" % m.group(0))
            for label, prop, scale in (("spacing", SPACING_PROP, spacing), ("radius", RADIUS_PROP, radius)):
                if not scale:
                    continue
                for pm in prop.finditer(line):
                    # only the declaration value, so a radius is not judged on the padding next to it
                    for d in DIM.finditer(line[pm.end():].split(";")[0]):
                        px = to_px(*d.groups())
                        if px != 0 and px not in scale:
                            add("WARN", rel, i, "%s %s is off the token %s scale" % (label, d.group(0), label))
            for m in IMPORT.finditer(line):
                pkg = m.group(1)
                if icon_library and ICONISH.search(pkg) and not pkg.startswith((".", "/")):
                    if not (pkg == icon_library or pkg.startswith(icon_library.rstrip("/") + "/")):
                        add("FAIL", rel, i, "icon import %r; the project icon library is %r" % (pkg, icon_library))
    return findings


def run_check(root):
    """Returns (exit_code, findings). Exit 2 when the standard is missing."""
    std = os.path.join(root, STANDARD)
    if not os.path.isfile(std):
        return 2, []
    fm = parse_frontmatter(open(std, encoding="utf-8").read())
    applies = as_list(fm.get("applies_to"))
    token_files = as_list(fm.get("tokens"))
    skip_globs = as_list(fm.get("allow_raw_values_in"))
    icon_library = fm.get("icon_library") or ""
    findings = []
    if not token_files:
        findings.append({"level": "WARN", "file": STANDARD, "line": 1, "message": "no tokens listed; ask the user and run atlas-taste init"})
    if not icon_library:
        findings.append({"level": "WARN", "file": STANDARD, "line": 1, "message": "icon_library unset; icon imports are not checked"})
    colors, spacing, radius, warns = load_tokens(root, token_files)
    findings += [{"level": "WARN", "file": f, "line": 1, "message": m} for f, m in warns]
    findings += scan(root, applies, skip_globs, token_files, icon_library, colors, spacing, radius)
    code = 1 if any(f["level"] == "FAIL" for f in findings) else 0
    return code, findings


def render(findings):
    return "\n".join("%s %s:%d %s" % (f["level"], f["file"], f["line"], f["message"]) for f in findings)


# ---- finish gate ----------------------------------------------------------

def arm(root, rounds):
    path = os.path.join(root, ARMED)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"max_rounds": rounds, "round": 0}, fh)
    print("atlas-taste: gate armed, max %d rounds" % rounds)
    return 0


def gate(root):
    """Stop hook. Silent unless armed; blocks while FAILs remain; gives up after max rounds."""
    path = os.path.join(root, ARMED)
    try:
        state = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    code, findings = run_check(root)
    fails = [f for f in findings if f["level"] == "FAIL"]
    if code == 2 or not fails:
        os.remove(path)
        return 0
    rnd = int(state.get("round", 0)) + 1
    mx = int(state.get("max_rounds", 5))
    if rnd >= mx:
        os.remove(path)
        msg = "atlas-taste: gate gave up: %d FAILs open after %d rounds. Tell the user which remain.\n%s" % (len(fails), mx, render(fails))
        print(json.dumps({"systemMessage": msg}))
        return 0
    state["round"] = rnd
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(state, fh)
    reason = "atlas-taste: %d FAILs open (round %d of %d). Fix them with the project tokens, do not edit the standard to hide them.\n%s" % (len(fails), rnd, mx, render(fails))
    print(json.dumps({"decision": "block", "reason": reason}))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    ap.add_argument("--root", default=os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--gate", action="store_true")
    ap.add_argument("--arm", action="store_true")
    ap.add_argument("--rounds", type=int, default=5)
    a = ap.parse_args(argv)
    root = os.path.abspath(a.root)
    if a.arm:
        return arm(root, a.rounds)
    if a.gate:
        return gate(root)
    code, findings = run_check(root)
    if code == 2:
        print("atlas-taste: no %s found; run atlas-taste init" % STANDARD, file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps({"exit": code, "findings": findings}, indent=2))
    else:
        out = render(findings)
        print(out + "\n" if out else "", end="")
        print("atlas-taste: %d FAIL, %d WARN" % (sum(f["level"] == "FAIL" for f in findings), sum(f["level"] == "WARN" for f in findings)))
    return code


if __name__ == "__main__":
    sys.exit(main())
