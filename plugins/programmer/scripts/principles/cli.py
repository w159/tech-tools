"""Command line: scan, catalog, rules, explain."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from . import __version__
from .catalog import RULES, RULES_BY_ID, SEVERITY_ORDER
from .core import load_config
from .engine import scan
from .output import catalog_markdown, to_json, to_markdown, to_sarif, to_text

RENDER = {"text": to_text, "json": to_json, "sarif": to_sarif, "md": to_markdown}


def _csv(value: str | None) -> list[str] | None:
    return [v.strip() for v in value.split(",") if v.strip()] if value else None


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="principles", description="Detect code that breaks book-derived principles.")
    p.add_argument("--version", action="version", version=f"principles {__version__}")
    sub = p.add_subparsers(dest="command")

    s = sub.add_parser("scan", help="scan a file or directory")
    s.add_argument("target", nargs="?", default=".")
    s.add_argument("--format", choices=sorted(RENDER), default="text")
    s.add_argument("--output", "-o", help="write the report here instead of stdout")
    s.add_argument("--rules", help="comma-separated rule ids to run (default: all)")
    s.add_argument("--skip", help="comma-separated rule ids to skip")
    s.add_argument("--config", help="path to a .principles.toml (default: <target>/.principles.toml or pyproject [tool.principles])")
    s.add_argument("--diff", nargs="?", const="HEAD", metavar="REF", help="only report findings on lines changed vs REF (default HEAD)")
    s.add_argument("--baseline", help="ignore findings whose fingerprints are in this JSON report")
    s.add_argument("--write-baseline", metavar="FILE", help="write current findings as a baseline and exit 0")
    s.add_argument("--no-tests", action="store_true", help="skip test files entirely")
    s.add_argument("--fail-on", choices=["error", "warning", "note", "never"], default="error",
                   help="exit 1 if any finding is at or above this severity (default error)")

    sub.add_parser("catalog", help="print the rule catalog as Markdown")
    sub.add_parser("rules", help="list rule ids, severity and title")
    e = sub.add_parser("explain", help="show one rule")
    e.add_argument("rule")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "catalog":
        sys.stdout.write(catalog_markdown())
        return 0
    if args.command == "rules":
        for r in RULES:
            print(f"{r.id}\t{r.severity}\t{r.title}")
        return 0
    if args.command == "explain":
        r = RULES_BY_ID.get(args.rule.upper())
        if not r:
            print(f"unknown rule: {args.rule}", file=sys.stderr)
            return 2
        print(json.dumps({"id": r.id, "title": r.title, "principle": r.principle, "sources": r.sources,
                          "detects": r.detects, "severity": r.severity, "options": r.options}, indent=2))
        return 0
    if args.command != "scan":
        build_parser().print_help()
        return 2

    target = Path(args.target)
    if not target.exists():
        print(f"principles: target not found: {target}", file=sys.stderr)
        return 2
    root = target if target.is_dir() else target.parent
    try:
        config = load_config(root, Path(args.config) if args.config else None)
        result = scan(target, config, only=_csv(args.rules), skip=_csv(args.skip), diff_ref=args.diff,
                      baseline=Path(args.baseline) if args.baseline else None, include_tests=not args.no_tests)
    except (ValueError, FileNotFoundError) as exc:
        print(f"principles: {exc}", file=sys.stderr)
        return 2
    except subprocess.CalledProcessError as exc:
        print(f"principles: git failed for --diff: {(exc.stderr or '').strip() or exc}", file=sys.stderr)
        return 2

    if args.write_baseline:
        Path(args.write_baseline).write_text(to_json(result))
        print(f"principles: wrote baseline with {len(result.findings)} findings to {args.write_baseline}", file=sys.stderr)
        return 0

    rendered = RENDER[args.format](result)
    if args.output:
        Path(args.output).write_text(rendered + ("" if rendered.endswith("\n") else "\n"))
        print(to_text(result).splitlines()[-1], file=sys.stderr)
    else:
        print(rendered)

    if result.errors:  # files that could not be parsed were not scanned: never report a clean run
        return 2
    if args.fail_on == "never":
        return 0
    threshold = SEVERITY_ORDER[args.fail_on]
    return 1 if any(SEVERITY_ORDER[f.severity] <= threshold for f in result.findings) else 0
