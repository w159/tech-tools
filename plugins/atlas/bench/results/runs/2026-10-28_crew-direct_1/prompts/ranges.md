# Crew crew-06102205d2: you are `ranges`
Team goal: Implement pkg/*.py per SPEC.md

## Your task
Implement pkg/ranges.py per the spec section 'ranges'.

## You own (only you may edit)
- pkg/ranges.py

## Peers on #crew-06102205d2
- cli owns pkg/cli.py
- manifest owns pkg/manifest.py
- registry owns pkg/registry.py
- resolver owns pkg/resolver.py
- semver owns pkg/semver.py

## Done when
`irc check` passes in /private/var/folders/t4/3yydl26s5mqb99t84qw3_wrm0000gn/T/bench-crew-direct-26lm56_r/work: it runs `python3 -m pytest -q tests/test_ranges.py` after the peers you import are done.

## Context
# pkgkit

A small package toolkit. Six modules in the namespace package `pkg` (no `__init__.py`; run everything from the project root so `from pkg import semver` works). Each module is implemented in `pkg/<module>.py`. Import sibling modules as `from pkg import <module>`. Python 3 standard library only. Every "raises" below is exact: the named exception type, raised for the stated condition. Do not edit anything under `tests/`.

Import graph (must hold): `semver` imports nothing from `pkg`; `ranges` imports `semver`; `manifest` imports `ranges` and `semver`; `registry` imports `manifest` and `semver`; `resolver` imports `ranges` and `registry`; `cli` imports every other module.

## ranges

A range is text of one or more whitespace separated comparators; a version satisfies the range when it satisfies every comparator. A comparator is one of:
- `*`: matches everything (contributes no constraints);
- a version prefixed by `=`, `>`, `>=`, `<` or `<=`;
- a bare version (same as `=`);
- `~V`: at least V, below the next minor (`~1.2.3` means `>=1.2.3 <1.3.0`);
- `^V`: at least V, below the next change of the left-most non-zero part (`^1.2.3` is `>=1.2.3 <2.0.0`; `^0.2.3` is `>=0.2.3 <0.3.0`; `^0.0.3` is `>=0.0.3 <0.0.4`).
For `~` and `^`, a pre-release on V is dropped (`^1.2.3-rc.1` is `>=1.2.3 <2.0.0`). Pre-release versions get no special treatment: they compare by `semver.compare`.

- `parse_range(text)` -> list of `(op, version)` tuples, `op` one of `"="`, `">"`, `">="`, `"<"`, `"<="`, `version` a canonical version string (`semver.format(semver.parse(...))`). Comparators are expanded in order of appearance; `*` yields nothing, so `parse_range("*")` is `[]`. Raises `ValueError` if `text` is not a string, is empty or only whitespace, or contains an invalid comparator or version.
- `valid_range(text)` -> bool. True exactly when `parse_range(text)` succeeds; never raises.
- `satisfies(version, range_text)` -> bool. Raises `ValueError` if `version` or `range_text` is invalid.
- `max_satisfying(versions, range_text)` -> the highest (by `semver.compare`) version string in `versions` that satisfies the range, or `None` if none does. Returns the string as given in `versions`.

Interfaces of the peer files you import (code against these; their owners implement them, do not read the files):
# semver owns pkg/semver.py
def parse(text): ...
def format(v): ...
def is_valid(text): ...
def compare(a, b): ...
def bump(text, part): ...
def sort_versions(versions): ...


--- pkg/ranges.py ---
"""ranges: implement per SPEC.md (section ranges)."""
from pkg import semver  # noqa: F401


def parse_range(text):
    raise NotImplementedError


def valid_range(text):
    raise NotImplementedError


def satisfies(version, range_text):
    raise NotImplementedError


def max_satisfying(versions, range_text):
    raise NotImplementedError

