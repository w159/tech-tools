#!/usr/bin/env python3
"""Design prototype: emits truecolor ANSI frames for the ATLAS redesign target."""
import sys

W = 158
ESC = "\x1b["
RST = ESC + "0m"


def fg(c): return ESC + "38;2;%d;%d;%dm" % c
def bg(c): return ESC + "48;2;%d;%d;%dm" % c
def hx(s): s = s.lstrip("#"); return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))
def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


PANEL = hx("#11111b"); PANEL2 = hx("#181825"); TXT = hx("#cdd6f4"); MUT = hx("#6c7086"); DIM = hx("#45475a")
VIOLET = hx("#cba6f7"); TEAL = hx("#94e2d5"); SKY = hx("#89dceb"); BLUE = hx("#89b4fa"); GREEN = hx("#a6e3a1")
PEACH = hx("#fab387"); RED = hx("#f38ba8"); YEL = hx("#f9e2af"); PINK = hx("#f5c2e7"); BASE = hx("#1e1e2e")
PH = [("RESEARCH", BLUE), ("THEORY", VIOLET), ("TEST", YEL), ("IMPLEMENT", PEACH), ("VERIFY", GREEN), ("DONE", TEAL)]


def seg(text, f=None, b=None, bold=False):
    s = ""
    if bold: s += ESC + "1m"
    if f: s += fg(f)
    if b: s += bg(b)
    return s + text + RST


def vis(s):
    import re
    return len(re.sub(r"\x1b\[[0-9;]*m", "", s))


def pad(s, n, b=PANEL):
    return s + seg(" " * max(0, n - vis(s)), b=b)


def grad_bar(text_left, text_right, a, b):
    """Full-width gradient title bar with text drawn on top."""
    raw = list(" " + text_left + " " * W)
    r = list(text_right + " ")
    out = ""
    line = raw[:W]
    line[W - len(r):] = r
    for i, ch in enumerate(line):
        c = lerp(a, b, i / (W - 1))
        out += bg(c) + fg(BASE) + ESC + "1m" + ch
    return out + RST


def rail(cur, tick):
    out = ""
    for i, (name, col) in enumerate(PH):
        if i < cur:
            out += seg(" ✓ " + name.lower() + " ", BASE, lerp(col, PANEL, .45))
        elif i == cur:
            shimmer = lerp(col, (255, 255, 255), .25 + .25 * ((tick % 4) / 3))
            out += seg(" ◆ " + name + " ", BASE, shimmer, bold=True)
        else:
            out += seg(" " + name.lower() + " ", MUT, PANEL2)
        out += seg("▶" if i < len(PH) - 1 else " ", col if i < cur else DIM, PANEL)
    return out


EIGHTHS = " ▏▎▍▌▋▊▉█"


def bar(frac, width, a, b):
    cells = frac * width
    out = ""
    for i in range(width):
        c = lerp(a, b, i / max(1, width - 1))
        if i < int(cells):
            out += fg(c) + bg(PANEL2) + "█"
        elif i == int(cells):
            out += fg(c) + bg(PANEL2) + EIGHTHS[int((cells - int(cells)) * 8)]
        else:
            out += fg(DIM) + bg(PANEL2) + " "
    return out + RST


SPARK = "▁▂▃▄▅▆▇█"


def spark(vals, col):
    return seg("".join(SPARK[min(7, v)] for v in vals), col, PANEL)


def chip(text, col):
    return seg(" " + text + " ", BASE, col, bold=True)


def nick(name):
    pal = [PINK, PEACH, YEL, GREEN, TEAL, SKY, BLUE, VIOLET]
    return seg(name, pal[sum(map(ord, name)) % len(pal)], PANEL, bold=True)


