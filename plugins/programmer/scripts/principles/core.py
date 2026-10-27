"""Scanner core: findings, parsed modules, configuration, suppressions, baselines."""

from __future__ import annotations

import ast
import fnmatch
import hashlib
import io
import os
import re
import sys
import tokenize
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .catalog import RULES, RULES_BY_ID

DEFAULT_EXCLUDES = [
    ".git", ".hg", ".svn", ".tox", ".nox", ".venv", "venv", "env", "node_modules",
    "__pycache__", "build", "dist", "site-packages", ".mypy_cache", ".pytest_cache",
]
DEFAULT_TEST_GLOBS = ["test_*.py", "*_test.py", "conftest.py", "tests/*", "*/tests/*", "testing/*", "*/testing/*"]
CONFIG_FILE_STEMS = {"settings", "config", "conf", "configuration", "setup", "noxfile", "conftest"}

SUPPRESS_RE = re.compile(r"#\s*principles:\s*ignore(?:\[(?P<rules>[A-Z0-9_, ]+)\])?")
SUPPRESS_FILE_RE = re.compile(r"#\s*principles:\s*ignore-file(?:\[(?P<rules>[A-Z0-9_, ]+)\])?")


@dataclass
class Finding:
    rule: str
    path: str  # relative to the scan root, forward slashes
    line: int
    end_line: int
    message: str
    severity: str = ""
    principle: str = ""
    source: str = ""
    snippet: str = ""
    related: list = field(default_factory=list)  # [{"path":..., "line":...}]

    def fingerprint(self) -> str:
        """Stable across line moves: rule + path + normalized source line."""
        norm = " ".join(self.snippet.split())
        return hashlib.sha256(f"{self.rule}|{self.path}|{norm}".encode()).hexdigest()[:16]

    def to_dict(self) -> dict:
        d = asdict(self)
        d["fingerprint"] = self.fingerprint()
        return d


class Module:
    """One parsed Python file plus the lookups rules need."""

    def __init__(self, root: Path, path: Path, source: str, is_test: bool):
        self.root = root
        self.path = path
        self.rel = path.relative_to(root).as_posix() if path != root else path.name
        self.source = source
        self.lines = source.splitlines()
        self.is_test = is_test
        self.tree = ast.parse(source, filename=str(path))
        self.parents: dict[ast.AST, ast.AST] = {}
        for node in ast.walk(self.tree):
            for child in ast.iter_child_nodes(node):
                self.parents[child] = node
        self.imports = self._import_aliases()
        self.docstrings = self._docstring_nodes()
        self.comments = self._comments()
        self.has_main_guard = "__name__" in source and "__main__" in source
        self.is_config_module = path.stem.lower() in CONFIG_FILE_STEMS or path.stem.lower().endswith(("_config", "_settings"))

    # --- helpers -----------------------------------------------------------------

    def _import_aliases(self) -> dict[str, str]:
        """Local name -> fully dotted module/attribute it refers to."""
        aliases: dict[str, str] = {}
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    if a.asname:
                        aliases[a.asname] = a.name
                    else:
                        aliases[a.name.split(".")[0]] = a.name.split(".")[0]
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                for a in node.names:
                    aliases[a.asname or a.name] = f"{node.module}.{a.name}"
        return aliases

    def _docstring_nodes(self) -> set[int]:
        ids: set[int] = set()
        for node in ast.walk(self.tree):
            if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                body = node.body
                if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
                    ids.add(id(body[0].value))
        return ids

    def _comments(self) -> list[tuple[int, str]]:
        out = []
        try:
            for tok in tokenize.generate_tokens(io.StringIO(self.source).readline):
                if tok.type == tokenize.COMMENT:
                    out.append((tok.start[0], tok.string))
        except (tokenize.TokenError, IndentationError, SyntaxError):
            pass
        return out

    def dotted(self, node: ast.AST) -> str | None:
        """Resolve Name/Attribute to a dotted path, expanding import aliases."""
        parts = []
        while isinstance(node, ast.Attribute):
            parts.append(node.attr)
            node = node.value
        if not isinstance(node, ast.Name):
            return None
        head = self.imports.get(node.id, node.id)
        return ".".join([head] + list(reversed(parts)))

    def line_text(self, line: int) -> str:
        return self.lines[line - 1].strip() if 0 < line <= len(self.lines) else ""

    def finding(self, rule_id: str, node_or_line, message: str, end_line: int | None = None, related=None) -> Finding:
        if isinstance(node_or_line, int):
            line, end = node_or_line, end_line or node_or_line
        else:
            line = node_or_line.lineno
            end = end_line or getattr(node_or_line, "end_lineno", None) or line
        return Finding(rule_id, self.rel, line, end, message, snippet=self.line_text(line), related=related or [])

    def enclosing(self, node: ast.AST, kinds) -> ast.AST | None:
        cur = self.parents.get(node)
        while cur is not None and not isinstance(cur, kinds):
            cur = self.parents.get(cur)
        return cur


