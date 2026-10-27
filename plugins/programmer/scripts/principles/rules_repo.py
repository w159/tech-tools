"""Repo-wide rules that need every module at once: duplication, import cycles, inheritance."""

from __future__ import annotations

import ast
import bisect
import hashlib
import io
import keyword
import tokenize
from collections import defaultdict

from .core import Finding, Module
from .rules_file import FUNC

# --- DRY001 ------------------------------------------------------------------

SKIP_TOKENS = {tokenize.COMMENT, tokenize.NL, tokenize.ENCODING, tokenize.ENDMARKER, tokenize.INDENT, tokenize.DEDENT, tokenize.TYPE_COMMENT} if hasattr(tokenize, "TYPE_COMMENT") else {tokenize.COMMENT, tokenize.NL, tokenize.ENCODING, tokenize.ENDMARKER, tokenize.INDENT, tokenize.DEDENT}


def _all_normalized_tokens(mod: Module) -> list[tuple[str, int]]:
    """Normalized (token, line) for the whole file, tokenized once per module."""
    cached = mod.__dict__.get("_norm_tokens")
    if cached is not None:
        return cached
    out = []
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(mod.source).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        toks = []
    for tok in toks:
        line = tok.start[0]
        if tok.type in SKIP_TOKENS:
            continue
        if tok.type == tokenize.NAME and not keyword.iskeyword(tok.string):
            out.append(("N", line))
        elif tok.type == tokenize.NUMBER:
            out.append(("0", line))
        elif tok.type == tokenize.STRING:
            out.append(("S", line))
        elif tok.type == tokenize.NEWLINE:
            out.append((";", line))
        else:
            out.append((tok.string, line))
    mod.__dict__["_norm_tokens"] = out
    return out


def _normalized_tokens(mod: Module, start: int, end: int) -> list[tuple[str, int]]:
    """(normalized token, line) for lines start..end. Names -> N, numbers -> 0, strings -> S."""
    all_toks = _all_normalized_tokens(mod)
    lo = bisect.bisect_left(all_toks, start, key=lambda t: t[1])
    hi = bisect.bisect_right(all_toks, end, key=lambda t: t[1])
    return all_toks[lo:hi]


