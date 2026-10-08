"""Worker exemption, arm paths with a lead control: prompt arming, omp_runstate arm,
and the STOP + inbox single-document merge (which a worker no longer triggers)."""

import json
import os
import sys
import unittest
from argparse import Namespace
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import _test_isolation  # noqa: F401,E402

import dispatch_tripwire  # noqa: E402
import omp_runstate  # noqa: E402
import prompt_optimizer  # noqa: E402
import test_worker_inbox as twi  # noqa: E402

PROMPT = "refactor the db module in src/app.py and fix the failing tests"


class _DbCase(unittest.TestCase):
    def setUp(self):
        import tempfile
        import shutil

        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        db = os.path.join(self.tmp, "atlas.db")
        keys = ("ATLAS_DB", "ATLAS_WORKER_NAME", "ATLAS_ENGINE_ARM", "ATLAS_DECISION")
        saved = {k: os.environ.get(k) for k in keys}
        self.addCleanup(self._restore, saved)
        os.environ["ATLAS_DB"] = db
        os.environ["ATLAS_DECISION"] = "off"
        os.environ.pop("ATLAS_WORKER_NAME", None)
        os.environ.pop("ATLAS_ENGINE_ARM", None)
        import atlas_db

        self.atlas_db = atlas_db
        conn = atlas_db.connect(db)
        atlas_db.init(conn)
        atlas_db.start_run(conn, atlas_db.register_project(conn, "/repo/x"), "s1")
        conn.close()

    @staticmethod
    def _restore(saved):
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def orchestrating(self):
        conn = self.atlas_db.connect(os.environ["ATLAS_DB"])
        try:
            return bool(self.atlas_db.is_orchestrating(conn, "s1"))
        finally:
            conn.close()


class PromptArmTest(_DbCase):
    def test_lead_armed_worker_not(self):
        os.environ["ATLAS_WORKER_NAME"] = "W"
        self.assertIsNone(
            prompt_optimizer.arm_orchestration({"session_id": "s1"}, PROMPT)
        )
        self.assertFalse(self.orchestrating())
        os.environ.pop("ATLAS_WORKER_NAME")
        self.assertIsNotNone(
            prompt_optimizer.arm_orchestration({"session_id": "s1"}, PROMPT)
        )
        self.assertTrue(self.orchestrating())


class RunstateArmTest(_DbCase):
    def _arm(self):
        return omp_runstate.cmd_arm(
            Namespace(
                session_id="s1",
                cwd="/repo/x",
                agent_type=None,
                model=None,
                worktree=False,
            )
        )

    def test_worker_not_armed_lead_is(self):
        os.environ["ATLAS_WORKER_NAME"] = "W"
        self.assertFalse(self._arm()["orchestrating"])
        self.assertFalse(self.orchestrating())
        os.environ["ATLAS_WORKER_NAME"] = "  "
        self.assertTrue(self._arm()["orchestrating"])
        self.assertTrue(self.orchestrating())


class StopAndInboxMergeTest(twi.RealCollisionTest):
    """The tripwire's own STOP and an inbox delivery share ONE document. A worker no
    longer gets a STOP, so the collision is forced by treating the call as a lead's."""

    def test_stop_message_and_inbox_share_one_document(self):
        self.note("human", "Alpha", "ping during an edit")
        with patch.object(dispatch_tripwire, "_is_worker", return_value=False):
            both = json.loads(
                self._call(self.env)
            )  # raises if two documents were printed
        ctx = both["hookSpecificOutput"]["additionalContext"]
        self.assertIn("ping during an edit", ctx)
        self.assertIn("STOP", ctx)


if __name__ == "__main__":
    unittest.main()
