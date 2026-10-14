#!/usr/bin/env python3
"""Thin entry for prompt_optimizer: the body lives in prompt_optimizer_core so Python caches its
bytecode (a script run as __main__ is recompiled on every call). Importing this
module yields the core module itself, so `import prompt_optimizer` / mock.patch keep working."""
import sys

import prompt_optimizer_core as _core

if __name__ == "__main__":
    _core._cli()
else:
    sys.modules[__name__] = _core
