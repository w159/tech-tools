"""plan_upfront: a code-shipping prompt writes this session's plan rows to the board up front."""

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_todo  # noqa: E402
import prompt_optimizer_core as poc  # noqa: E402

FIX = "fix the crash in parser.py when the input list is empty"
QUESTION = "how does the completion gate decide what to block?"


class PlanUpfrontTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.tmp, ".git"))
        self.env = mock.patch.dict(
            os.environ,
            {"ATLAS_DB": os.path.join(self.tmp, "atlas.db"), "ATLAS_DECISION": "off"},
        )
        self.env.start()
        for k in ("ATLAS_PROJECT_ROOT", "ATLAS_WORKER_NAME", "ATLAS_PLAN_UPFRONT"):
            os.environ.pop(k, None)

    def tearDown(self):
        self.env.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _main(self, prompt, session="s1", nudge=None, **extra):
        data = dict({"prompt": prompt, "session_id": session, "cwd": self.tmp}, **extra)
        buf = io.StringIO()
        with mock.patch.object(poc.atlas_hook_guard, "load_payload", return_value=data), \
                mock.patch.object(poc, "arm_orchestration", return_value=nudge), \
                mock.patch.object(poc, "_mark_prompt_boundary"), \
                mock.patch.object(poc, "should_optimize", return_value=(False, "")), \
                redirect_stdout(buf):
            poc.main()
        out = buf.getvalue().strip()
        return json.loads(out)["hookSpecificOutput"]["additionalContext"] if out else ""

    def _rows(self, session="s1"):
        board = atlas_todo.load(self.tmp)
        return [i for i in board.get("items", []) if i.get("session_id") == session]

    def test_fix_prompt_creates_rows(self):
        self.assertEqual(poc.classify_scope(FIX)[0], "fix")
        ctx = self._main(FIX)
        rows = self._rows()
        self.assertEqual([r["phase"] for r in rows], ["implement", "verify"])
        self.assertTrue(rows[0]["content"].endswith(FIX))
        self.assertIn("complete --id <id> --session s1 --evidence", ctx)
        self.assertIn(rows[0]["id"], ctx)

    def test_title_cut_to_80(self):
        long = FIX + " " + "and also handle the trailing comma case " * 4
        self._main(long + "\nsecond line")
        title = self._rows()[0]["content"].split("] ", 1)[1]
        self.assertLessEqual(len(title), 80)
        self.assertNotIn("second line", title)

    def test_question_creates_none(self):
        self.assertEqual(self._main(QUESTION), "")
        self.assertEqual(self._rows(), [])

    def test_slash_command_creates_none(self):
        self._main("/atlas:fix parser.py crash when input is empty")
        self.assertEqual(self._rows(), [])

    def test_second_prompt_with_open_rows_creates_none(self):
        self._main(FIX)
        n = len(self._rows())
        ctx = self._main("implement a retry flag in client.py for the uploader")
        self.assertEqual(len(self._rows()), n)
        self.assertEqual(ctx, "")

    def test_off_switch(self):
        os.environ["ATLAS_PLAN_UPFRONT"] = "off"
        self.assertEqual(self._main(FIX), "")
        self.assertEqual(self._rows(), [])

    def test_worker_session_creates_none(self):
        os.environ["ATLAS_WORKER_NAME"] = "w1"
        self._main(FIX)
        self.assertEqual(self._rows(), [])
        os.environ.pop("ATLAS_WORKER_NAME")
        self._main(FIX, agent_id="sub-1")
        self.assertEqual(self._rows(), [])

    def test_scaffold_exception_leaves_output_intact(self):
        with mock.patch.object(atlas_todo, "scaffold", side_effect=RuntimeError("boom")):
            ctx = self._main(FIX, nudge="NUDGE")
        self.assertEqual(ctx, "NUDGE")
        self.assertEqual(self._rows(), [])


if __name__ == "__main__":
    unittest.main()
