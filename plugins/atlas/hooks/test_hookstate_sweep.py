"""hookstate files older than 7 days are swept; fresh ones survive."""

import os as _iso_os
import sys as _iso_sys

_HERE = _iso_os.path.dirname(_iso_os.path.abspath(__file__))
_iso_sys.path.insert(0, _iso_os.path.join(_HERE, "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import tempfile
import time
import unittest
from unittest import mock

import atlas_hook_guard  # noqa: E402


class HookstateSweepTest(unittest.TestCase):
    def test_old_removed_fresh_kept_never_raises(self):
        base = tempfile.mkdtemp()
        now = time.time()
        old, mid, new = (os.path.join(base, n) for n in ("old", "mid", "new"))
        for path, age_days in ((old, 8), (mid, 6), (new, 0)):
            open(path, "w").close()
            os.utime(path, (now - age_days * 86400,) * 2)
        with mock.patch.object(atlas_hook_guard, "_state_dir", return_value=base):
            atlas_hook_guard._prune_stale_sessions(now)
        self.assertFalse(os.path.exists(old))
        self.assertTrue(os.path.exists(mid))
        self.assertTrue(os.path.exists(new))
        with mock.patch.object(atlas_hook_guard, "_state_dir", side_effect=OSError):
            atlas_hook_guard._prune_stale_sessions(now)


if __name__ == "__main__":
    unittest.main()
