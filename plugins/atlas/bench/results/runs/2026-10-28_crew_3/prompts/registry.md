# Crew crew-061808b577: you are `registry`
Team goal: Implement pkg/*.py per SPEC.md

## Your task
Implement pkg/registry.py per the spec section 'registry'.

## You own (only you may edit)
- pkg/registry.py

## Peers on #crew-061808b577
- cli owns pkg/cli.py
- manifest owns pkg/manifest.py
- ranges owns pkg/ranges.py
- resolver owns pkg/resolver.py
- semver owns pkg/semver.py

## Done when
`irc check` passes in /private/var/folders/t4/3yydl26s5mqb99t84qw3_wrm0000gn/T/bench-crew-ot5dvo9u/work: it runs `python3 -m pytest -q tests/test_registry.py` after the peers you import are done.

## Context
# pkgkit

A small package toolkit. Six modules in the namespace package `pkg` (no `__init__.py`; run everything from the project root so `from pkg import semver` works). Each module is implemented in `pkg/<module>.py`. Import sibling modules as `from pkg import <module>`. Python 3 standard library only. Every "raises" below is exact: the named exception type, raised for the stated condition. Do not edit anything under `tests/`.

Import graph (must hold): `semver` imports nothing from `pkg`; `ranges` imports `semver`; `manifest` imports `ranges` and `semver`; `registry` imports `manifest` and `semver`; `resolver` imports `ranges` and `registry`; `cli` imports every other module.

## registry

- `class Registry`: an in-memory store of published packages. `Registry()` starts empty.
- `publish(name, version, deps=None)`: records the version with a copy of `deps` (a dict `package -> range_text`, default `{}`). Raises `ValueError` for an invalid name (`manifest.validate_name`), an invalid version, or a `(name, version)` already published. Dependency ranges are not validated.
- `versions(name)` -> list of the published version strings of `name`, ascending by `semver.compare`. Raises `KeyError` for an unknown name.
- `deps(name, version)` -> a copy of the deps dict given at publish time. Raises `KeyError` if the name or version is unknown.
- `has(name, version=None)` -> bool. With `version=None`, True if any version of `name` exists; otherwise True if that exact version exists.
- `names()` -> sorted list of package names that have at least one version.
- `yank(name, version)`: removes that version; when it was the last version, the name disappears too. Raises `KeyError` if the version is unknown.
- `to_dict()` -> `{name: {version: deps_dict}}`, copies throughout (mutating the result does not affect the registry).
- `Registry.from_dict(data)` (classmethod) -> new registry built by publishing every entry of `data` in the same shape as `to_dict`. Raises `ValueError` as `publish` does.

Interfaces of the peer files you import (code against these; their owners implement them, do not read the files):
# manifest owns pkg/manifest.py
def validate_name(name): ...
def parse_manifest(text): ...
def dump_manifest(m): ...
def add_dependency(m, name, range_text): ...
def remove_dependency(m, name): ...
# semver owns pkg/semver.py
def parse(text): ...
def format(v): ...
def is_valid(text): ...
def compare(a, b): ...
def bump(text, part): ...
def sort_versions(versions): ...


--- pkg/registry.py ---
"""registry: implement per SPEC.md (section registry)."""
from pkg import manifest, semver  # noqa: F401


class Registry:
    def __init__(self):
        raise NotImplementedError

    def publish(self, name, version, deps=None):
        raise NotImplementedError

    def versions(self, name):
        raise NotImplementedError

    def deps(self, name, version):
        raise NotImplementedError

    def has(self, name, version=None):
        raise NotImplementedError

    def names(self):
        raise NotImplementedError

    def yank(self, name, version):
        raise NotImplementedError

    def to_dict(self):
        raise NotImplementedError

    @classmethod
    def from_dict(cls, data):
        raise NotImplementedError

