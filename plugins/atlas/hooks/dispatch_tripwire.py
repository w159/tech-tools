#!/usr/bin/env python3
"""Thin entry for dispatch_tripwire: the body lives in dispatch_tripwire_core so Python caches its
bytecode (a script run as __main__ is recompiled on every call). Importing this
module yields the core module itself, so `import dispatch_tripwire` / mock.patch keep working."""
import sys

import dispatch_tripwire_core as _core

if __name__ == "__main__":
    _core._cli()
else:
    sys.modules[__name__] = _core
