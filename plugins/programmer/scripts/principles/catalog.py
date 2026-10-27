"""Rule catalog: the single source of truth for every detected rule.

The scanner, the SARIF rule table, the generated catalog page, and the
contract tests all read from RULES. Add a rule here first, then implement it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

TPP = "The Pragmatic Programmer, 20th Anniversary Edition"


@dataclass(frozen=True)
class Rule:
    id: str
    title: str
    principle: str
    sources: tuple[str, ...]
    detects: str
    severity: str  # error | warning | note
    scope: str = "file"  # file | repo
    skip_tests: bool = False
    options: dict = field(default_factory=dict)


RULES: tuple[Rule, ...] = (
    Rule(
        "DRY001",
        "Duplicated logic",
        "Don't Repeat Yourself",
        (f"{TPP}, Topic 9, Tip 15", "Refactoring (Fowler), ch.3 Duplicated Code"),
        "Identical blocks of 6+ logical lines, or a function whose token shingles are 75%+ contained in another function.",
        "warning",
        scope="repo",
        options={"min_lines": 6, "min_tokens": 40, "containment": 0.75},
    ),
    Rule(
        "FN001",
        "Function too long",
        "Functions should be small",
        ("Clean Code, ch.3 Functions", "Refactoring (Fowler), ch.3 Long Function"),
        "Function body with more statements than max_statements (nested defs not counted).",
        "warning",
        options={"max_statements": 30},
    ),
    Rule(
        "FN002",
        "Long parameter list",
        "Keep argument counts low",
        ("Clean Code, ch.3 Function Arguments", "Refactoring (Fowler), ch.3 Long Parameter List"),
        "More than max_params parameters, not counting self, cls, *args or **kwargs.",
        "warning",
        options={"max_params": 4},
    ),
    Rule(
        "FN003",
        "Flag argument",
        "Flag arguments say the function does more than one thing",
        ("Clean Code, ch.3 Flag Arguments",),
        "A bool parameter (annotated bool or defaulting to True/False) that is tested by an if inside the function.",
        "warning",
    ),
    Rule(
        "FN004",
        "Deep nesting",
        "Keep nesting shallow",
        ("Five Lines of Code (Clausen)", "Clean Code, ch.3 Blocks and Indenting"),
        "Control blocks nested deeper than max_depth inside one function (elif does not add depth).",
        "warning",
        options={"max_depth": 3},
    ),
    Rule(
        "FN005",
        "High cyclomatic complexity",
        "Limit decision paths per function",
        ("Software Engineering: A Practitioner's Approach (Pressman), cyclomatic complexity",),
        "McCabe complexity above max_complexity (if, loops, except, boolean operators, comprehension filters, match cases).",
        "warning",
        options={"max_complexity": 10},
    ),
    Rule(
        "ERR001",
        "Swallowed or over-broad exception",
        "Crash early; dead programs tell no lies",
        (f"{TPP}, Topic 24, Tip 38", "Clean Code, ch.7 Error Handling"),
        "Bare except; or except Exception/BaseException whose body neither re-raises nor logs.",
        "error",
    ),
    Rule(
        "DEM001",
        "Message chain",
        "Law of Demeter: don't chain method calls",
        (f"{TPP}, Topic 28, Tip 46", "Refactoring (Fowler), ch.3 Message Chains"),
        "Attribute chains with more than max_links links on an object (module paths and the leading self are not counted).",
        "warning",
        options={"max_links": 3},
    ),
    Rule(
        "STATE001",
        "Mutable global state",
        "Avoid global data; shared state is incorrect state",
        (f"{TPP}, Topic 28, Tip 47", f"{TPP}, Topic 34, Tip 57", "Refactoring (Fowler), ch.3 Global Data"),
        "A global statement that rebinds a name, or a module-level dict/list/set mutated inside a function.",
        "warning",
    ),
    Rule(
        "RES001",
        "Resource not paired with release",
        "Finish what you start",
        (f"{TPP}, Topic 26, Tip 40",),
        "open(), sqlite3.connect(), socket(), urlopen(), ZipFile() and similar acquired outside a with block or try/finally.",
        "warning",
    ),
    Rule(
        "SEC001",
        "Query built from strings",
        "Never build queries from untrusted strings",
        (f"{TPP}, Topic 43 Stay Safe Out There", "Software Architecture in Practice, 4th Ed., Security tactics"),
        "An f-string, % format, .format() or string concatenation passed to execute/executemany/executescript/raw, directly or through one local variable.",
        "error",
    ),
    Rule(
        "SEC002",
        "Secret in source",
        "Keep secrets out of code",
        (f"{TPP}, Topic 43 Stay Safe Out There",),
        "A string literal assigned to a secret-like name (password, token, api_key, secret) or matching a known credential format.",
        "error",
        skip_tests=True,
    ),
    Rule(
        "CFG001",
        "Hardcoded endpoint",
        "Parameterize your app using external configuration",
        (f"{TPP}, Topic 32, Tip 55",),
        "A string literal that is entirely a URL, outside docstrings, tests and config modules.",
        "warning",
        skip_tests=True,
    ),
    Rule(
        "ARCH001",
        "Dependency rule violation",
        "Source dependencies point inward",
        ("Clean Architecture (Martin), ch.22 The Dependency Rule",),
        "A module in an inner layer imports an outer layer or an I/O library (layers from config; default inner dirs: domain, entities, usecases, use_cases).",
        "warning",
        options={
            "inner_dirs": ["domain", "entities", "usecases", "use_cases"],
            "outer_dirs": ["infrastructure", "infra", "adapters", "api", "web", "db", "persistence", "ui", "cli"],
            "io_modules": [
                "sqlite3", "psycopg", "psycopg2", "pymysql", "sqlalchemy", "pymongo", "redis",
                "requests", "httpx", "aiohttp", "urllib.request", "boto3",
                "flask", "django", "fastapi", "starlette",
            ],
        },
    ),
    Rule(
        "ARCH002",
        "Import cycle",
        "Acyclic dependencies principle",
        ("Clean Architecture (Martin), ch.14 Component Coupling",),
        "In-repo modules that import each other at module level, directly or through a cycle (TYPE_CHECKING imports excluded).",
        "warning",
        scope="repo",
    ),
    Rule(
        "OO001",
        "Large class",
        "Classes should be small",
        ("Clean Code, ch.10 Classes", "Refactoring (Fowler), ch.3 Large Class"),
        "A class with more than max_methods methods or more than max_lines lines.",
        "warning",
        options={"max_methods": 20, "max_lines": 300},
    ),
    Rule(
        "OO002",
        "Deep inheritance",
        "Don't pay inheritance tax; favor composition",
        (f"{TPP}, Topic 31, Tip 51", "Design Patterns (GoF), Favor object composition over class inheritance"),
        "A class with more than max_depth in-repo ancestors in one chain (exception hierarchies excluded).",
        "warning",
        scope="repo",
        options={"max_depth": 2},
    ),
    Rule(
        "CQS001",
        "Query that mutates",
        "Command-query separation",
        ("Object-Oriented Software Construction (Meyer), Command-Query Separation",),
        "A get_/is_/has_/can_/should_ method that assigns to self or calls a mutator on self state (lazy-init guarded by an if on the same attribute is allowed).",
        "warning",
    ),
    Rule(
        "LIT001",
        "Magic number",
        "Replace magic literals with named constants",
        ("Refactoring (Fowler), Replace Magic Literal", "Clean Code, ch.17 G25"),
        "A numeric literal other than 0, 1 and -1 inside an expression (named constants, defaults, keyword arguments and subscripts are allowed).",
        "note",
        skip_tests=True,
        options={"allowed": [0, 1, -1]},
    ),
    Rule(
        "WIN001",
        "Broken window",
        "Don't live with broken windows",
        (f"{TPP}, Topic 3, Tip 5",),
        "TODO/FIXME/HACK/XXX comments, breakpoint()/pdb.set_trace() calls, and print() in library modules.",
        "note",
        skip_tests=True,
    ),
)

RULES_BY_ID = {r.id: r for r in RULES}
SEVERITY_ORDER = {"error": 0, "warning": 1, "note": 2}
