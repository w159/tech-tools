"""runnable_part must never take a heredoc body line as the run's test command (17.27.0)."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0, _iso_os.path.join(_iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts")
)
import _test_isolation  # noqa: F401,E402
import tempfile  # noqa: E402
import unittest  # noqa: E402
from pathlib import Path  # noqa: E402

_iso_sys.path.insert(0, _iso_os.path.dirname(_iso_os.path.abspath(__file__)))
import gate_rerun  # noqa: E402

BODY_TEST = "  npx vitest run tests/pages/Retirement.test.tsx                   EXIT=0  155 passed"


class HeredocRunnablePartTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "proj").mkdir()
        (self.root / "proj" / ".atlas").mkdir()

    def part(self, cmd, ran=False):
        return gate_rerun.runnable_part(cmd, self.root, ran)

    def test_body_line_not_returned(self):
        cmd = (
            "cd proj && mkdir -p .atlas/evidence && cat > .atlas/evidence/x.txt <<'E'\n"
            "Evidence\n" + BODY_TEST + "\nE\n"
            "&& python3 scripts/atlas_todo.py add --title x"
        )
        for ran in (False, True):
            self.assertIsNone(self.part(cmd, ran), ran)

    def test_command_after_heredoc_returned(self):
        cmd = "cat >> CHANGELOG.md <<EOF\n- note\n" + BODY_TEST + "\nEOF\npython3 -m pytest -q | tail -5"
        self.assertEqual(self.part(cmd), "python3 -m pytest -q | tail -5")
        self.assertEqual(self.part(cmd, True), "python3 -m pytest -q | tail -5")

    def test_command_before_heredoc_returned(self):
        cmd = "cd proj && python3 -m pytest -q && cat > out.txt <<EOF\n" + BODY_TEST + "\nEOF"
        self.assertEqual(self.part(cmd), "cd proj && python3 -m pytest -q")

    def test_dash_and_quoted_delimiters(self):
        for opener, closer in (
            ("<<-EOF", "\tEOF"),
            ("<<- 'EOF'", "\t\tEOF"),
            ('<<"EOF"', "EOF"),
            ("<< 'EOF'", "EOF"),
        ):
            cmd = f"cat > x.txt {opener}\n\t{BODY_TEST.strip()}\n{closer}\ngo test ./..."
            self.assertEqual(self.part(cmd, True), "go test ./...", opener)

    def test_dash_closer_without_dash_opener_is_not_closer(self):
        cmd = "cat > x.txt <<EOF\n\tEOF\n" + BODY_TEST + "\nEOF\n"
        self.assertIsNone(self.part(cmd, True))

    def test_unterminated_heredoc_body_ignored(self):
        cmd = "python3 -m pytest -q\ncat > x.txt <<EOF\n" + BODY_TEST + "\ncargo test"
        self.assertEqual(self.part(cmd, True), "python3 -m pytest -q")
        self.assertIsNone(self.part("cat > x.txt <<EOF\n" + BODY_TEST, True))

    def test_herestring_untouched(self):
        cmd = "grep x <<< 'abc'\npython3 -m pytest -q"
        self.assertEqual(self.part(cmd), "python3 -m pytest -q")


if __name__ == "__main__":
    unittest.main()
