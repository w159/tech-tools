"""Per-file rules. Each check takes (module, options) and returns findings."""

from __future__ import annotations

import ast
import re

from .core import Finding, Module

FUNC = (ast.FunctionDef, ast.AsyncFunctionDef)
BLOCKS = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.With, ast.AsyncWith, ast.Try)
if hasattr(ast, "TryStar"):
    BLOCKS = BLOCKS + (ast.TryStar,)
if hasattr(ast, "Match"):
    BLOCKS = BLOCKS + (ast.Match,)


def _functions(mod: Module):
    for node in ast.walk(mod.tree):
        if isinstance(node, FUNC):
            yield node


def _own_nodes(func: ast.AST):
    """Walk a function body without descending into nested defs, lambdas or classes."""
    stack = list(ast.iter_child_nodes(func))
    while stack:
        node = stack.pop()
        yield node
        if isinstance(node, FUNC + (ast.ClassDef, ast.Lambda)):
            continue
        stack.extend(ast.iter_child_nodes(node))


def _is_method(mod: Module, func: ast.AST) -> bool:
    return isinstance(mod.parents.get(func), ast.ClassDef)


def _decorator_names(func: ast.AST) -> set[str]:
    names = set()
    for d in func.decorator_list:
        target = d.func if isinstance(d, ast.Call) else d
        if isinstance(target, ast.Name):
            names.add(target.id)
        elif isinstance(target, ast.Attribute):
            names.add(target.attr)
    return names


def _params(mod: Module, func: ast.AST) -> list[ast.arg]:
    a = func.args
    params = list(getattr(a, "posonlyargs", [])) + list(a.args) + list(a.kwonlyargs)
    if params and _is_method(mod, func) and "staticmethod" not in _decorator_names(func):
        if params[0].arg in ("self", "cls", "mcs", "metacls"):
            params = params[1:]
    return params


# --- FN001 -------------------------------------------------------------------


def check_fn001(mod: Module, opts: dict) -> list[Finding]:
    limit = opts["max_statements"]
    out = []
    for func in _functions(mod):
        count = sum(1 for n in _own_nodes(func) if isinstance(n, ast.stmt) and not isinstance(n, FUNC + (ast.ClassDef,)))
        if count > limit:
            out.append(mod.finding("FN001", func, f"'{func.name}' has {count} statements (limit {limit}).", end_line=func.lineno))
    return out


# --- FN002 -------------------------------------------------------------------


def _is_pytest_injected(mod: Module, func: ast.AST) -> bool:
    """Test functions and fixtures take their parameters from pytest's injection, not from callers."""
    if func.name.startswith("test_"):
        return True
    for dec in func.decorator_list:
        target = dec.func if isinstance(dec, ast.Call) else dec
        name = mod.dotted(target) or ""
        if name == "fixture" or name.endswith(".fixture"):
            return True
    return False


def check_fn002(mod: Module, opts: dict) -> list[Finding]:
    limit = opts["max_params"]
    out = []
    for func in _functions(mod):
        if mod.is_test and _is_pytest_injected(mod, func):
            continue
        params = _params(mod, func)
        if len(params) > limit:
            out.append(mod.finding("FN002", func, f"'{func.name}' takes {len(params)} parameters (limit {limit}).", end_line=func.lineno))
    return out


# --- FN003 -------------------------------------------------------------------


def _bool_params(func: ast.AST) -> set[str]:
    a = func.args
    names = set()
    positional = list(getattr(a, "posonlyargs", [])) + list(a.args)
    defaults = [None] * (len(positional) - len(a.defaults)) + list(a.defaults)
    pairs = list(zip(positional, defaults)) + list(zip(a.kwonlyargs, a.kw_defaults))
    for arg, default in pairs:
        ann_bool = isinstance(arg.annotation, ast.Name) and arg.annotation.id == "bool"
        default_bool = isinstance(default, ast.Constant) and isinstance(default.value, bool)
        if ann_bool or default_bool:
            names.add(arg.arg)
    return names


def check_fn003(mod: Module, opts: dict) -> list[Finding]:
    out = []
    for func in _functions(mod):
        flags = _bool_params(func)
        if not flags:
            continue
        tested = set()
        for node in _own_nodes(func):
            if isinstance(node, (ast.If, ast.IfExp)):
                test = node.test
                if isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not):
                    test = test.operand
                if isinstance(test, ast.Name) and test.id in flags:
                    tested.add(test.id)
        for name in sorted(tested):
            out.append(mod.finding("FN003", func, f"'{func.name}' branches on bool parameter '{name}'; split it into two functions.", end_line=func.lineno))
    return out


