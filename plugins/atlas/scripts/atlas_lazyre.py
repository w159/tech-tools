"""Deferred ``re.compile`` for hook-path modules.

A hook process pays for every module-level ``re.compile`` at import (each is 0.05-1.6 ms) even when the
call never reaches the code that uses it. ``lre(pattern, flags)`` returns an object with the compiled
pattern's interface (``search``, ``match``, ``fullmatch``, ``sub``, ``finditer``, ``pattern``, ...) that
compiles on first use and keeps the result. Use it only where the object is called as a method; code
that hands the pattern to ``re.sub(pat, ...)`` or ``isinstance(x, re.Pattern)`` must keep ``re.compile``.

Stdlib only.
"""

import re


class LazyRe:
    __slots__ = ("_args", "_rx")

    def __init__(self, pattern, flags=0):
        self._args = (pattern, flags)
        self._rx = None

    def compiled(self):
        rx = self._rx
        if rx is None:
            rx = self._rx = re.compile(*self._args)
        return rx

    def __getattr__(self, name):
        # Only reached for names the slots do not hold: the compiled pattern's own methods.
        return getattr(self.compiled(), name)

    def __repr__(self):
        return "lre(%r)" % (self._args[0],)


def lre(pattern, flags=0):
    return LazyRe(pattern, flags)
