# Crew crew-0616306720: you are `manifest`
Team goal: Implement pkg/*.py per SPEC.md

## Your task
Implement pkg/manifest.py per the spec section 'manifest'.

## You own (only you may edit)
- pkg/manifest.py

## Peers on #crew-0616306720
- cli owns pkg/cli.py
- ranges owns pkg/ranges.py
- registry owns pkg/registry.py
- resolver owns pkg/resolver.py
- semver owns pkg/semver.py

## Done when
`irc check` passes in /private/var/folders/t4/3yydl26s5mqb99t84qw3_wrm0000gn/T/bench-crew-direct-6vic4l_z/work: it runs `python3 -m pytest -q tests/test_manifest.py` after the peers you import are done.

## Context
# pkgkit

A small package toolkit. Six modules in the namespace package `pkg` (no `__init__.py`; run everything from the project root so `from pkg import semver` works). Each module is implemented in `pkg/<module>.py`. Import sibling modules as `from pkg import <module>`. Python 3 standard library only. Every "raises" below is exact: the named exception type, raised for the stated condition. Do not edit anything under `tests/`.

Import graph (must hold): `semver` imports nothing from `pkg`; `ranges` imports `semver`; `manifest` imports `ranges` and `semver`; `registry` imports `manifest` and `semver`; `resolver` imports `ranges` and `registry`; `cli` imports every other module.

## manifest

A manifest is text with one `key: value` per line. Blank lines and lines whose first non-blank character is `#` are ignored. Surrounding whitespace on lines, keys and values is stripped; only the first `:` splits a line, so values may contain `:`. Keys: `name`, `version`, and any number of `dep.<package>` (value is a range). A manifest is represented as `{"name": str, "version": str, "dependencies": {package: range_text}}`.

- `validate_name(name)` -> bool. A valid package name is a string of 1 to 32 characters, starting with a lowercase letter `a-z`, the rest lowercase letters, digits or `-`. Never raises (non-strings give False).
- `parse_manifest(text)` -> manifest dict. Raises `ValueError` for: a non-blank, non-comment line without `:`; an unknown key; a repeated key; a missing `name` or `version`; an invalid name; an invalid version (`semver.is_valid`); an invalid dependency package name; a dependency range that is not `ranges.valid_range`.
- `dump_manifest(m)` -> str. Lines `name: ...`, `version: ...`, then `dep.<package>: <range>` for each dependency sorted by package name, each line ending with `\n`. `parse_manifest(dump_manifest(m)) == m` for any valid manifest.
- `add_dependency(m, name, range_text)` -> new manifest dict with the dependency set (replacing an existing one); `m` is not modified. Raises `ValueError` for an invalid package name or an invalid range.
- `remove_dependency(m, name)` -> new manifest dict without that dependency; `m` is not modified. Raises `KeyError` if `name` is not a dependency.

Interfaces of the peer files you import (code against these; their owners implement them, do not read the files):
# ranges owns pkg/ranges.py
def parse_range(text): ...
def valid_range(text): ...
def satisfies(version, range_text): ...
def max_satisfying(versions, range_text): ...
# semver owns pkg/semver.py
def parse(text): ...
def format(v): ...
def is_valid(text): ...
def compare(a, b): ...
def bump(text, part): ...
def sort_versions(versions): ...


--- pkg/manifest.py ---
"""manifest: implement per SPEC.md (section manifest)."""
from pkg import ranges, semver  # noqa: F401


def validate_name(name):
    raise NotImplementedError


def parse_manifest(text):
    raise NotImplementedError


def dump_manifest(m):
    raise NotImplementedError


def add_dependency(m, name, range_text):
    raise NotImplementedError


def remove_dependency(m, name):
    raise NotImplementedError