# --- FN004 -------------------------------------------------------------------


def _first_too_deep(mod: Module, func: ast.AST, limit: int):
    """First block (source order) nested deeper than limit, or None. Iterative: expression chains can be thousands deep."""
    stack = [(func, 0)]
    while stack:
        node, depth = stack.pop()
        d = depth
        if node is not func and isinstance(node, BLOCKS):
            parent = mod.parents.get(node)
            is_elif = isinstance(node, ast.If) and isinstance(parent, ast.If) and parent.orelse == [node]
            d = depth if is_elif else depth + 1
            if d > limit:
                return node, d
        for child in reversed(list(ast.iter_child_nodes(node))):
            if not isinstance(child, FUNC + (ast.ClassDef, ast.Lambda)):
                stack.append((child, d))
    return None


def check_fn004(mod: Module, opts: dict) -> list[Finding]:
    limit = opts["max_depth"]
    out = []
    for func in _functions(mod):
        hit = _first_too_deep(mod, func, limit)
        if hit:
            node, d = hit
            out.append(mod.finding("FN004", node, f"'{func.name}' nests {d} blocks deep here (limit {limit}).", end_line=node.lineno))
    return out


# --- FN005 -------------------------------------------------------------------


def complexity(func: ast.AST) -> int:
    score = 1
    for node in _own_nodes(func):
        if isinstance(node, (ast.If, ast.IfExp, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler)):
            score += 1
        elif isinstance(node, ast.BoolOp):
            score += len(node.values) - 1
        elif isinstance(node, ast.comprehension):
            score += 1 + len(node.ifs)
        elif hasattr(ast, "match_case") and isinstance(node, ast.match_case):
            score += 1
    return score


def check_fn005(mod: Module, opts: dict) -> list[Finding]:
    limit = opts["max_complexity"]
    out = []
    for func in _functions(mod):
        c = complexity(func)
        if c > limit:
            out.append(mod.finding("FN005", func, f"'{func.name}' has cyclomatic complexity {c} (limit {limit}).", end_line=func.lineno))
    return out


# --- ERR001 ------------------------------------------------------------------

LOG_METHODS = {"exception", "error", "warning", "warn", "critical", "log", "fatal", "print_exc", "print_exception"}
BROAD = {"Exception", "BaseException"}


def _handler_types(h: ast.ExceptHandler) -> list[str]:
    t = h.type
    elts = t.elts if isinstance(t, ast.Tuple) else [t]
    return [e.id if isinstance(e, ast.Name) else (e.attr if isinstance(e, ast.Attribute) else "") for e in elts]


REPORT_METHODS = {"debug", "info", "warn", "warning", "error", "exception", "critical", "fatal"}
NUMERIC_RECEIVERS = {"math", "cmath", "np", "numpy", "scipy", "torch", "jnp", "tf"}


def _logger_like(recv: ast.AST) -> bool:
    """Receiver of an ambiguous method (.log, .print_exc): logger / self.audit_log / logging.getLogger(...) / traceback."""
    if isinstance(recv, ast.Call):
        recv = recv.func
    name = recv.id if isinstance(recv, ast.Name) else recv.attr if isinstance(recv, ast.Attribute) else ""
    tokens = set(re.split(r"_+", re.sub(r"(?<=[a-z])(?=[A-Z])", "_", name).lower()))
    return bool(tokens & {"log", "logger", "logging", "getlogger", "traceback", "warnings"}) or name.lower().endswith("getlogger")


def _handles_call(f: ast.Attribute) -> bool:
    """Reporting methods count on any receiver (hc.warn, console.error); .log and print_exc need a logger-like one."""
    if f.attr in REPORT_METHODS:
        return True
    if f.attr in LOG_METHODS:
        base = f.value
        if isinstance(base, ast.Name) and base.id in NUMERIC_RECEIVERS:
            return False
        return _logger_like(base)
    return False


def _reraises_or_logs(h: ast.ExceptHandler) -> bool:
    for node in ast.walk(ast.Module(body=h.body, type_ignores=[])):
        if isinstance(node, ast.Raise):
            return True
        if isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Attribute) and _handles_call(f):
                return True
            if isinstance(f, ast.Name) and f.id in ("print",) and h.name:
                return True
    return False


ERR001_SWALLOWED = "Broad 'except Exception' neither re-raises nor logs; the failure disappears."
ERR001_FALLBACK = "Broad 'except Exception' turns every failure, including bugs, into a fallback; catch the specific exception you expect."


