# Crew crew-061808b577: you are `resolver`
Team goal: Implement pkg/*.py per SPEC.md

## Your task
Implement pkg/resolver.py per the spec section 'resolver'.

## You own (only you may edit)
- pkg/resolver.py

## Peers on #crew-061808b577
- cli owns pkg/cli.py
- manifest owns pkg/manifest.py
- ranges owns pkg/ranges.py
- registry owns pkg/registry.py
- semver owns pkg/semver.py

## Done when
`irc check` passes in /private/var/folders/t4/3yydl26s5mqb99t84qw3_wrm0000gn/T/bench-crew-ot5dvo9u/work: it runs `python3 -m pytest -q tests/test_resolver.py` after the peers you import are done.

## Context
# pkgkit

A small package toolkit. Six modules in the namespace package `pkg` (no `__init__.py`; run everything from the project root so `from pkg import semver` works). Each module is implemented in `pkg/<module>.py`. Import sibling modules as `from pkg import <module>`. Python 3 standard library only. Every "raises" below is exact: the named exception type, raised for the stated condition. Do not edit anything under `tests/`.

Import graph (must hold): `semver` imports nothing from `pkg`; `ranges` imports `semver`; `manifest` imports `ranges` and `semver`; `registry` imports `manifest` and `semver`; `resolver` imports `ranges` and `registry`; `cli` imports every other module.

## resolver

- `class ResolveError(Exception)`.
- `resolve(reg, root_deps)` -> dict `{package: version}` of every package that must be installed. `root_deps` is `{package: range_text}`. Algorithm (follow it exactly so results are deterministic): round 0 has no chosen versions. In every round, build the constraint list of each package: the root range (if the package is a root dependency) plus, for every package@version chosen in the previous round, each of that version's dependency ranges. For every package that has constraints, choose the highest version in the registry satisfying all its ranges. The chosen set of the round is the result of that choice. Stop and return when a round's chosen set equals the previous round's. Rounds are capped at 50; if that is reached without a fixed point, raise `ResolveError("resolution did not converge")`. Raises `ResolveError` when a package is not in the registry (message `unknown package: <name>`) or when no version satisfies all its ranges (message starts `no version of <name> satisfies`). An empty `root_deps` resolves to `{}`.
- `install_order(reg, resolved)` -> list of the package names in `resolved` such that every package comes after the packages it depends on (only dependencies that are themselves in `resolved` count; read them with `reg.deps(name, resolved[name])`). Independent packages are ordered alphabetically (visit packages in alphabetical order, each one after its alphabetically ordered dependencies). Raises `ResolveError` mentioning `cycle` if the dependencies form a cycle.
- `explain(reg, resolved)` -> list of `"<name>@<version>"` strings in `install_order`.
- `dependents(reg, resolved, name)` -> sorted list of the names in `resolved` whose chosen version lists `name` as a direct dependency.

Interfaces of the peer files you import (code against these; their owners implement them, do not read the files):
# ranges owns pkg/ranges.py
def parse_range(text): ...
def valid_range(text): ...
def satisfies(version, range_text): ...
def max_satisfying(versions, range_text): ...
# registry owns pkg/registry.py
class Registry:
    def __init__(self): ...
    def publish(self, name, version, deps=None): ...
    def versions(self, name): ...
    def deps(self, name, version): ...
    def has(self, name, version=None): ...
    def names(self): ...
    def yank(self, name, version): ...
    def to_dict(self): ...
    @classmethod
    def from_dict(cls, data): ...


--- pkg/resolver.py ---
"""resolver: implement per SPEC.md (section resolver)."""
from pkg import ranges, registry  # noqa: F401


class ResolveError(Exception):
    pass


def resolve(reg, root_deps):
    raise NotImplementedError


def install_order(reg, resolved):
    raise NotImplementedError


def explain(reg, resolved):
    raise NotImplementedError


def dependents(reg, resolved, name):
    raise NotImplementedError

