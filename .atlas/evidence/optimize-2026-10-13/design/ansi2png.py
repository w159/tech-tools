#!/usr/bin/env python3
"""Render one frame of a tmux `capture-pane -e` dump to HTML, then PNG via headless Chrome.
usage: ansi2png.py <ansi file> <start line> <end line> <out.png> [cols]"""
import html, re, subprocess, sys, os

BASE16 = ["#1e1e2e", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de",
          "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#cdd6f4"]


def c256(n):
    if n < 16:
        return BASE16[n]
    if n < 232:
        n -= 16
        r, g, b = n // 36, (n // 6) % 6, n % 6
        f = lambda v: 0 if v == 0 else 55 + v * 40
        return "#%02x%02x%02x" % (f(r), f(g), f(b))
    v = 8 + (n - 232) * 10
    return "#%02x%02x%02x" % (v, v, v)


def render(lines):
    out, st = [], {}
    sgr = re.compile(r"\x1b\[([0-9;]*)m")
    for line in lines:
        pos, row = 0, []
        for m in sgr.finditer(line):
            row.append(span(line[pos:m.start()], st))
            apply(st, m.group(1))
            pos = m.end()
        row.append(span(line[pos:], st))
        out.append("".join(row))
    return "\n".join(out)


def apply(st, codes):
    p = [int(x) if x else 0 for x in codes.split(";")] if codes else [0]
    i = 0
    while i < len(p):
        c = p[i]
        if c == 0: st.clear()
        elif c == 1: st["b"] = 1
        elif c == 2: st["dim"] = 1
        elif c == 3: st["i"] = 1
        elif c == 4: st["u"] = 1
        elif c == 7: st["inv"] = 1
        elif c == 22: st.pop("b", None); st.pop("dim", None)
        elif c == 27: st.pop("inv", None)
        elif 30 <= c <= 37: st["fg"] = BASE16[c - 30]
        elif 90 <= c <= 97: st["fg"] = BASE16[c - 90 + 8]
        elif 40 <= c <= 47: st["bg"] = BASE16[c - 40]
        elif 100 <= c <= 107: st["bg"] = BASE16[c - 100 + 8]
        elif c == 39: st.pop("fg", None)
        elif c == 49: st.pop("bg", None)
        elif c in (38, 48) and i + 1 < len(p):
            key = "fg" if c == 38 else "bg"
            if p[i + 1] == 5 and i + 2 < len(p):
                st[key] = c256(p[i + 2]); i += 2
            elif p[i + 1] == 2 and i + 4 < len(p):
                st[key] = "#%02x%02x%02x" % tuple(p[i + 2:i + 5]); i += 4
        i += 1


def span(text, st):
    if not text:
        return ""
    fg, bg = st.get("fg", "#cdd6f4"), st.get("bg")
    if st.get("inv"):
        fg, bg = bg or "#1e1e2e", fg
    css = ["color:%s" % fg]
    if bg: css.append("background:%s" % bg)
    if st.get("b"): css.append("font-weight:700")
    if st.get("dim"): css.append("opacity:.55")
    if st.get("i"): css.append("font-style:italic")
    if st.get("u"): css.append("text-decoration:underline")
    return '<span style="%s">%s</span>' % (";".join(css), html.escape(text))


def main():
    src, a, b, png = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    cols = int(sys.argv[5]) if len(sys.argv) > 5 else 160
    lines = open(src, encoding="utf-8", errors="replace").read().split("\n")[a - 1:b]
    body = render(lines)
    page = ("<html><head><meta charset='utf-8'><style>body{margin:0;background:#1e1e2e}"
            "pre{margin:0;padding:12px;font:13px/1.25 'JetBrainsMono Nerd Font','JetBrains Mono',Menlo,monospace;"
            "color:#cdd6f4;white-space:pre}</style></head><body><pre>%s</pre></body></html>" % body)
    hp = png[:-4] + ".html"
    open(hp, "w").write(page)
    w = int(cols * 7.9) + 30
    h = int(len(lines) * 16.3) + 30
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--window-size=%d,%d" % (w, h), "--screenshot=" + os.path.abspath(png),
                    "file://" + os.path.abspath(hp)], capture_output=True, timeout=60)
    print(png, os.path.exists(png))


main()
