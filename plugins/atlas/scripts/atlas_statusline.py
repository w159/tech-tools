#!/usr/bin/env python3
"""Claude Code statusLine renderer that mirrors the omp usage statusline look.

Reads the statusLine JSON on stdin, prints the grid. Layout, colors, bars and
config keys follow ~/.omp/agent/extensions/usage-statusline.ts so one config
file (~/.omp/agent/usage-statusline.json) restyles both harnesses.

  atlas_statusline.py                render from stdin
  atlas_statusline.py install        point settings.json statusLine at this script
  atlas_statusline.py uninstall      restore the previous statusLine (or remove)
Flags: --width N, --settings PATH, --home PATH.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

R = "\x1b[0m"
CYAN = "\x1b[1;36m"
MAGENTA = "\x1b[1;35m"
GREEN = "\x1b[1;32m"
YELLOW = "\x1b[1;33m"
RED = "\x1b[1;31m"
DIM = "\x1b[1;90m"
BOLD = "\x1b[1m"
BLUE = "\x1b[1;34m"
WHITE = "\x1b[1;37m"
SOFT = "\x1b[37m"
MONEY = "\x1b[35m"
TRACK = "\x1b[38;5;238m"
HEAT = [(80, 250, 123), (241, 250, 140), (255, 184, 108), (255, 85, 85)]
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
ANSI_SPLIT = re.compile(r"(\x1b\[[0-9;]*m)")

DEFAULTS = dict(
    glyphGap=2,
    lineGap=4,
    colGap=2,
    blankLine=True,
    spacerPipe=False,
    line1Mode="cwd-activity-model",
    showEffort=True,
    line1Pipe=False,
    cwdWidth=24,
    modelWidth=28,
    mCtx=True,
    m5h=True,
    m7d=True,
    barCells=14,
    barStyle="lower",
    heat=True,
    detailW=16,
    showRight=True,
    provRows=3,
    showCache=True,
    nameW=10,
    extraW=15,
    iconStyle="emoji",
)
BAR_STYLES = {
    "lower": ("▅", "▁"),
    "full": ("█", "░"),
    "seg": ("▰", "▱"),
    "line": ("━", "─"),
}
TEXT_ICONS = dict(
    dir="d", model="m", ctx="c", h5="5", d7="7", cost="$", prov="p", ready="~", time="t"
)
EMOJI_ICONS = dict(
    dir="📁",
    model="👾",
    ctx="📚",
    h5="⏳",
    d7="📅",
    cost="💰",
    prov="🔌",
    ready="🌱",
    time="⏱",
)
LINE1_MODES = ("cwd-activity-model", "cwd-activity", "activity-model", "cwd-model")

# ---------- width helpers ----------


def cw(ch):
    if unicodedata.category(ch) in ("Cf", "Mn") or ch == "​":
        return 0
    return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1


def vw(s):
    return sum(cw(c) for c in ANSI_RE.sub("", s))


def pad_end(s, w):
    return s + " " * max(0, w - vw(s))


def pad_start(s, w):
    return " " * max(0, w - vw(s)) + s


def clip(s, w):
    """Truncate to w cells with an ellipsis; ANSI sequences cost nothing."""
    if vw(s) <= w:
        return s
    out, used = "", 0
    for part in ANSI_SPLIT.split(s):
        if ANSI_RE.fullmatch(part):
            out += part
            continue
        for ch in part:
            if used + cw(ch) > w - 1:
                return out + "…" + (R if "\x1b" in out else "")
            out += ch
            used += cw(ch)
    return out


# ---------- formatters ----------


def fmt_tokens(t):
    t = int(t)
    if t >= 1_000_000:
        return "%.1fM" % (t // 100_000 / 10)
    if t >= 1_000:
        return "%.1fk" % (t // 100 / 10)
    return str(t)


def fmt_size(s):
    s = int(s)
    if s >= 1_000_000:
        return "%dM" % (s // 1_000_000)
    if s >= 1_000:
        return "%dk" % (s // 1_000)
    return str(s)


def fmt_cost(c):
    if c >= 100:
        return "$%d" % int(c)
    if c >= 0.01:
        return "$%.2f" % c
    return "$0.00" if c == 0 else "<$0.01"


def fmt_duration(ms):
    s = int(ms // 1000)
    if s >= 86400:
        return "%dd%dh" % (s // 86400, s % 86400 // 3600)
    if s >= 3600:
        return "%dh%dm" % (s // 3600, s % 3600 // 60)
    return "%dm%02ds" % (s // 60, s % 60)


def time_left(resets_ms, allow_days):
    if not resets_ms:
        return ""
    s = max(0, int((resets_ms - time.time() * 1000) // 1000))
    if s == 0:
        return ""
    if s >= 86400 and allow_days:
        return "%dd%dh" % (s // 86400, s % 86400 // 3600)
    m = s // 60
    return "%dh%dm" % (m // 60, m % 60) if m >= 60 else "%dm" % m


def short_model(mid):
    return re.sub(r"-\d{8}$", "", mid.split("/")[-1])


def pct_color(p):
    return GREEN if p <= 50 else YELLOW if p <= 75 else RED


def ctx_color(p):
    return GREEN if p <= 60 else YELLOW if p <= 85 else RED


def heat_color(f):
    x = min(0.9999, max(0.0, f)) * (len(HEAT) - 1)
    i = int(x)
    t = x - i
    r, g, b = (round(a + (HEAT[i + 1][k] - a) * t) for k, a in enumerate(HEAT[i]))
    return "\x1b[38;2;%d;%d;%dm" % (r, g, b)


# ---------- config ----------


def load_cfg():
    path = os.environ.get("ATLAS_STATUSLINE_CONFIG") or os.path.expanduser(
        "~/.omp/agent/usage-statusline.json"
    )
    raw = {}
    try:
        with open(path, encoding="utf-8") as f:
            parsed = json.load(f)
        raw = parsed.get("widget", parsed) if isinstance(parsed, dict) else {}
        if not isinstance(raw, dict):
            raw = {}
    except Exception:
        raw = {}
    d = DEFAULTS

    def num(k, lo, hi):
        v = raw.get(k)
        ok = (
            isinstance(v, (int, float))
            and not isinstance(v, bool)
            and v == v
            and abs(v) != float("inf")
        )
        return min(hi, max(lo, int(v + 0.5))) if ok else d[k]

    def b(k):
        return raw[k] if isinstance(raw.get(k), bool) else d[k]

    def one(k, opts):
        return raw[k] if raw.get(k) in opts else d[k]

    return dict(
        glyphGap=num("glyphGap", 1, 4),
        lineGap=num("lineGap", 1, 8),
        colGap=num("colGap", 1, 4),
        blankLine=b("blankLine"),
        spacerPipe=b("spacerPipe"),
        line1Mode=one("line1Mode", LINE1_MODES),
        showEffort=b("showEffort"),
        line1Pipe=b("line1Pipe"),
        cwdWidth=num("cwdWidth", 8, 40),
        modelWidth=num("modelWidth", 10, 40),
        mCtx=b("mCtx"),
        m5h=b("m5h"),
        m7d=b("m7d"),
        barCells=num("barCells", 4, 24),
        barStyle=one("barStyle", tuple(BAR_STYLES)),
        heat=b("heat"),
        detailW=num("detailW", 8, 24),
        showRight=b("showRight"),
        provRows=num("provRows", 0, 4),
        showCache=b("showCache"),
        nameW=num("nameW", 6, 18),
        extraW=num("extraW", 8, 24),
        iconStyle=one("iconStyle", ("emoji", "text")),
    )


# ---------- fallow ----------


def fallow_line(cwd, home):
    """Cached `fallow impact statusline` first line; never raises."""
    try:
        if not shutil.which("fallow") or not cwd:
            return ""
        cache = os.path.join(home, ".atlas", "statusline-fallow.cache")
        try:
            with open(cache, encoding="utf-8") as f:
                c = json.load(f)
            if c.get("cwd") == cwd and time.time() - float(c.get("at", 0)) < 60:
                return str(c.get("line", ""))
        except Exception:
            pass
        line = ""
        try:
            out = subprocess.run(
                ["fallow", "--root", cwd, "impact", "statusline"],
                capture_output=True,
                text=True,
                timeout=5,
            ).stdout
            first = (out.splitlines() or [""])[0].strip()
            line = first if first.startswith("fallow impact") else ""
        except Exception:
            line = ""
        try:
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            with open(cache, "w", encoding="utf-8") as f:
                json.dump({"cwd": cwd, "at": time.time(), "line": line}, f)
        except Exception:
            pass
        return line
    except Exception:
        return ""


# ---------- render ----------


def num_of(v, d=0):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else d


def render(data, width, home):
    cfg = load_cfg()
    text = cfg["iconStyle"] == "text"
    ic = TEXT_ICONS if text else EMOJI_ICONS
    icon_w = 1 if text else 2
    gap = " " * cfg["glyphGap"]
    cells = cfg["barCells"]
    fill, trk = BAR_STYLES[cfg["barStyle"]]
    detail_w = cfg["detailW"]
    meter_w = icon_w + len(gap) + 3 + 1 + 4 + 1 + cells + 2 + detail_w
    pad = " " * cfg["colGap"]
    col_gap = "%s%s│%s%s" % (pad, DIM, R, pad)
    hsep = "  %s·%s  " % (DIM, R)
    hsep_tight = " %s·%s " % (DIM, R)

    def bar(p):
        if p is None:
            return "%s%s%s" % (TRACK, trk * cells, R)
        p = max(0, min(100, p))
        n = max(1, round(p / 100 * cells)) if p > 0 else 0
        s = "".join(
            (heat_color(i / (cells - 1)) if cfg["heat"] else pct_color(p)) + fill
            for i in range(n)
        )
        return "%s%s%s%s" % (s, TRACK, trk * (cells - n), R)

    def meter(icon, label, pct, detail, color_for=pct_color):
        if pct is None:
            head = "%s%s%s%s%s%s " % (
                BOLD,
                CYAN,
                icon,
                R,
                gap,
                DIM + label.ljust(3) + R,
            )
            return pad_end(
                "%s%s%s%s %s  %s%s%s"
                % (head, DIM, "--%".rjust(4), R, bar(None), DIM, detail, R),
                meter_w,
            )
        p = max(0, min(100, round(pct)))
        col = color_for(p)
        head = "%s%s%s%s%s%s%s%s " % (BOLD, col, icon, R, gap, DIM, label.ljust(3), R)
        return pad_end(
            "%s%s%s%s%s %s  %s%s%s"
            % (
                head,
                BOLD,
                col,
                ("%d%%" % p).rjust(4),
                R,
                bar(p),
                DIM,
                clip(detail, detail_w),
                R,
            ),
            meter_w,
        )

    model_d = data.get("model") if isinstance(data.get("model"), dict) else {}
    ws = data.get("workspace") if isinstance(data.get("workspace"), dict) else {}
    cost_d = data.get("cost") if isinstance(data.get("cost"), dict) else {}
    cwd_d = (
        data.get("context_window")
        if isinstance(data.get("context_window"), dict)
        else {}
    )
    rl = data.get("rate_limits") if isinstance(data.get("rate_limits"), dict) else None
    eff = data.get("effort") if isinstance(data.get("effort"), dict) else {}

    cwd = ws.get("current_dir") or data.get("cwd") or os.getcwd()
    project = [p for p in str(cwd).split("/") if p][-1:] or [str(cwd)]
    project = project[0]
    model = model_d.get("display_name") or model_d.get("id") or "unknown"
    effort = eff.get("level") if cfg["showEffort"] else None

    # real width logic, mirrors the TS
    real = width
    term_cols = max(60, real - 2)
    row_cols = min(term_cols, real - 1)

    dur = num_of(cost_d.get("total_duration_ms"))
    if dur > 0:
        segs = ["%s%s%s %s%s" % (BOLD, GREEN, ic["time"], fmt_duration(dur), R)]
        a, r = (
            int(num_of(cost_d.get("total_lines_added"))),
            int(num_of(cost_d.get("total_lines_removed"))),
        )
        if a or r:
            segs.append("%s+%d/-%d lines%s" % (DIM, a, r, R))
    else:
        segs = ["%s%s%sready%s" % (ic["ready"], gap, DIM, R)]

    first_left_w = meter_w + vw(col_gap)
    cwd_part = "%s%s%s%s%s   " % (
        CYAN,
        ic["dir"],
        gap,
        clip(project, cfg["cwdWidth"]),
        R,
    )
    model_part = "%s%s%s%s%s" % (
        BLUE,
        ic["model"],
        gap,
        clip(model, cfg["modelWidth"]),
        R,
    )
    if effort:
        model_part += "%s%s%s%s" % (hsep, SOFT, effort, R)
    line_gap = " " * cfg["lineGap"]
    budget = (
        max(0, first_left_w - vw(cwd_part))
        if cfg["line1Pipe"]
        else max(0, row_cols - vw(cwd_part) - len(line_gap) - vw(model_part))
    )
    while len(segs) > 1 and vw(hsep_tight.join(segs)) > budget:
        segs.pop()
    work = hsep_tight.join(segs)
    mode = cfg["line1Mode"]
    if mode == "cwd-activity":
        first = cwd_part + work
    elif mode == "activity-model":
        first = work + line_gap + model_part
    elif mode == "cwd-model":
        first = cwd_part.rstrip() + line_gap + model_part
    elif cfg["line1Pipe"]:
        first = pad_end(cwd_part + work, meter_w) + col_gap + model_part
    else:
        first = cwd_part + work + line_gap + model_part
    if vw(first) > row_cols and first.endswith(model_part):
        first = first[: len(first) - len(model_part)].rstrip()

    # ctx
    size = int(num_of(cwd_d.get("context_window_size")))
    cu = (
        cwd_d.get("current_usage")
        if isinstance(cwd_d.get("current_usage"), dict)
        else None
    )
    ctx_m = None
    if cu is not None and size > 0:
        toks = sum(
            num_of(cu.get(k))
            for k in (
                "input_tokens",
                "cache_creation_input_tokens",
                "cache_read_input_tokens",
            )
        )
        ctx_m = meter(
            ic["ctx"],
            "ctx",
            toks / size * 100,
            "%s / %s" % (fmt_tokens(toks), fmt_size(size)),
            ctx_color,
        )
    elif isinstance(cwd_d.get("used_percentage"), (int, float)):
        up = cwd_d["used_percentage"]
        det = (
            "%s / %s" % (fmt_tokens(up / 100 * size), fmt_size(size))
            if size > 0
            else ""
        )
        ctx_m = meter(ic["ctx"], "ctx", up, det, ctx_color)
    else:
        ctx_m = meter(
            ic["ctx"], "ctx", None, "0 / %s" % fmt_size(size) if size > 0 else ""
        )

    def win(key, icon, label, days):
        w = rl.get(key) if rl and isinstance(rl.get(key), dict) else None
        if not w or not isinstance(w.get("used_percentage"), (int, float)):
            return meter(icon, label, None, "")
        left = time_left(num_of(w.get("resets_at")) * 1000, days)
        return meter(
            icon,
            label,
            w["used_percentage"],
            " ".join(x for x in (left, "anthropic") if x),
        )

    left = []
    if cfg["mCtx"]:
        left.append(ctx_m)
    if cfg["m5h"]:
        left.append(win("five_hour", ic["h5"], "5h", False))
    if cfg["m7d"]:
        left.append(win("seven_day", ic["d7"], "7d", True))

    # right table
    tot_tok = num_of(cwd_d.get("total_input_tokens")) + num_of(
        cwd_d.get("total_output_tokens")
    )
    if cu is not None:
        i_, cc, cr = (
            num_of(cu.get(k))
            for k in (
                "input_tokens",
                "cache_creation_input_tokens",
                "cache_read_input_tokens",
            )
        )
        cache_pct = round(cr / (i_ + cc + cr) * 100) if (i_ + cc + cr) > 0 else 0
    else:
        cache_pct = 0
    plan = rl is not None
    cost = "plan" if plan else fmt_cost(num_of(cost_d.get("total_cost_usd")))
    table = [
        dict(
            icon=ic["cost"],
            name="session",
            cost=cost,
            tok=fmt_tokens(tot_tok),
            extra="cache %d%%" % cache_pct if cfg["showCache"] else "",
            total=True,
            plan=plan,
        )
    ]
    if cfg["provRows"] > 0:
        table.append(
            dict(
                icon=ic["prov"],
                name="anthropic",
                cost=cost,
                tok=fmt_tokens(tot_tok),
                extra=short_model(str(model_d.get("id") or "")),
                total=False,
                plan=plan,
            )
        )
    name_w = min(cfg["nameW"] + 4, max([cfg["nameW"]] + [vw(r["name"]) for r in table]))
    cost_w = max([7] + [vw(r["cost"]) for r in table])
    tok_w = max([7] + [vw(r["tok"]) for r in table])
    right_budget = term_cols - meter_w - vw(col_gap)
    widest = 0
    right = []
    if cfg["showRight"]:
        for r in table:
            nm = "%s%s%s" % (
                WHITE if r["total"] else CYAN,
                pad_end(clip(r["name"], name_w), name_w),
                R,
            )
            cc_ = GREEN if r["plan"] else (BOLD + MAGENTA if r["total"] else MONEY)
            co = "%s%s%s" % (cc_, pad_start(r["cost"], cost_w), R)
            tk = (
                WHITE + pad_start(r["tok"], tok_w) + R
                if r["total"]
                else pad_start(r["tok"], tok_w)
            )
            head = "%s%s%s %s  %s %stok%s" % (r["icon"], gap, nm, co, tk, DIM, R)
            widest = max(widest, vw(head))
            ew = min(cfg["extraW"], right_budget - vw(head) - 2)
            right.append(
                "%s  %s%s%s" % (head, DIM, clip(r["extra"], ew), R)
                if ew >= 3 and r["extra"]
                else head
            )
    two_col_min = meter_w + vw(col_gap) + widest
    rrows = right if right and real - 1 >= two_col_min else []

    rows = [first]
    if cfg["blankLine"]:
        rows.append((" " * meter_w + col_gap).rstrip() if cfg["spacerPipe"] else "")
    for i in range(max(len(left), len(rrows))):
        if rrows:
            rows.append(
                (
                    pad_end(clip(left[i] if i < len(left) else "", meter_w), meter_w)
                    + col_gap
                    + (rrows[i] if i < len(rrows) else "")
                ).rstrip()
            )
        else:
            rows.append(left[i].rstrip())
    rows = [clip(r, row_cols) if vw(r) > row_cols else r for r in rows]
    fl = fallow_line(str(cwd), home)
    if fl:
        rows.append(clip(fl, row_cols))
    return rows


# ---------- install / uninstall ----------


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            v = json.load(f)
        return v if isinstance(v, dict) else {}
    except FileNotFoundError:
        return {}


def _save(path, obj):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")


def install(settings, home):
    prev = os.path.join(home, ".atlas", "statusline.previous.json")
    cfg = _load(settings)
    if not os.path.exists(prev):
        _save(prev, {"statusLine": cfg.get("statusLine")})
    cfg["statusLine"] = {
        "type": "command",
        "command": 'python3 "%s"' % os.path.abspath(__file__),
    }
    _save(settings, cfg)
    return "installed statusLine in %s (previous saved to %s)" % (settings, prev)


def uninstall(settings, home):
    prev = os.path.join(home, ".atlas", "statusline.previous.json")
    cfg = _load(settings)
    old = _load(prev).get("statusLine") if os.path.exists(prev) else None
    if old is None:
        cfg.pop("statusLine", None)
    else:
        cfg["statusLine"] = old
    _save(settings, cfg)
    if os.path.exists(prev):
        os.remove(prev)
    return "uninstalled: %s in %s" % (
        "restored previous statusLine" if old is not None else "removed statusLine",
        settings,
    )


def term_width(arg):
    if arg:
        return arg
    try:
        return int(os.environ["COLUMNS"])
    except (KeyError, ValueError):
        pass
    try:
        return shutil.get_terminal_size((120, 24)).columns
    except Exception:
        return 120


def main(argv=None, stdin=None):
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("cmd", nargs="?", choices=("install", "uninstall"))
    ap.add_argument("--width", type=int)
    ap.add_argument("--settings", default=os.path.expanduser("~/.claude/settings.json"))
    ap.add_argument("--home", default=os.path.expanduser("~"))
    a = ap.parse_args(argv)
    if a.cmd == "install":
        print(install(a.settings, a.home))
    elif a.cmd == "uninstall":
        print(uninstall(a.settings, a.home))
    else:
        try:
            data = json.loads(
                (stdin if stdin is not None else sys.stdin).read() or "{}"
            )
            data = data if isinstance(data, dict) else {}
        except Exception:
            data = {}
        try:
            rows = render(data, term_width(a.width), a.home)
        except Exception:
            rows = []  # a statusline must never traceback into the UI
        sys.stdout.write("\n".join(rows) + ("\n" if rows else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
