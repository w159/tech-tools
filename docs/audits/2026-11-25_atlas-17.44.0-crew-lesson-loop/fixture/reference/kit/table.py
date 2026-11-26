"""kit.table: see SPEC.md."""


def render(headers, rows):
    cols = len(headers)
    cells = [[str(h) for h in headers]] + [[str(c) for c in r] for r in rows]
    num = [all(isinstance(r[i], (int, float)) and not isinstance(r[i], bool) for r in rows) and bool(rows) for i in range(cols)]
    w = [max(len(r[i]) for r in cells) for i in range(cols)]

    def line(r):
        return " | ".join(r[i].rjust(w[i]) if num[i] else r[i].ljust(w[i]) for i in range(cols)).rstrip()

    out = [line(cells[0]), "-+-".join("-" * w[i] for i in range(cols))]
    out += [line(r) for r in cells[1:]]
    return "\n".join(out)