def _only_discards(h: ast.ExceptHandler) -> bool:
    """True when the handler body does nothing but pass / ... / continue / break."""
    for stmt in h.body:
        if isinstance(stmt, (ast.Pass, ast.Continue, ast.Break)):
            continue
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and stmt.value.value is Ellipsis:
            continue
        return False
    return True


def _in_del(mod: Module, node: ast.AST) -> bool:
    """Python ignores exceptions raised in __del__, so swallowing there is the accepted idiom."""
    cur = mod.parents.get(node)
    while cur is not None:
        if isinstance(cur, FUNC):
            return cur.name == "__del__"
        cur = mod.parents.get(cur)
    return False


def check_err001(mod: Module, opts: dict) -> list[Finding]:
    out = []
    for node in ast.walk(mod.tree):
        if not isinstance(node, ast.ExceptHandler):
            continue
        if _in_del(mod, node):
            continue
        if node.type is None:
            if not any(isinstance(n, ast.Raise) for n in ast.walk(ast.Module(body=node.body, type_ignores=[]))):
                out.append(mod.finding("ERR001", node, "Bare 'except:' catches everything, including KeyboardInterrupt and SystemExit, and does not re-raise.", end_line=node.lineno))
            continue
        if set(_handler_types(node)) & BROAD and not _reraises_or_logs(node):
            out.append(mod.finding("ERR001", node, ERR001_SWALLOWED if _only_discards(node) else ERR001_FALLBACK, end_line=node.lineno))
    return out


# --- DEM001 ------------------------------------------------------------------


def _chain(mod: Module, node: ast.AST) -> tuple[int, ast.AST]:
    links = 0
    while True:
        if isinstance(node, ast.Attribute):
            links += 1
            node = node.value
        elif isinstance(node, ast.Call):
            node = node.func
        elif isinstance(node, ast.Subscript):
            node = node.value
        else:
            return links, node


def _is_chain_top(mod: Module, node: ast.AST) -> bool:
    parent = mod.parents.get(node)
    if isinstance(parent, ast.Attribute) and parent.value is node:
        return False
    if isinstance(parent, ast.Call) and parent.func is node:
        return _is_chain_top(mod, parent)
    if isinstance(parent, ast.Subscript) and parent.value is node:
        return _is_chain_top(mod, parent)
    return True


def check_dem001(mod: Module, opts: dict) -> list[Finding]:
    limit = opts["max_links"]
    out, seen = [], set()
    for node in ast.walk(mod.tree):
        if not isinstance(node, ast.Attribute) or not _is_chain_top(mod, node):
            continue
        links, root = _chain(mod, node)
        if isinstance(root, ast.Name):
            if root.id in mod.imports:
                continue  # module path, not object navigation
            if root.id in ("self", "cls"):
                links -= 1
        elif isinstance(root, ast.Constant):
            continue  # "sep".join(...)
        if links > limit and node.lineno not in seen:
            seen.add(node.lineno)
            text = ast.unparse(node) if hasattr(ast, "unparse") else "chain"
            out.append(mod.finding("DEM001", node, f"'{text}' navigates {links} links through other objects (limit {limit}).", end_line=node.lineno))
    return out


# --- STATE001 ----------------------------------------------------------------

MUTATORS = {"append", "extend", "insert", "remove", "pop", "popitem", "clear", "update", "setdefault", "add", "discard", "sort", "reverse"}


def _module_mutables(mod: Module) -> dict[str, int]:
    names = {}
    for stmt in mod.tree.body:
        targets, value = [], None
        if isinstance(stmt, ast.Assign):
            targets, value = stmt.targets, stmt.value
        elif isinstance(stmt, ast.AnnAssign) and stmt.value is not None:
            targets, value = [stmt.target], stmt.value
        mutable = isinstance(value, (ast.Dict, ast.List, ast.Set)) or (
            isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id in ("dict", "list", "set", "defaultdict", "OrderedDict", "deque")
        )
        if not mutable:
            continue
        for t in targets:
            if isinstance(t, ast.Name) and not t.id.startswith("__"):
                names[t.id] = stmt.lineno
    return names


