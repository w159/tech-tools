"""Run the selected rules over a target and return findings plus parse errors."""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .catalog import RULES_BY_ID, SEVERITY_ORDER
from .core import (DEFAULT_TEST_GLOBS, Finding, Module, discover, is_test_path,
                   rule_options, selected_rules, suppressed)
from .rules_file import FILE_CHECKS
from .rules_repo import REPO_CHECKS


@dataclass
class ScanResult:
    root: str
    rules: list[str]
    findings: list[Finding] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    files_scanned: int = 0
    suppressed: int = 0
    baselined: int = 0


def _enrich(f: Finding) -> Finding:
    rule = RULES_BY_ID[f.rule]
    f.severity = f.severity or rule.severity
    f.principle = rule.principle
    f.source = rule.sources[0]
    return f


def _git(top: str, *args: str) -> str:
    # -c core.quotePath=false keeps non-ASCII paths literal; flags below ignore user diff config
    return subprocess.run(["git", "-c", "core.quotePath=false", "-C", top, *args], capture_output=True, text=True, check=True).stdout


def _unquote(path: str) -> str:
    """Undo git C-style quoting ("caf\\303\\251.py") if present."""
    if len(path) >= 2 and path[0] == '"' and path[-1] == '"':
        return path[1:-1].encode("utf-8").decode("unicode_escape").encode("latin-1", "replace").decode("utf-8", "replace")
    return path


def changed_lines(root: Path, ref: str) -> dict[str, set[int]]:
    """Map path (relative to root) -> changed line numbers vs ref, from git diff -U0."""
    if ref.startswith("-"):
        raise ValueError(f"invalid --diff ref: {ref!r}")
    base = root if root.is_dir() else root.parent
    top = _git(str(base), "rev-parse", "--show-toplevel").strip()
    diff = _git(top, "diff", "-U0", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", ref, "--", "*.py")
    untracked = [u for u in _git(top, "ls-files", "-z", "--others", "--exclude-standard", "--", "*.py").split("\0") if u]
    out: dict[str, set[int]] = {}
    current = None
    for line in diff.splitlines():
        if line.startswith("+++ "):
            name = _unquote(line[4:].rstrip("\t"))
            current = None if name == "/dev/null" else name[2:] if name.startswith("b/") else name
        elif line.startswith("@@") and current:
            m = re.search(r"\+(\d+)(?:,(\d+))?", line)
            start, count = int(m.group(1)), int(m.group(2) or "1")
            out.setdefault(current, set()).update(range(start, start + max(count, 1)))
    for rel in untracked:
        p = Path(top) / rel
        out[rel] = set(range(1, len(p.read_text(errors="replace").splitlines()) + 2))
    # re-key relative to the scan root
    root_abs = root.resolve()
    rekeyed = {}
    for rel, lines in out.items():
        p = (Path(top) / rel).resolve()
        try:
            rekeyed[p.relative_to(root_abs if root_abs.is_dir() else root_abs.parent).as_posix()] = lines
        except ValueError:
            continue
    return rekeyed


def load_baseline(path: Path) -> set[str]:
    try:
        data = json.loads(path.read_text())
        return {e["fingerprint"] for e in data.get("findings", [])}
    except (KeyError, TypeError, AttributeError) as exc:
        raise ValueError(f"malformed baseline {path}: {type(exc).__name__}: {exc}") from exc


def scan(target: Path, config: dict, only=None, skip=None, diff_ref: str | None = None, baseline: Path | None = None,
         include_tests: bool = True) -> ScanResult:
    target = target.resolve()
    root = target if target.is_dir() else target.parent
    rules = selected_rules(config, only, skip)
    result = ScanResult(root=str(root), rules=rules)
    test_globs = config.get("test_globs", DEFAULT_TEST_GLOBS)

    mods: list[Module] = []
    for path in discover(target, config):
        rel = path.relative_to(root).as_posix()
        is_test = is_test_path(rel, test_globs)
        if is_test and not include_tests:
            continue
        try:
            source = path.read_text(encoding="utf-8")
            mods.append(Module(root, path, source, is_test))
        except (SyntaxError, UnicodeDecodeError, ValueError) as exc:
            result.errors.append({"path": rel, "error": f"{type(exc).__name__}: {exc}".splitlines()[0]})
    result.files_scanned = len(mods)

    raw: list[Finding] = []
    for rule_id in rules:
        rule = RULES_BY_ID[rule_id]
        opts = rule_options(config, rule_id)
        if rule.scope == "repo":
            pool = [m for m in mods if not (rule.skip_tests and m.is_test)]
            raw.extend(REPO_CHECKS[rule_id](pool, opts))
        else:
            for mod in mods:
                if rule.skip_tests and mod.is_test:
                    continue
                raw.extend(FILE_CHECKS[rule_id](mod, opts))

    by_rel = {m.rel: m for m in mods}
    known = load_baseline(baseline) if baseline else set()
    changed = changed_lines(target, diff_ref) if diff_ref else None
    seen = set()
    live: list[Finding] = []
    for f in raw:
        key = (f.rule, f.path, f.line, f.message)
        if key in seen:
            continue
        seen.add(key)
        mod = by_rel.get(f.path)
        if mod and suppressed(mod, f):
            result.suppressed += 1
            continue
        live.append(f)
    # number identical findings per file in source order so a new copy is not hidden by the baseline
    counts: dict[str, int] = {}
    for f in sorted(live, key=lambda f: (f.path, f.line, f.rule, f.message)):
        base = f.fingerprint()
        f.occurrence = counts.get(base, 0)
        counts[base] = f.occurrence + 1
    for f in live:
        if changed is not None:
            lines = changed.get(f.path, set())
            if not lines & set(range(f.line, max(f.end_line, f.line) + 1)):
                continue
        if f.fingerprint() in known:
            result.baselined += 1
            continue
        result.findings.append(_enrich(f))
    result.findings.sort(key=lambda f: (SEVERITY_ORDER[f.severity], f.path, f.line, f.rule, f.message))
    return result