def _logical_lines(mod: Module) -> list[tuple[str, int, int]]:
    """(normalized logical line, first physical line, last physical line), docstrings and imports dropped."""
    toks = _normalized_tokens(mod, 1, len(mod.lines) + 1)
    skip_lines = set()
    for node in ast.walk(mod.tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            skip_lines.update(range(node.lineno, (node.end_lineno or node.lineno) + 1))
        elif isinstance(node, ast.Expr) and id(getattr(node, "value", None)) in mod.docstrings:
            skip_lines.update(range(node.lineno, (node.end_lineno or node.lineno) + 1))
    lines, cur, first, last = [], [], None, None
    for t, ln in toks:
        if first is None:
            first = ln
        last = ln
        if t == ";":
            if cur and first not in skip_lines:
                lines.append((" ".join(cur), first, last))
            cur, first = [], None
        else:
            cur.append(t)
    return lines


def _shingles(tokens: list[str], k: int = 5) -> set[str]:
    return {" ".join(tokens[i:i + k]) for i in range(max(0, len(tokens) - k + 1))}


def check_dry001(mods: list[Module], opts: dict) -> list[Finding]:
    min_lines, min_tokens, containment = opts["min_lines"], opts["min_tokens"], opts["containment"]
    out: list[Finding] = []
    covered: dict[str, set[int]] = defaultdict(set)

    # 1. near-miss functions: the smaller function's shingles mostly appear in another function
    funcs = []
    for mod in mods:
        if mod.is_test:
            continue
        for node in ast.walk(mod.tree):
            if isinstance(node, FUNC) and node.body:
                body_start = node.body[0].lineno
                if id(getattr(node.body[0], "value", None)) in mod.docstrings and len(node.body) > 1:
                    body_start = node.body[1].lineno
                toks = [t for t, _ in _normalized_tokens(mod, body_start, node.end_lineno or node.lineno)]
                if len(toks) >= min_tokens:
                    funcs.append((mod, node, _shingles(toks)))
    index: dict[str, list[int]] = defaultdict(list)
    for i, (_, _, sh) in enumerate(funcs):
        for s in sh:
            index[s].append(i)
    reported = set()
    for i, (mod, node, sh) in enumerate(funcs):
        counts: dict[int, int] = defaultdict(int)
        for s in sh:
            postings = index[s]
            if len(postings) > 50:
                continue  # boilerplate shingle shared by too many functions
            for j in postings:
                if j != i:
                    counts[j] += 1
        for j, shared in counts.items():
            other_mod, other, osh = funcs[j]
            small = min(len(sh), len(osh))
            if small == 0 or shared / small < containment:
                continue
            if len(sh) != len(osh):
                a, b = (i, j) if len(sh) < len(osh) else (j, i)
            else:
                a, b = max(i, j), min(i, j)  # equal size: report the later one
            if (a, b) in reported:
                continue
            reported.add((a, b))
            smod, snode, _ = funcs[a]
            omod, onode, _ = funcs[b]
            pct = round(100 * shared / small)
            covered[smod.rel].update(range(snode.lineno, (snode.end_lineno or snode.lineno) + 1))
            covered[omod.rel].update(range(onode.lineno, (onode.end_lineno or onode.lineno) + 1))
            out.append(smod.finding("DRY001", snode, f"'{snode.name}' repeats {pct}% of '{onode.name}' ({omod.rel}:{onode.lineno}); extract the shared logic.",
                                    end_line=snode.end_lineno, related=[{"path": omod.rel, "line": onode.lineno}]))

    # 2. exact (normalized) blocks of min_lines logical lines
    windows: dict[str, list[tuple[Module, int, int]]] = defaultdict(list)
    for mod in mods:
        if mod.is_test:
            continue
        ll = _logical_lines(mod)
        for i in range(len(ll) - min_lines + 1):
            chunk = ll[i:i + min_lines]
            body = "\n".join(c[0] for c in chunk)
            if sum(len(c[0].split()) for c in chunk) < min_tokens // 2:
                continue  # too little substance to call duplication
            h = hashlib.sha1(body.encode()).hexdigest()
            windows[h].append((mod, chunk[0][1], chunk[-1][2]))
    for locs in windows.values():
        if len(locs) < 2:
            continue
        first = locs[0]
        for mod, start, end in locs[1:]:
            if mod is first[0] and start <= first[2]:
                continue  # overlapping window in the same file
            if any(ln in covered[mod.rel] for ln in range(start, end + 1)) or any(ln in covered[first[0].rel] for ln in range(first[1], first[2] + 1)):
                continue
            covered[mod.rel].update(range(start, end + 1))
            out.append(mod.finding("DRY001", start, f"Lines {start}-{end} duplicate {first[0].rel}:{first[1]}-{first[2]}.", end_line=end,
                                   related=[{"path": first[0].rel, "line": first[1]}]))

    return out


# --- ARCH002 -----------------------------------------------------------------


def module_name(mod: Module) -> str:
    """Dotted name by walking up through packages that have __init__.py."""
    path = mod.path
    parts = [] if path.name == "__init__.py" else [path.stem]
    d = path.parent
    while (d / "__init__.py").exists() and d != d.parent:
        parts.insert(0, d.name)
        if d == mod.root:
            break
        d = d.parent
    return ".".join(parts) if parts else path.stem


def _type_checking_nodes(mod: Module) -> set[int]:
    ids = set()
    for node in ast.walk(mod.tree):
        if isinstance(node, ast.If):
            t = node.test
            name = t.id if isinstance(t, ast.Name) else t.attr if isinstance(t, ast.Attribute) else ""
            if name == "TYPE_CHECKING":
                for n in ast.walk(node):
                    ids.add(id(n))
    return ids


def _module_level_imports(mod: Module):
    skip = _type_checking_nodes(mod)
    for node in ast.walk(mod.tree):
        if id(node) in skip or not isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        if mod.enclosing(node, FUNC + (ast.ClassDef,)) is not None:
            continue
        yield node


def _resolve(mod_name: str, is_pkg: bool, node: ast.AST, known: set[str]) -> list[str]:
    targets = []
    if isinstance(node, ast.Import):
        for a in node.names:
            targets.append(a.name)
    else:
        if node.level:
            base_parts = mod_name.split(".")
            if not is_pkg:
                base_parts = base_parts[:-1]
            base_parts = base_parts[: len(base_parts) - (node.level - 1)] if node.level > 1 else base_parts
            base = ".".join(base_parts + ([node.module] if node.module else []))
        else:
            base = node.module or ""
        for a in node.names:
            cand = f"{base}.{a.name}" if base else a.name
            targets.append(cand if cand in known else base)
    resolved = []
    for t in targets:
        while t and t not in known:
            t = t.rpartition(".")[0]
        if t:
            resolved.append(t)
    return resolved


def _sccs(graph: dict[str, set[str]]) -> list[list[str]]:
    index, low, stack, on, out, counter = {}, {}, [], set(), [], [0]

    def strong(v):
        index[v] = low[v] = counter[0]
        counter[0] += 1
        stack.append(v)
        on.add(v)
        for w in sorted(graph.get(v, ())):
            if w not in index:
                strong(w)
                low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            comp = []
            while True:
                w = stack.pop()
                on.discard(w)
                comp.append(w)
                if w == v:
                    break
            if len(comp) > 1:
                out.append(sorted(comp))

    import sys
    old = sys.getrecursionlimit()
    sys.setrecursionlimit(max(old, 10000))
    try:
        for v in sorted(graph):
            if v not in index:
                strong(v)
    finally:
        sys.setrecursionlimit(old)
    return out


def check_arch002(mods: list[Module], opts: dict) -> list[Finding]:
    by_name = {module_name(m): m for m in mods}
    known = set(by_name)
    graph: dict[str, set[str]] = defaultdict(set)
    edge_line: dict[tuple[str, str], int] = {}
    for name, mod in by_name.items():
        is_pkg = mod.path.name == "__init__.py"
        for node in _module_level_imports(mod):
            for target in _resolve(name, is_pkg, node, known):
                if target != name:
                    graph[name].add(target)
                    edge_line.setdefault((name, target), node.lineno)
    out = []
    for comp in _sccs(graph):
        members = set(comp)
        head = comp[0]
        nxt = sorted(t for t in graph[head] if t in members)[0]
        mod = by_name[head]
        cycle = " -> ".join(comp + [comp[0]]) if len(comp) <= 6 else f"{len(comp)} modules"
        out.append(mod.finding("ARCH002", edge_line[(head, nxt)], f"Import cycle: {cycle}.",
                               related=[{"path": by_name[n].rel, "line": 1} for n in comp[1:]]))
    return out


# --- OO002 -------------------------------------------------------------------

EXC_SUFFIX = ("Error", "Exception", "Warning", "Exit", "Interrupt")


def check_oo002(mods: list[Module], opts: dict) -> list[Finding]:
    limit = opts["max_depth"]
    classes: dict[str, list[tuple[Module, ast.ClassDef]]] = defaultdict(list)
    for mod in mods:
        for node in ast.walk(mod.tree):
            if isinstance(node, ast.ClassDef):
                classes[node.name].append((mod, node))

    def base_names(node):
        for b in node.bases:
            if isinstance(b, ast.Name):
                yield b.id
            elif isinstance(b, ast.Attribute):
                yield b.attr
            elif isinstance(b, ast.Subscript) and isinstance(b.value, ast.Name):
                yield b.value.id  # Generic[T] style

    memo: dict[int, list[str]] = {}

    def chain(mod, node, seen):
        key = id(node)
        if key in memo:
            return memo[key]
        best: list[str] = []
        for b in base_names(node):
            cands = classes.get(b, [])
            same = [c for c in cands if c[0] is mod]
            pick = same[0] if same else (cands[0] if len(cands) == 1 else None)
            if pick is None or id(pick[1]) in seen:
                continue
            sub = [b] + chain(pick[0], pick[1], seen | {key})
            if len(sub) > len(best):
                best = sub
        memo[key] = best
        return best

    out = []
    for name, defs in classes.items():
        for mod, node in defs:
            ancestors = chain(mod, node, set())
            if len(ancestors) <= limit:
                continue
            if node.name.endswith(EXC_SUFFIX) or any(a.endswith(EXC_SUFFIX) for a in ancestors):
                continue
            out.append(mod.finding("OO002", node, f"'{node.name}' inherits through {len(ancestors)} in-repo classes ({' -> '.join(ancestors)}); prefer composition or interfaces.", end_line=node.lineno))
    return out


REPO_CHECKS = {
    "DRY001": check_dry001,
    "ARCH002": check_arch002,
    "OO002": check_oo002,
}