def check_state001(mod: Module, opts: dict) -> list[Finding]:
    out = []
    mutables = _module_mutables(mod)
    for func in _functions(mod):
        fa = func.args
        local = {a.arg for a in fa.posonlyargs + fa.args + fa.kwonlyargs}
        local |= {a.arg for a in (fa.vararg, fa.kwarg) if a is not None}
        declared_global = {n for g in _own_nodes(func) if isinstance(g, ast.Global) for n in g.names}
        local |= {n.id for n in _own_nodes(func) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)} - declared_global
        reported = set()
        for node in _own_nodes(func):
            if isinstance(node, ast.Global):
                out.append(mod.finding("STATE001", node, f"'global {', '.join(node.names)}' in '{func.name}' rebinds module state from inside a function.", end_line=node.lineno))
                continue
            name = None
            if isinstance(node, (ast.Assign, ast.AugAssign, ast.Delete)):
                targets = node.targets if isinstance(node, (ast.Assign, ast.Delete)) else [node.target]
                for t in targets:
                    if isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name):
                        name = t.value.id
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in MUTATORS and isinstance(node.func.value, ast.Name):
                name = node.func.value.id
            if name and name in mutables and name not in local and name not in reported:
                reported.add(name)
                out.append(mod.finding("STATE001", node, f"'{func.name}' mutates module-level '{name}' (defined line {mutables[name]}); pass state in or wrap it in an object.", end_line=node.lineno))
    return out


# --- RES001 ------------------------------------------------------------------

RESOURCE_CALLS = {
    "open", "io.open", "codecs.open", "sqlite3.connect", "socket.socket", "socket.create_connection",
    "urllib.request.urlopen", "zipfile.ZipFile", "tarfile.open", "tempfile.TemporaryFile",
    "tempfile.NamedTemporaryFile", "psycopg2.connect", "pymysql.connect", "gzip.open", "bz2.open", "lzma.open",
}


MANAGING_CALLS = {"closing", "aclosing", "enter_context", "enter_async_context", "callback", "push"}


def _bound_names(mod: Module, node: ast.AST) -> set[str]:
    """Names the acquired resource is bound to (f = open(..), f: T = open(..), (f := open(..)))."""
    parent = mod.parents.get(node)
    if isinstance(parent, ast.Assign):
        targets = parent.targets
    elif isinstance(parent, (ast.AnnAssign, ast.NamedExpr)):
        targets = [parent.target]
    else:
        return set()
    return {t.id for t in targets if isinstance(t, ast.Name)}


def _released_in_finally(mod: Module, node: ast.AST) -> bool:
    cur = mod.parents.get(node)
    while cur is not None and not isinstance(cur, FUNC):
        if isinstance(cur, ast.Try) and cur.finalbody:
            return True
        cur = mod.parents.get(cur)
    func = mod.enclosing(node, FUNC)
    if func is None:
        return False
    # acquired then released by a later try/finally in the same function; close() must be called on the bound name
    bound = _bound_names(mod, node)
    for n in _own_nodes(func):
        if isinstance(n, ast.Try) and n.finalbody and n.lineno > node.lineno:
            for m in ast.walk(ast.Module(body=n.finalbody, type_ignores=[])):
                if isinstance(m, ast.Call) and isinstance(m.func, ast.Attribute) and m.func.attr == "close" \
                        and isinstance(m.func.value, ast.Name) and m.func.value.id in bound:
                    return True
    return False


def check_res001(mod: Module, opts: dict) -> list[Finding]:
    out = []
    for node in ast.walk(mod.tree):
        if not isinstance(node, ast.Call):
            continue
        name = mod.dotted(node.func)
        if name not in RESOURCE_CALLS:
            continue
        parent = mod.parents.get(node)
        if isinstance(parent, ast.withitem):
            continue
        if isinstance(parent, ast.Call) and node in parent.args:  # closing(open(...)), ExitStack.enter_context(open(...))
            wrapper = (mod.dotted(parent.func) or "").rsplit(".", 1)[-1]
            if wrapper in MANAGING_CALLS:
                continue
        if isinstance(parent, ast.Attribute) and parent.value is node and parent.attr == "close" \
                and isinstance(mod.parents.get(parent), ast.Call):
            continue  # open(...).close(): released in the same expression
        if isinstance(parent, (ast.Return, ast.Yield)):
            continue  # factory hands ownership to the caller
        if isinstance(parent, (ast.Assign, ast.AnnAssign)):
            targets = parent.targets if isinstance(parent, ast.Assign) else [parent.target]
            if any(isinstance(t, ast.Attribute) for t in targets):
                continue  # owned by an object; released by its close()
        if _released_in_finally(mod, node):
            continue
        out.append(mod.finding("RES001", node, f"'{name}()' is acquired without a with block or try/finally to release it.", end_line=node.lineno))
    return out


# --- SEC001 ------------------------------------------------------------------

