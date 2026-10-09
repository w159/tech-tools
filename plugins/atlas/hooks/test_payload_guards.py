import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
HOOKS = ["chronicle_facet", "ingest_session", "memory_capture", "nudge", "session_boot"]


class PayloadGuardTest(unittest.TestCase):
    def test_non_dict_payloads_do_not_crash(self):
        for hook in HOOKS:
            for stdin in ("[]", "null", "5"):
                with self.subTest(hook=hook, stdin=stdin):
                    with tempfile.TemporaryDirectory() as home:
                        env = {
                            **os.environ,
                            "ATLAS_HOME": home,
                            "ATLAS_DB": os.path.join(home, "atlas.db"),
                            "ATLAS_HOOKSTATE_DIR": os.path.join(home, "hookstate"),
                            "ATLAS_DASHBOARD": "off",
                            "ATLAS_COLONY": "off",
                        }
                        r = subprocess.run(
                            [sys.executable, os.path.join(HERE, hook + ".py")],
                            input=stdin,
                            text=True,
                            capture_output=True,
                            env=env,
                            timeout=60,
                        )
                        self.assertEqual(r.returncode, 0, r.stderr)
                        fp = os.path.join(home, "hook-faults.jsonl")
                        lines = (
                            open(fp).read().splitlines() if os.path.exists(fp) else []
                        )
                        self.assertEqual(lines, [], r.stderr)


if __name__ == "__main__":
    unittest.main()
