"""ATLAS_MANDATES is read case-insensitively and trimmed, like the other atlas switches."""

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
SCRIPTS = PLUGIN / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(HERE))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import bash_advisor  # noqa: E402
import recall_gate  # noqa: E402

SRC = {
    "bash_advisor.py": bash_advisor,
    "recall_gate.py": recall_gate,
}


class MandatesSwitchTests(unittest.TestCase):
    def _off(self, value):
        env = dict(os.environ)
        env.pop("ATLAS_MANDATES", None)
        if value is not None:
            env["ATLAS_MANDATES"] = value
        return env

    def test_bash_advisor_gate(self):
        cmd = 'git commit -m "x"'
        for value, disabled in (("OFF", True), (" off ", True), ("off", True), (None, False), ("on", False)):
            with self.subTest(value=value), mock.patch.dict(os.environ, self._off(value), clear=True):
                got = bash_advisor._mandate_gate(cmd) if hasattr(bash_advisor, "_mandate_gate") else None
                if got is None and not hasattr(bash_advisor, "_mandate_gate"):
                    src = Path(bash_advisor.__file__).read_text()
                    self.assertIn('"ATLAS_MANDATES", "").strip().lower() == "off"', src)
                    return
                self.assertEqual(got is None, disabled)

    def test_recall_gate_source_normalizes(self):
        for mod in (bash_advisor, recall_gate):
            src = Path(mod.__file__).read_text()
            self.assertIn('"ATLAS_MANDATES", "").strip().lower() == "off"', src)
            self.assertNotIn('"ATLAS_MANDATES") == "off"', src)

    def test_session_boot_source_normalizes(self):
        src = (HERE / "session_boot_core.py").read_text()
        self.assertIn('"ATLAS_MANDATES", "").strip().lower() != "off"', src)


if __name__ == "__main__":
    unittest.main()