SQL_SINKS = {"execute", "executemany", "executescript", "raw", "mogrify"}


SQL_WORD = re.compile(r"(?i)\b(select|insert|update|delete|where|from|drop|alter|create|union|pragma|exec|execute|with|merge|replace|truncate)\b")


SQL_START = re.compile(r"(?i)\s*(select|insert|update|delete|where|from|drop|alter|create|union|pragma|exec|execute|with|merge|replace|truncate)\b")
SQL_STRUCTURE = re.compile(r"(?is)\bselect\b.*\bfrom\b|\binsert\s+into\b|\bupdate\b.*\bset\b|\bdelete\s+from\b")


def _segments(expr: ast.AST) -> list[str]:
    """Constant string fragments of an expression, in source order."""
    nodes = [n for n in ast.walk(expr) if isinstance(n, ast.Constant) and isinstance(n.value, str)]
    nodes.sort(key=lambda n: (getattr(n, "lineno", 0), getattr(n, "col_offset", 0)))
    return [n.value for n in nodes]


def _sql_like(segments: list[str]) -> bool:
    """A SQL keyword counts when it begins a fragment or the text has SQL structure; prose like 'create a backup of' does not."""
    return any(SQL_START.match(seg) for seg in segments) or bool(SQL_STRUCTURE.search(" ".join(segments)))


def _tainted(expr: ast.AST) -> bool:
    return _formatted(expr) and _sql_like(_segments(expr))


def _concat_tainted(parts: list[ast.AST]) -> bool:
    """Query text built from a base assignment plus later `+=` pieces, at least one of them dynamic."""
    dynamic = any(_formatted(p) or any(not isinstance(n, ast.Constant) for n in ast.walk(p)) for p in parts)
    return dynamic and _sql_like([seg for p in parts for seg in _segments(p)])


def _formatted(expr: ast.AST) -> bool:
    if isinstance(expr, ast.JoinedStr):
        return any(isinstance(v, ast.FormattedValue) for v in expr.values)
    if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Mod):
        return isinstance(expr.left, (ast.Constant, ast.JoinedStr)) and not isinstance(getattr(expr.left, "value", ""), (int, float))
    if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Add):
        sides = (expr.left, expr.right)
        has_str = any(isinstance(s, ast.Constant) and isinstance(s.value, str) for s in sides) or any(_formatted(s) for s in sides)
        has_dyn = any(not isinstance(s, ast.Constant) for s in sides)
        return has_str and has_dyn
    if isinstance(expr, ast.Call) and isinstance(expr.func, ast.Attribute) and expr.func.attr == "format":
        return isinstance(expr.func.value, ast.Constant) and isinstance(expr.func.value.value, str)
    return False


def check_sec001(mod: Module, opts: dict) -> list[Finding]:
    out = []
    for node in ast.walk(mod.tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in SQL_SINKS and node.args):
            continue
        arg = node.args[0]
        if _tainted(arg):
            out.append(mod.finding("SEC001", node, f"Query passed to '{node.func.attr}()' is built by string formatting; use bound parameters.", end_line=node.lineno))
            continue
        if isinstance(arg, ast.Name):
            func = mod.enclosing(node, FUNC)
            scope = _own_nodes(func) if func else ast.walk(mod.tree)
            scope = list(scope)
            assigns = [n for n in scope if isinstance(n, ast.Assign) and n.lineno < node.lineno and any(isinstance(t, ast.Name) and t.id == arg.id for t in n.targets)]
            src = max(assigns, key=lambda n: n.lineno) if assigns else None
            augs = [n for n in scope if isinstance(n, ast.AugAssign) and isinstance(n.op, ast.Add) and isinstance(n.target, ast.Name)
                    and n.target.id == arg.id and n.lineno < node.lineno and (src is None or n.lineno > src.lineno)]
            augs.sort(key=lambda n: n.lineno)
            if src is not None and _tainted(src.value):
                out.append(mod.finding("SEC001", node, f"'{arg.id}' (built by string formatting on line {src.lineno}) is passed to '{node.func.attr}()'; use bound parameters.", end_line=node.lineno))
            elif augs and _concat_tainted(([src.value] if src is not None else []) + [a.value for a in augs]):
                first = src or augs[0]
                out.append(mod.finding("SEC001", node, f"'{arg.id}' (built by string concatenation from line {first.lineno}) is passed to '{node.func.attr}()'; use bound parameters.", end_line=node.lineno))
    return out


# --- SEC002 ------------------------------------------------------------------

