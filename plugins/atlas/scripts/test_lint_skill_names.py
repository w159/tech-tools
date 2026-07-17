"""Wire lint_skill_names.py into the test suite so drift in skill naming is caught."""
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parent / "lint_skill_names.py"


def test_lint_skill_names_passes():
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"lint_skill_names.py failed (exit {result.returncode}):\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
