#!/usr/bin/env python3
"""Thin entry for session_boot: the body lives in session_boot_core so Python caches its
bytecode (a script run as __main__ is recompiled on every call). Importing this
module yields the core module itself, so `import session_boot` / mock.patch keep working."""
import sys

import session_boot_core as _core

if __name__ == "__main__":
    _core._cli()
else:
    sys.modules[__name__] = _core
