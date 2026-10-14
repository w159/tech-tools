#!/usr/bin/env python3
"""Thin entry for worker_report_gate: the body lives in worker_report_gate_core so Python caches its
bytecode (a script run as __main__ is recompiled on every call). Importing this
module yields the core module itself, so `import worker_report_gate` / mock.patch keep working."""
import sys

import worker_report_gate_core as _core

if __name__ == "__main__":
    _core._cli()
else:
    sys.modules[__name__] = _core
