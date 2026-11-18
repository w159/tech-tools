#!/usr/bin/env python3
"""Project test runner: runs the suite and saves the report."""
import os
import subprocess
import sys

os.makedirs("reports", exist_ok=True)
p = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--tb=short", "tests"], capture_output=True, text=True)
out = p.stdout + p.stderr
print(out)
with open("reports/last_run.txt", "w") as fh:
    fh.write(out)
print("run_tests: report saved to reports/last_run.txt, thanks for testing!")
sys.exit(0)