SECRET_NAME = re.compile(r"(?i)(passw(or)?d|passwd|secret|api_?key|access_?key|private_?key|auth_?token|token|credential)")
NOT_SECRET_NAME = re.compile(r"(?i)(_url|_uri|_path|_file|_dir|_name|_type|_field|_header|_env|_var|_prefix|_suffix|_len|_length|_regex|_re|_pattern|_endpoint|_id_key)$")
SECRET_FORMATS = [
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}"),
    re.compile(r"xox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"sk_live_[A-Za-z0-9]{16,}"),
    re.compile(r"-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
]


# the secret noun must end the name (db_password, API_TOKEN, secret_key), not modify it (secret_mode)
SECRET_SUFFIX = re.compile(r"(?i)(passw(or)?d|passwd|secret|api_?key|access_?key|private_?key|auth_?token|token|credential)s?(_?(key|value))?\d*$")


def _looks_like_secret_value(v: str) -> bool:
    if len(v) < 8 or " " in v or v.startswith(("http://", "https://", "/", "$", "%")):
        return False
    if "{" in v:  # templates
        return False
    if re.fullmatch(r"[A-Z0-9_]+", v):  # env var names (DB_PASSWORD); long underscore-free letter+digit runs are keys
        if not (len(v) >= 16 and "_" not in v and re.search(r"[A-Z]", v) and re.search(r"\d", v)):
            return False
    if len(set(v)) <= 2:  # "********", "xxxxxxxx"
        return False
    return True


def _unpack_pairs(target: ast.AST, value: ast.AST) -> list[tuple[ast.AST, ast.AST]]:
    """`a, b = x, y` -> [(a, x), (b, y)]; plain targets pass through."""
    if isinstance(target, (ast.Tuple, ast.List)) and isinstance(value, (ast.Tuple, ast.List)) \
            and len(target.elts) == len(value.elts) and not any(isinstance(e, ast.Starred) for e in target.elts + value.elts):
        return [p for t, v in zip(target.elts, value.elts) for p in _unpack_pairs(t, v)]
    return [(target, value)]


def check_sec002(mod: Module, opts: dict) -> list[Finding]:
    out, seen = [], set()

    def add(node, msg):
        if node.lineno not in seen:
            seen.add(node.lineno)
            out.append(mod.finding("SEC002", node, msg, end_line=node.lineno))

    for node in ast.walk(mod.tree):
        pairs = []
        if isinstance(node, ast.Assign):
            for t in node.targets:
                pairs.extend(_unpack_pairs(t, node.value))
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            pairs = [(node.target, node.value)]
        elif isinstance(node, ast.NamedExpr):
            pairs = [(node.target, node.value)]
        elif isinstance(node, ast.keyword) and node.arg:
            pairs = [(ast.Name(id=node.arg), node.value)]
        elif isinstance(node, ast.Dict):
            pairs = [(k, v) for k, v in zip(node.keys, node.values) if isinstance(k, ast.Constant) and isinstance(k.value, str)]
        for target, value in pairs:
            name = target.id if isinstance(target, ast.Name) else target.attr if isinstance(target, ast.Attribute) else target.value if isinstance(target, ast.Constant) else ""
            if not isinstance(value, ast.Constant) or not isinstance(value.value, str):
                continue
            if SECRET_SUFFIX.search(name) and not NOT_SECRET_NAME.search(name) and _looks_like_secret_value(value.value):
                add(value, f"Literal assigned to secret-like name '{name}'; load it from the environment or a secret store.")
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in mod.docstrings:
            if any(p.search(node.value) for p in SECRET_FORMATS):
                add(node, "String matches a known credential format (cloud key, token or private key).")
    return out


# --- CFG001 ------------------------------------------------------------------

URL_RE = re.compile(r"(?:https?|wss?|ftp)://[^\s'\"<>]+")


def check_cfg001(mod: Module, opts: dict) -> list[Finding]:
    if mod.is_config_module:
        return []
    out = []
    for node in ast.walk(mod.tree):
        if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
            continue
        if id(node) in mod.docstrings or not URL_RE.fullmatch(node.value.strip()):
            continue
        parent = mod.parents.get(node)
        if isinstance(parent, ast.Assign) and any(isinstance(t, ast.Name) and t.id.startswith("__") for t in parent.targets):
            continue  # __url__ metadata
        if isinstance(parent, ast.keyword) and parent.arg in ("help", "description", "epilog", "homepage"):
            continue
        out.append(mod.finding("CFG001", node, f"Hardcoded endpoint '{node.value[:60]}'; read it from configuration or the environment.", end_line=node.lineno))
    return out


# --- ARCH001 -----------------------------------------------------------------


def check_arch001(mod: Module, opts: dict) -> list[Finding]:
    dirs = mod.rel.split("/")[:-1]
    inner = set(opts["inner_dirs"]) & set(dirs)
    if not inner:
        return []
    outer = set(opts["outer_dirs"])
    io_mods = opts["io_modules"]
    out = []
    for node in ast.walk(mod.tree):
        names = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            names = [base] if node.level == 0 else [("." * node.level) + base]
        for name in names:
            parts = name.lstrip(".").split(".")
            io_hit = next((m for m in io_mods if name == m or name.startswith(m + ".")), None)
            layer_hit = next((p for p in parts if p in outer), None)
            if io_hit or layer_hit:
                what = f"I/O library '{io_hit}'" if io_hit else f"outer layer '{layer_hit}'"
                out.append(mod.finding("ARCH001", node, f"Inner-layer module ({'/'.join(sorted(inner))}) imports {what}; depend on an interface instead.", end_line=node.lineno))
    return out


# --- OO001 -------------------------------------------------------------------


def check_oo001(mod: Module, opts: dict) -> list[Finding]:
    out = []
    for node in ast.walk(mod.tree):
        if not isinstance(node, ast.ClassDef):
            continue
        methods = sum(1 for n in node.body if isinstance(n, FUNC))
        lines = (node.end_lineno or node.lineno) - node.lineno + 1
        if methods > opts["max_methods"] or lines > opts["max_lines"]:
            out.append(mod.finding("OO001", node, f"Class '{node.name}' has {methods} methods and {lines} lines (limits {opts['max_methods']} methods, {opts['max_lines']} lines).", end_line=node.lineno))
    return out


# --- CQS001 ------------------------------------------------------------------

QUERY_PREFIX = re.compile(r"^_*(get|is|has|can|should)_")


def _is_self_attr(n: ast.AST, attr: str) -> bool:
    return isinstance(n, ast.Attribute) and n.attr == attr and isinstance(n.value, ast.Name) and n.value.id == "self"


def _unset_check(test: ast.AST, attr: str) -> bool:
    """True for tests that ask whether self.attr is not yet set: `is None`, `not x`, `not hasattr`, `k not in x`."""
    if isinstance(test, ast.BoolOp):
        return any(_unset_check(v, attr) for v in test.values)
    if isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not):
        v = test.operand
        if _is_self_attr(v, attr):
            return True
        return isinstance(v, ast.Call) and isinstance(v.func, ast.Name) and v.func.id == "hasattr" \
            and any(isinstance(a, ast.Constant) and a.value == attr for a in v.args)
    if isinstance(test, ast.Compare) and len(test.ops) == 1:
        op, left, right = test.ops[0], test.left, test.comparators[0]
        if isinstance(op, (ast.Is, ast.Eq)) and _is_self_attr(left, attr):
            return isinstance(right, ast.Constant) and right.value is None
        if isinstance(op, ast.NotIn):
            return _is_self_attr(right, attr)
    return False


