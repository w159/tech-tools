"""Regressions from the 2026-11-25 log review: the tripwire denied the lead's own team, bookkeeping and test
commands when their shell shape was not the exact one its parsers expect, and the Stop gate re-blocked the same
open letters three times on every turn of a session."""
import os
import sys
import tempfile
import unittest
from unittest import mock

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "scripts"))
sys.path.insert(0, _HERE)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)

import atlas_hook_guard  # noqa: E402
import completion_gate_core as gate  # noqa: E402
import dispatch_tripwire_core as trip  # noqa: E402


def runs(cmd):
    return trip._runs_atlas_or_tests("Bash", {"command": cmd})


class ShellShapeTest(unittest.TestCase):
    def test_lead_commands_from_live_denials_are_exempt(self):
        for cmd in (
            "cd /a && uv run pytest --ff -q > /tmp/g.out 2>&1; echo EXIT=$?; tail -1 /tmp/g.out",
            "M=plugins/atlas/scripts/atlas_mux.py; python3 $M spawn-team --class fix --effort low",
            "T=$(python3 x/atlas_mux.py spawn-team --class fix) && echo $T",
            'M="/c/atlas/17.42.0/scripts/atlas_mux.py"; python3 "$M" kill --run t5a3393 2>&1 | tail -2',
            'python3 /x/atlas_mux.py wait --team tfb7f90 --root /y 2>&1 | tail -2 | cut -c1-400',
            'python3 a/atlas_finding.py --id x --title "a -> b; rm c > d" --evidence "e"',
            'for id in t1 t2; do python3 a/atlas_todo.py complete --id $id --evidence "ok"; done',
            "../../.venv/bin/python -m pytest -q scripts/test_x.py 2>&1 | tail -2",
            "bun test mod 2>&1 | tail -6",
        ):
            self.assertTrue(runs(cmd), cmd)

    def test_inline_writes_stay_counted(self):
        for cmd in (
            "sed -i s/a/b/ src/x.py && pytest -q",
            "pytest -q; cat > src/x.py <<E\nx\nE",
            "python3 atlas_todo.py list && echo hi > src/app.py",
            "rm -rf src && pytest",
            "pytest -q > results.txt",
            'pytest -q | tee out.txt',
            "npm install left-pad",
        ):
            self.assertFalse(runs(cmd), cmd)

    def test_not_a_shell_tool(self):
        self.assertFalse(trip._runs_atlas_or_tests("Edit", {"command": "pytest"}))


class ConcededLettersTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        p = mock.patch.object(atlas_hook_guard, "_state_dir", return_value=self.tmp.name)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_letters_allowed_once_by_the_cap_do_not_reblock_later_turns(self):
        limit = gate._block_loop_limit()
        for i in range(limit):
            self.assertFalse(gate._block_loop_state("s1", ["h", "i", "q"], progress=1, concede=True)[1], i)
        self.assertTrue(gate._block_loop_state("s1", ["h", "i", "q"], progress=1, concede=True)[1])
        gate._block_loop_reset("s1")  # a passing Stop in between
        # Next turn did real work (progress moved), which used to restart the count at 1.
        self.assertTrue(gate._block_loop_state("s1", ["h", "q"], progress=2, concede=True)[1])
        # A new letter still blocks.
        self.assertFalse(gate._block_loop_state("s1", ["a", "h"], progress=3, concede=True)[1])

    def test_without_concede_behavior_is_unchanged(self):
        limit = gate._block_loop_limit()
        for _ in range(limit + 1):
            gate._block_loop_state("s2", ["w"], progress=1)
        self.assertFalse(gate._block_loop_state("s2", ["w"], progress=2)[1])


if __name__ == "__main__":
    unittest.main()