def band_running(tick=1):
    rows = []
    rows.append(grad_bar("◢◤ ATLAS  ·  mission control      tech-tools@main  ·  wave 3  ·  audit/medium",
                         "◷ 02:41   3 live   ctx 23%   $0.41 ", hx("#cba6f7"), hx("#89dceb")))
    rows.append(pad(seg(" ", b=PANEL) + rail(3, tick), W))
    rows.append(pad(seg(" ", b=PANEL), W))
    lanes = [
        ("RUN", GREEN, "explorer-a324", "explorer", "ctx_search", "dispatch_tripwire.py", .62, [1, 3, 5, 2, 6, 7, 4, 2, 5, 6, 3, 1], "1m12s"),
        ("RUN", GREEN, "implementer-band", "implementer", "Edit", "mod/band.tsx  +42 -18", .35, [0, 1, 2, 4, 3, 5, 7, 6, 2, 3, 4, 5], "48s"),
        ("WAIT", YEL, "verifier-ui", "verifier", "blocked", "on implementer-band", .0, [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0], "12s"),
        ("DONE", TEAL, "explorer-c210", "explorer", "STATUS", "DONE · 4 findings", 1.0, [2, 4, 6, 7, 5, 3, 1, 0, 0, 0, 0, 0], "35s"),
    ]
    spin = "⣾⣽⣻⢿⡿⣟"[tick % 6]
    for st, col, name, role, tool, tgt, frac, sp, age in lanes:
        glyph = spin if st == "RUN" else ("◷" if st == "WAIT" else "✔")
        line = seg(" ", b=PANEL) + chip(st, col) + seg(" " + glyph + " ", col, PANEL)
        line += seg("%-18s" % name, TXT, PANEL, bold=True) + seg("%-12s" % role, MUT, PANEL)
        line += seg(" %-10s " % tool, col if st != "WAIT" else MUT, PANEL2, bold=True) + seg(" %-24s" % tgt[:24], TXT, PANEL)
        line += bar(frac, 28, lerp(col, PANEL, .1), lerp(col, (255, 255, 255), .35)) + seg("  ", b=PANEL)
        line += spark(sp, col) + seg("  %6s" % age, MUT, PANEL)
        rows.append(pad(line, W))
    rows.append(pad(seg(" ", b=PANEL), W))
    irc = seg(" ", b=PANEL) + chip("#lead-a47cc5", VIOLET) + seg(" ", b=PANEL)
    irc += seg("14:02 ", DIM, PANEL) + nick("explorer-a324") + seg(" → ", MUT, PANEL) + nick("implementer-band") + seg(": found 3 call sites in register.ts:604", TXT, PANEL)
    irc += seg("   14:03 ", DIM, PANEL) + nick("implementer-band") + seg(" → ", MUT, PANEL) + nick("all") + seg(": band.tsx compiles, running tests", TXT, PANEL)
    rows.append(pad(irc, W))
    foot = seg(" ", b=PANEL) + seg("tasks ", MUT, PANEL) + bar(5 / 9, 18, GREEN, TEAL) + seg(" 5/9  ", TXT, PANEL)
    for g, ok in [("completion", True), ("tripwire", True), ("routing", False), ("header", True), ("docs", True)]:
        foot += chip(("✔ " if ok else "✖ ") + g, GREEN if ok else RED) + seg(" ", b=PANEL)
    foot = pad(foot, W - 30) + seg("ctrl+x tab  r t c g  /atlas-cc ", MUT, PANEL)
    rows.append(pad(foot, W))
    return rows


def band_idle():
    rows = [grad_bar("◢◤ ATLAS  ·  idle", "last wave: 3 workers · 4m12s · ✔ verified · $0.38 ", hx("#585b70"), hx("#313244"))]
    rows.append(pad(seg(" ", b=PANEL) + rail(5, 0), W))
    return rows


def worker_pane(width=96):
    global W
    old, W = W, width
    rows = [grad_bar("◢◤ ATLAS  explorer-a324", "explorer · wave 3 ", hx("#a6e3a1"), hx("#94e2d5"))]
    rows.append(pad(seg(" goal ", MUT, PANEL) + seg("Map every caller of planRows and report file:line", TXT, PANEL), W))
    rows.append(pad(seg(" #lead-a47cc5  peers: implementer-band · verifier-ui", VIOLET, PANEL), W))
    rows.append(pad(seg("", b=PANEL), W))
    feed = [("14:01:07", "ctx_search", "planRows  in plugins/atlas/mod", GREEN), ("14:01:09", "ctx_read", "band.tsx:96-140", GREEN),
            ("14:01:12", "Bash", "python3 atlas_todo.py note --to implementer-band", VIOLET),
            ("14:01:12", "peer", "→ implementer-band: found 3 call sites in register.ts:604", PINK),
            ("14:01:15", "ctx_read", "register.ts:590-640", GREEN), ("14:01:19", "think", "planRows is pure; collapse order lanes > ticker", MUT)]
    for t, tool, arg, col in feed:
        rows.append(pad(seg(" " + t + " ", DIM, PANEL) + seg(" %-10s " % tool, BASE, col, bold=True) + seg(" " + arg, TXT, PANEL), W))
    rows.append(pad(seg("", b=PANEL), W))
    rows.append(pad(seg(" ⣾ working ", GREEN, PANEL, bold=True) + bar(.62, 30, GREEN, TEAL) + seg("  1m12s · 9 tools · 3.1k tok", MUT, PANEL), W))
    W = old
    return rows


def card():
    w = 100
    top = seg("▌", GREEN, PANEL2) + seg(" ⣾ explorer-a324 ", BASE, GREEN, bold=True) + seg(" explorer · sonnet·low · wave 3 ", TXT, PANEL2)
    rows = [top + seg(" " * (w - vis(top)), b=PANEL2)]
    for txt, col in [("goal  Map every caller of planRows and report file:line", TXT), ("now   ctx_read register.ts:590-640   ·   1m12s · 9 tools", MUT)]:
        l = seg("▌", GREEN, PANEL) + seg(" " + txt, col, PANEL)
        rows.append(l + seg(" " * (w - vis(l)), b=PANEL))
    return rows


def out(rows):
    print("\n".join(rows))


if __name__ == "__main__":
    which = sys.argv[1]
    out({"run": band_running, "idle": band_idle, "pane": worker_pane, "card": card}[which]())