def _guarded_lazy_init(mod: Module, node: ast.AST, attr: str) -> bool:
    if isinstance(node, ast.AugAssign):
        return False  # a counter update is never lazy initialisation
    cur = mod.parents.get(node)
    while cur is not None and not isinstance(cur, FUNC):
        if isinstance(cur, ast.If) and _unset_check(cur.test, attr):
            return True
        cur = mod.parents.get(cur)
    return False


def check_cqs001(mod: Module, opts: dict) -> list[Finding]:
    out = []
    for func in _functions(mod):
        if not _is_method(mod, func) or not QUERY_PREFIX.match(func.name):
            continue
        for node in _own_nodes(func):
            attr = None
            if isinstance(node, (ast.Assign, ast.AugAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for t in targets:
                    base = t.value if isinstance(t, ast.Subscript) else t
                    if isinstance(base, ast.Attribute) and isinstance(base.value, ast.Name) and base.value.id == "self":
                        attr = base.attr
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in MUTATORS:
                v = node.func.value
                if isinstance(v, ast.Attribute) and isinstance(v.value, ast.Name) and v.value.id == "self":
                    attr = v.attr
            if attr and not _guarded_lazy_init(mod, node, attr):
                out.append(mod.finding("CQS001", node, f"Query method '{func.name}' changes 'self.{attr}'; separate the command from the query.", end_line=node.lineno))
                break
    return out


# --- LIT001 ------------------------------------------------------------------


def _const_expr(node: ast.AST) -> bool:
    """Arithmetic over literals only (60 * 60); one name in it makes it a real computation."""
    stack = [node]
    while stack:
        n = stack.pop()
        if isinstance(n, ast.BinOp):
            stack += [n.left, n.right]
        elif isinstance(n, ast.UnaryOp):
            stack.append(n.operand)
        elif not isinstance(n, ast.Constant):
            return False
    return True


def check_lit001(mod: Module, opts: dict) -> list[Finding]:
    allowed = set(opts["allowed"])
    out, seen = [], set()
    for node in ast.walk(mod.tree):
        if not (isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool)):
            continue
        value = node.value
        parent = mod.parents.get(node)
        if isinstance(parent, ast.UnaryOp) and isinstance(parent.op, ast.USub):
            value, node_for_parent = -value, parent
        else:
            node_for_parent = node
        if value in allowed:
            continue
        child, p = node_for_parent, mod.parents.get(node_for_parent)
        # walk up through containers to the owning statement: a module-level table names its numbers
        while isinstance(p, (ast.Tuple, ast.List, ast.Set, ast.Dict, ast.UnaryOp)) or (isinstance(p, ast.BinOp) and _const_expr(p)):
            child, p = p, mod.parents.get(p)
        if isinstance(p, (ast.Assign, ast.AnnAssign)):
            targets = p.targets if isinstance(p, ast.Assign) else [p.target]
            if all(isinstance(t, ast.Name) and (t.id.isupper() or t.id.startswith("__")) for t in targets):
                continue  # naming the constant is the fix
            if mod.enclosing(p, FUNC) is None and isinstance(mod.parents.get(p), (ast.Module, ast.ClassDef)):
                continue  # module or class level binding names it
        if isinstance(p, (ast.keyword, ast.arguments, ast.Slice)) or (isinstance(p, ast.Subscript) and child is not p.value):
            continue  # a number used as the index is exempt; a literal being indexed is not
        if isinstance(p, ast.Call) and isinstance(p.func, ast.Name) and p.func.id in ("range", "round", "sleep", "exit"):
            continue
        if isinstance(p, ast.Call) and isinstance(p.func, ast.Attribute) and p.func.attr == "sleep":
            continue  # time.sleep(0.5), asyncio.sleep(2)
        if isinstance(p, (ast.Compare,)) and isinstance(mod.parents.get(p), ast.Assert):
            continue
        key = (node.lineno, value)
        if key in seen:
            continue
        seen.add(key)
        out.append(mod.finding("LIT001", node, f"Magic number {value!r}; give it a name.", end_line=node.lineno))
    return out


# --- WIN001 ------------------------------------------------------------------

TODO_RE = re.compile(r"#.*\b(TODO|FIXME|HACK|XXX)\b")


def _to_stderr(call: ast.Call) -> bool:
    """print(..., file=sys.stderr): a diagnostic channel, not stray output."""
    return any(k.arg == "file" and isinstance(k.value, ast.Attribute) and k.value.attr == "stderr" for k in call.keywords)


def check_win001(mod: Module, opts: dict) -> list[Finding]:
    out = []
    for line_no, text in mod.comments:
        m = TODO_RE.search(text)
        if m:
            out.append(mod.finding("WIN001", line_no, f"{m.group(1)} comment left in source; fix it or track it in an issue."))
    library = not (mod.has_main_guard or mod.path.name in ("__main__.py", "cli.py", "manage.py"))
    for node in ast.walk(mod.tree):
        if not isinstance(node, ast.Call):
            continue
        name = mod.dotted(node.func)
        if name in ("breakpoint", "pdb.set_trace", "ipdb.set_trace"):
            out.append(mod.finding("WIN001", node, f"Debugger call '{name}()' left in source.", end_line=node.lineno))
        elif name == "print" and library and not _to_stderr(node):
            out.append(mod.finding("WIN001", node, "print() in a library module; use logging or return the value.", end_line=node.lineno))
    return out


FILE_CHECKS = {
    "FN001": check_fn001,
    "FN002": check_fn002,
    "FN003": check_fn003,
    "FN004": check_fn004,
    "FN005": check_fn005,
    "ERR001": check_err001,
    "DEM001": check_dem001,
    "STATE001": check_state001,
    "RES001": check_res001,
    "SEC001": check_sec001,
    "SEC002": check_sec002,
    "CFG001": check_cfg001,
    "ARCH001": check_arch001,
    "OO001": check_oo001,
    "CQS001": check_cqs001,
    "LIT001": check_lit001,
    "WIN001": check_win001,
}
