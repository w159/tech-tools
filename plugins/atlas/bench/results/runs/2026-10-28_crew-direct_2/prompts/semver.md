# Crew crew-0615231b1a: you are `semver`
Team goal: Implement pkg/*.py per SPEC.md

## Your task
Implement pkg/semver.py per the spec section 'semver'.

## You own (only you may edit)
- pkg/semver.py

## Peers on #crew-0615231b1a
- cli owns pkg/cli.py
- manifest owns pkg/manifest.py
- ranges owns pkg/ranges.py
- registry owns pkg/registry.py
- resolver owns pkg/resolver.py

## Done when
`irc check` passes in /private/var/folders/t4/3yydl26s5mqb99t84qw3_wrm0000gn/T/bench-crew-direct-o562dc8f/work: it runs `python3 -m pytest -q tests/test_semver.py` after the peers you import are done.

## Context
# pkgkit

A small package toolkit. Six modules in the namespace package `pkg` (no `__init__.py`; run everything from the project root so `from pkg import semver` works). Each module is implemented in `pkg/<module>.py`. Import sibling modules as `from pkg import <module>`. Python 3 standard library only. Every "raises" below is exact: the named exception type, raised for the stated condition. Do not edit anything under `tests/`.

Import graph (must hold): `semver` imports nothing from `pkg`; `ranges` imports `semver`; `manifest` imports `ranges` and `semver`; `registry` imports `manifest` and `semver`; `resolver` imports `ranges` and `registry`; `cli` imports every other module.

## semver

A version is the text `MAJOR.MINOR.PATCH` or `MAJOR.MINOR.PATCH-PRE`. MAJOR, MINOR, PATCH are non-negative decimal integers with no leading zeros (`0` is fine, `01` is not). PRE is one or more dot separated identifiers; an identifier is either a number with no leading zeros, or a non-empty string of `[0-9A-Za-z-]` containing at least one letter or hyphen. No leading `v`, no whitespace, no build metadata (`+`).

- `parse(text)` -> dict `{"major": int, "minor": int, "patch": int, "pre": list[str]}`. `pre` is `[]` when there is no pre-release. Raises `ValueError` if `text` is not a string or not a valid version.
- `format(v)` -> str. Inverse of `parse`: `"1.2.3"` or `"1.2.3-alpha.1"`.
- `is_valid(text)` -> bool. True exactly when `parse(text)` would succeed; never raises.
- `compare(a, b)` -> `-1`, `0` or `1` (a<b, a==b, a>b). Both arguments are version strings; raises `ValueError` if either is invalid. Order by major, minor, patch. A version with a pre-release is lower than the same version without one. Two pre-releases compare identifier by identifier: two numeric identifiers compare as integers; a numeric identifier is lower than a non-numeric one; two non-numeric identifiers compare as plain strings; if all shared identifiers are equal, the one with fewer identifiers is lower.
- `bump(text, part)` -> str. `part` is `"major"`, `"minor"` or `"patch"`. Increments that part, resets every lower part to 0, and drops any pre-release (`bump("1.2.3-rc.1", "patch")` is `"1.2.4"`). Raises `ValueError` for an invalid version or any other `part`.
- `sort_versions(versions)` -> new list of version strings in ascending `compare` order. Does not modify the argument. Raises `ValueError` on an invalid entry.

--- pkg/semver.py ---
"""semver: implement per SPEC.md (section semver)."""


def parse(text):
    raise NotImplementedError


def format(v):
    raise NotImplementedError


def is_valid(text):
    raise NotImplementedError


def compare(a, b):
    raise NotImplementedError


def bump(text, part):
    raise NotImplementedError


def sort_versions(versions):
    raise NotImplementedError