# --- configuration ---------------------------------------------------------------


def load_config(root: Path, explicit: Path | None = None) -> dict:
    """Read .principles.toml (or [tool.principles] in pyproject.toml)."""
    candidates = [explicit] if explicit else [root / ".principles.toml", root / "pyproject.toml"]
    for cand in candidates:
        if not cand or not cand.is_file():
            continue
        try:
            import tomllib  # Python 3.11+
        except ModuleNotFoundError:
            print(f"principles: {cand.name} ignored, reading config needs Python 3.11+", file=sys.stderr)
            return {}
        with cand.open("rb") as fh:
            data = tomllib.load(fh)
        if cand.name == "pyproject.toml":
            data = data.get("tool", {}).get("principles", {})
            if not data:
                continue
        return data
    if explicit:
        raise FileNotFoundError(f"config file not found: {explicit}")
    return {}


def rule_options(config: dict, rule_id: str) -> dict:
    opts = dict(RULES_BY_ID[rule_id].options)
    opts.update(config.get("rules", {}).get(rule_id, {}))
    return opts


def selected_rules(config: dict, only: list[str] | None, skip: list[str] | None) -> list[str]:
    ids = [r.id for r in RULES]
    if only:
        unknown = [r for r in only if r not in RULES_BY_ID]
        if unknown:
            raise ValueError(f"unknown rule(s): {', '.join(unknown)}")
        ids = [i for i in ids if i in only]
    disabled = set(config.get("disable", [])) | set(skip or [])
    return [i for i in ids if i not in disabled]


# --- discovery -------------------------------------------------------------------


def is_test_path(rel: str, globs: list[str]) -> bool:
    name = rel.rsplit("/", 1)[-1]
    return any(fnmatch.fnmatch(name, g) or fnmatch.fnmatch(rel, g) for g in globs)


def discover(root: Path, config: dict) -> list[Path]:
    if root.is_file():
        return [root] if root.suffix == ".py" else []
    excludes = set(DEFAULT_EXCLUDES) | set(config.get("exclude_dirs", []))
    extra_globs = config.get("exclude", [])
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in excludes and not d.endswith(".egg-info"))
        for fn in sorted(filenames):
            if not fn.endswith(".py"):
                continue
            p = Path(dirpath) / fn
            rel = p.relative_to(root).as_posix()
            if any(fnmatch.fnmatch(rel, g) for g in extra_globs):
                continue
            files.append(p)
    return files


# --- suppression and baseline ----------------------------------------------------


def _parse_rule_list(raw: str | None) -> set[str] | None:
    if raw is None:
        return None  # all rules
    return {r.strip() for r in raw.split(",") if r.strip()}


def suppressed(mod: Module, f: Finding) -> bool:
    for _, text in mod.comments:
        m = SUPPRESS_FILE_RE.search(text)
        if m:
            rules = _parse_rule_list(m.group("rules"))
            if rules is None or f.rule in rules:
                return True
    for line_no, text in mod.comments:
        if line_no not in (f.line, f.line - 1):
            continue
        m = SUPPRESS_RE.search(text)
        if m and not SUPPRESS_FILE_RE.search(text):
            rules = _parse_rule_list(m.group("rules"))
            if rules is None or f.rule in rules:
                return True
    return False
