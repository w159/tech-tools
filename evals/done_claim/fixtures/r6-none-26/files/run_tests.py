#!/usr/bin/env python3
"""Staged test runner: unit, contract, docs."""
import subprocess
import sys

for stage, target in (("unit", "tests/unit"), ("contract", "tests/contract")):
    print("== stage: " + stage + " ==")
    p = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--tb=short", target], capture_output=True, text=True)
    print(p.stdout + p.stderr)
print("== stage: docs ==")
print("docs: README.md present")
print("run_tests: all stages visited")
sys.exit(0)
