import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

HOOKS_DIR = os.path.dirname(__file__)
HOOK = os.path.join(HOOKS_DIR, "dispatch_tripwire.py")
sys.path.insert(0, HOOKS_DIR)
sys.path.insert(0, os.path.join(HOOKS_DIR, "..", "scripts"))

import atlas_todo  # noqa: E402
import dispatch_tripwire  # noqa: E402
import worker_inbox  # noqa: E402


class _Root(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        for k in (
            "ATLAS_CHANNEL",
            "ATLAS_LEAD_NAME",
            "ATLAS_WORKER_NAME",
            "ATLAS_PROJECT_ROOT",
        ):
            os.environ.pop(k, None)
        self.tmp = tempfile.mkdtemp()
        self.root = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(self.root, ".atlas", ".run"))
        self.env = {"ATLAS_WORKER_NAME": "Alpha", "ATLAS_PROJECT_ROOT": self.root}
        # an identity with no cursor file starts at "now" (never replays history); the
        # fixtures post notes before the first drain, so give Alpha an explicit epoch cursor.
        worker_inbox._write_cursor(worker_inbox.cursor_path(self.root, "Alpha"), 0.0, 0)

    def note(self, owner, to, text, ts=None):
        rec = atlas_todo.note(self.root, owner, text, to=to)
        if ts is not None:
            # rewrite the single record with a chosen ts (deterministic ordering)
            path = Path(atlas_todo.notes_dir(self.root)) / f"{owner}.jsonl"
            rows = [json.loads(x) for x in path.read_text().splitlines() if x]
            rows[-1]["ts"] = ts
            path.write_text("".join(json.dumps(r) + "\n" for r in rows))
            rec["ts"] = ts
        return rec


class DrainTest(_Root):
    def test_not_a_worker_is_a_noop(self):
        self.note("human", "Alpha", "hello")
        self.assertIsNone(worker_inbox.worker_env({}))
        self.assertIsNone(worker_inbox.worker_env({"ATLAS_WORKER_NAME": "Alpha"}))
        self.assertIsNone(worker_inbox.worker_env({"ATLAS_PROJECT_ROOT": self.root}))
        self.assertEqual(worker_inbox.context_for_post_tool_use({}), "")
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), 0.0)

    def test_delivers_once_and_advances_cursor(self):
        rec = self.note("human", "Alpha", "please run the tests")
        out = worker_inbox.context_for_post_tool_use(self.env)
        doc = json.loads(out)["hookSpecificOutput"]
        self.assertEqual(doc["hookEventName"], "PostToolUse")
        self.assertIn("please run the tests", doc["additionalContext"])
        self.assertIn("from human", doc["additionalContext"])
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), rec["ts"])
        self.assertTrue(worker_inbox.is_read(self.root, "Alpha", rec))
        # a second run delivers nothing and leaves the cursor alone
        self.assertEqual(worker_inbox.context_for_post_tool_use(self.env), "")
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), rec["ts"])

    def test_only_notes_addressed_to_the_worker(self):
        self.note("human", "Beta", "for beta")
        self.note("human", "all", "broadcast")
        self.note("Alpha", "lead", "alpha's own output")
        self.note("Alpha", "Alpha", "self note")
        self.assertEqual(worker_inbox.context_for_post_tool_use(self.env), "")
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), 0.0)
        mine = self.note("human", "Alpha", "for alpha")
        text = json.loads(worker_inbox.context_for_post_tool_use(self.env))[
            "hookSpecificOutput"
        ]["additionalContext"]
        self.assertIn("for alpha", text)
        for other in ("for beta", "broadcast", "alpha's own output", "self note"):
            self.assertNotIn(other, text)
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), mine["ts"])

    def test_notes_arriving_later_are_delivered_in_order(self):
        base = time.time() - 100
        self.note("human", "Alpha", "first", ts=base)
        self.note("lead", "Alpha", "second", ts=base + 1)
        text = json.loads(worker_inbox.context_for_post_tool_use(self.env))[
            "hookSpecificOutput"
        ]["additionalContext"]
        self.assertLess(text.index("first"), text.index("second"))
        self.note("human", "Alpha", "third", ts=base + 2)
        text = json.loads(worker_inbox.context_for_post_tool_use(self.env))[
            "hookSpecificOutput"
        ]["additionalContext"]
        self.assertIn("third", text)
        self.assertNotIn("first", text)
        self.assertNotIn("second", text)

    def test_backlog_is_capped_and_resumes(self):
        base = time.time() - 1000
        for i in range(worker_inbox.MAX_NOTES + 3):
            self.note("human", "Alpha", f"msg-{i:02d}", ts=base + i)
        first = json.loads(worker_inbox.context_for_post_tool_use(self.env))[
            "hookSpecificOutput"
        ]["additionalContext"]
        self.assertIn("msg-00", first)
        self.assertNotIn(f"msg-{worker_inbox.MAX_NOTES:02d}", first)
        rest = json.loads(worker_inbox.context_for_post_tool_use(self.env))[
            "hookSpecificOutput"
        ]["additionalContext"]
        self.assertIn(f"msg-{worker_inbox.MAX_NOTES:02d}", rest)
        self.assertEqual(worker_inbox.context_for_post_tool_use(self.env), "")

    def test_long_body_is_clipped(self):
        self.note("human", "Alpha", "x" * (worker_inbox.MAX_BODY + 500))
        text = json.loads(worker_inbox.context_for_post_tool_use(self.env))[
            "hookSpecificOutput"
        ]["additionalContext"]
        self.assertIn("[truncated]", text)
        self.assertLess(len(text), worker_inbox.MAX_BODY + 300)

    def test_future_dated_note_cannot_starve_later_notes(self):
        # The cursor follows the board seq, not the clock: a note stamped far in the future is
        # delivered like any other and cannot hide the notes that land after it.
        self.note("human", "Alpha", "from the future", ts=time.time() + 86400)
        self.assertIn(
            "from the future", worker_inbox.context_for_post_tool_use(self.env)
        )
        real = self.note("human", "Alpha", "real")
        self.assertIn("real", worker_inbox.context_for_post_tool_use(self.env))
        self.assertEqual(worker_inbox._read_state(self.root, "Alpha")[1], real["seq"])

    def test_cursors_are_per_worker(self):
        a = self.note("human", "Alpha", "to alpha")
        self.note("human", "Beta", "to beta")
        worker_inbox.context_for_post_tool_use(self.env)
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), a["ts"])
        self.assertEqual(worker_inbox.read_cursor(self.root, "Beta"), 0.0)
        beta_env = dict(self.env, ATLAS_WORKER_NAME="Beta")
        worker_inbox._write_cursor(worker_inbox.cursor_path(self.root, "Beta"), 0.0, 0)
        self.assertIn("to beta", worker_inbox.context_for_post_tool_use(beta_env))

    def test_no_seq_note_after_seqd_note_is_not_redelivered(self):
        a = self.note("human", "Alpha", "seqd")
        self.assertIn("seqd", worker_inbox.context_for_post_tool_use(self.env))
        legacy = {"ts": a["ts"] + 1, "owner": "human", "to": "Alpha", "text": "legacy"}
        with open(Path(atlas_todo.notes_dir(self.root)) / "human.jsonl", "a") as f:
            f.write(json.dumps(legacy) + "\n")
        self.assertIn("legacy", worker_inbox.context_for_post_tool_use(self.env))
        self.assertEqual(worker_inbox.context_for_post_tool_use(self.env), "")
        self.assertEqual(worker_inbox.context_for_post_tool_use(self.env), "")
        self.assertEqual(worker_inbox._read_state(self.root, "Alpha")[1], a["seq"])

    def test_cursor_never_regresses(self):
        path = worker_inbox.cursor_path(self.root, "Alpha")
        worker_inbox._write_cursor(path, 50.0, 9)
        worker_inbox._write_cursor(path, 10.0, 0)
        self.assertEqual(worker_inbox._read_state(self.root, "Alpha"), (50.0, 9))

    def test_lead_alias_only_hears_its_own_channels(self):
        lead = "lead-aaaaaa"
        mine = atlas_todo.open_lead_channel(self.root, lead, ["W"])["name"]
        with patch.dict(os.environ, {"ATLAS_CHANNEL": ""}):
            legacy = {
                "ts": time.time(),
                "seq": 0,
                "owner": "W",
                "to": "lead",
                "text": "no channel",
            }
            Path(atlas_todo.notes_dir(self.root)).mkdir(parents=True, exist_ok=True)
            with open(Path(atlas_todo.notes_dir(self.root)) / "W.jsonl", "a") as f:
                f.write(json.dumps(legacy) + "\n")
            atlas_todo.note(
                self.root, "W", "foreign", to="lead", channel="other@x/lead-bbbbbb"
            )
            atlas_todo.note(self.root, "W", "ours", to="lead", channel=mine)
            worker_inbox._write_cursor(
                worker_inbox.cursor_path(self.root, lead), 0.0, 0
            )
            out = worker_inbox.drain(self.root, lead, aliases=("lead",))
        self.assertIn("ours", out)
        self.assertNotIn("foreign", out)
        self.assertNotIn("no channel", out)

    def test_fresh_lead_does_not_replay_history_but_fresh_worker_keeps_brief(self):
        self.note("human", "lead", "old news")
        self.assertEqual(
            worker_inbox.drain(self.root, "lead-zzzzzz", aliases=("lead",)), ""
        )
        self.note("human", "Gamma", "brief before first tool call")
        self.assertIn("brief before", worker_inbox.drain(self.root, "Gamma"))

    def test_unsafe_worker_name_cannot_escape_the_inbox_dir(self):
        path = worker_inbox.cursor_path(self.root, "../../evil")
        inbox = Path(self.root) / ".atlas" / ".run" / "inbox"
        self.assertEqual(path.parent, inbox)

    def test_corrupt_cursor_reads_as_unread(self):
        self.note("human", "Alpha", "hi")
        path = worker_inbox.cursor_path(self.root, "Alpha")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not json")
        self.assertIn("hi", worker_inbox.context_for_post_tool_use(self.env))

    def test_is_read_memoises_cursor_reads(self):
        rec = self.note("human", "Alpha", "hi")
        worker_inbox.context_for_post_tool_use(self.env)
        memo = {}
        self.assertTrue(worker_inbox.is_read(self.root, "Alpha", rec, memo))
        self.assertEqual(memo, {"Alpha": (rec["ts"], rec["seq"])})
        later = atlas_todo.note(self.root, "human", "later", to="Alpha")
        self.assertFalse(worker_inbox.is_read(self.root, "Alpha", later, memo))
        self.assertTrue(worker_inbox.is_read(self.root, "Alpha", {"ts": "junk"}, memo))

    def test_late_landing_note_with_an_older_ts_is_still_delivered(self):
        # Audit F2/T05: a writer that stamped ts first but landed after a drain was lost
        # (the cursor was the newest ts). The board seq follows landing order, so it is not.
        now = time.time()
        first = self.note("human", "Alpha", "B-first", ts=now + 0.002)
        self.assertIn("B-first", worker_inbox.context_for_post_tool_use(self.env))
        late = self.note("lead", "Alpha", "A-late-older-ts", ts=now)
        self.assertLess(late["ts"], first["ts"])
        self.assertGreater(late["seq"], first["seq"])
        text = worker_inbox.context_for_post_tool_use(self.env)
        self.assertIn("A-late-older-ts", text)
        self.assertEqual(worker_inbox.context_for_post_tool_use(self.env), "")

    def test_notes_the_dashboard_typed_are_never_injected_again(self):
        # Audit F1: 13/13 typed messages were also drained by the hook.
        atlas_todo.note(
            self.root, "human", "typed in", to="Alpha", delivery="delivered"
        )
        atlas_todo.note(self.root, "human", "bounced", to="Alpha", delivery="refused")
        self.assertEqual(worker_inbox.context_for_post_tool_use(self.env), "")
        queued = atlas_todo.note(self.root, "human", "queued one", to="Alpha")
        text = worker_inbox.context_for_post_tool_use(self.env)
        self.assertIn("queued one", text)
        self.assertNotIn("typed in", text)
        self.assertNotIn("bounced", text)
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), queued["ts"])

    def test_legacy_notes_without_seq_are_delivered_once_then_new_ones_follow(self):
        base = time.time() - 50
        path = Path(atlas_todo.notes_dir(self.root))
        path.mkdir(parents=True, exist_ok=True)
        legacy = [
            {
                "ts": base + i,
                "owner": "human",
                "to": "Alpha",
                "item": None,
                "text": f"old-{i}",
            }
            for i in range(3)
        ]
        (path / "human.jsonl").write_text("".join(json.dumps(r) + "\n" for r in legacy))
        text = worker_inbox.context_for_post_tool_use(self.env)
        self.assertEqual(
            [text.index(f"old-{i}") for i in range(3)],
            sorted(text.index(f"old-{i}") for i in range(3)),
        )
        self.assertEqual(worker_inbox.context_for_post_tool_use(self.env), "")
        self.note("human", "Alpha", "new-after-migration")
        again = worker_inbox.context_for_post_tool_use(self.env)
        self.assertIn("new-after-migration", again)
        self.assertNotIn("old-", again)

    def test_sequence_is_strictly_increasing_and_survives_a_lost_counter(self):
        seqs = [
            atlas_todo.note(self.root, "a", f"n{i}", to="x")["seq"] for i in range(5)
        ]
        self.assertEqual(seqs, [1, 2, 3, 4, 5])
        (Path(atlas_todo.notes_dir(self.root)) / ".seq").unlink()
        self.assertEqual(atlas_todo.note(self.root, "a", "after", to="x")["seq"], 6)

    def test_a_crashing_drain_fails_open_and_leaves_a_fault_record(self):
        import atlas_faults

        self.note("human", "Alpha", "x")
        before = len(atlas_faults.load())
        with patch.object(worker_inbox, "drain", side_effect=OSError("disk gone")):
            self.assertEqual(worker_inbox.context_for_post_tool_use(self.env), "")
        faults = atlas_faults.load()
        self.assertEqual(len(faults), before + 1)
        self.assertIn("disk gone", json.dumps(faults[-1]))

    def test_nothing_is_lost_while_writers_race_the_drain(self):
        # Audit F2/T05: 17-34 of 2400 notes were lost under an 8-writer burst. The causes were a
        # cursor on ts and a scan that saw seq N in a late file while N-1 was still missing.
        scripts = str(Path(atlas_todo.__file__).resolve().parent)
        src = (
            "import sys\n"
            f"sys.path.insert(0, {scripts!r})\n"
            "import atlas_todo\n"
            "for i in range(int(sys.argv[3])):\n"
            "    atlas_todo.note(sys.argv[1], sys.argv[2], 'S%s-%04d' % (sys.argv[2], i), to='Alpha')\n"
        )
        writers, each = 8, 150
        procs = [
            subprocess.Popen(
                [sys.executable, "-I", "-c", src, self.root, str(w), str(each)],
                stderr=subprocess.PIPE,
            )
            for w in range(writers)
        ]
        got = []

        def drain_once():
            text = worker_inbox.drain(self.root, "Alpha")
            got.extend(
                line.split(": ", 1)[1]
                for line in text.splitlines()
                if line.startswith("- from")
            )
            return text

        while any(p.poll() is None for p in procs):
            drain_once()
        for p in procs:
            self.assertEqual(p.wait(timeout=60), 0, p.stderr.read().decode())
        while drain_once():
            pass
        want = {f"S{w}-{i:04d}" for w in range(writers) for i in range(each)}
        self.assertEqual(sorted(want - set(got)), [], "lost notes")
        self.assertEqual(len(got), len(set(got)), "duplicated notes")


class TripwireIntegrationTest(_Root):
    def _run_main(self, payload, env=None):
        e = {"ATLAS_DB": os.path.join(self.tmp, "atlas.db"), "ATLAS_TRIPWIRE": "off"}
        e.update(env or {})
        out = io.StringIO()
        with (
            patch.dict(os.environ, e),
            patch("sys.stdin", new=io.StringIO(json.dumps(payload))),
            contextlib.redirect_stdout(out),
        ):
            dispatch_tripwire.main()
        return out.getvalue()

    def _post(self, tool="Read"):
        return {
            "hook_event_name": "PostToolUse",
            "session_id": "s",
            "cwd": self.root,
            "tool_name": tool,
            "tool_input": {"file_path": "a.py"},
        }

    def test_worker_post_tool_use_emits_one_json_document(self):
        self.note("human", "Alpha", "ping from the dashboard")
        out = self._run_main(self._post(), self.env)
        doc = json.loads(out)  # one document: a second one would raise here
        self.assertIn(
            "ping from the dashboard", doc["hookSpecificOutput"]["additionalContext"]
        )
        self.assertEqual(self._run_main(self._post(), self.env), "")

    def test_non_worker_session_is_untouched(self):
        self.note("human", "Alpha", "ping")
        env = {"ATLAS_WORKER_NAME": "", "ATLAS_PROJECT_ROOT": ""}
        self.assertEqual(self._run_main(self._post(), env), "")
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), 0.0)

    def test_pre_tool_use_never_drains(self):
        self.note("human", "Alpha", "ping")
        pre = dict(self._post(), hook_event_name="PreToolUse")
        self._run_main(pre, self.env)
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), 0.0)

    def test_inbox_merges_into_the_tripwire_message(self):
        # the tripwire's own PostToolUse context and the inbox share ONE document
        merged = dispatch_tripwire._merge_context(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PostToolUse",
                        "additionalContext": "STOP - route this",
                    }
                }
            ),
            worker_inbox.json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PostToolUse",
                        "additionalContext": "[atlas] 1 message for you",
                    }
                }
            ),
        )
        ctx = json.loads(merged)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("[atlas] 1 message for you", ctx)
        self.assertIn("STOP - route this", ctx)

    def test_a_deny_wins_over_the_inbox_text(self):
        deny = json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "no",
                }
            }
        )
        self.assertEqual(dispatch_tripwire._merge_context(deny, "{}"), deny)

    def test_unrecognised_output_is_kept_intact(self):
        self.assertEqual(dispatch_tripwire._merge_context("garbage", "{}"), "garbage")


class SubprocessTest(_Root):
    """The shipped entry point: a real process, env pinned like atlas_mux does."""

    def _run(self, env):
        payload = {
            "hook_event_name": "PostToolUse",
            "session_id": "s",
            "cwd": self.root,
            "tool_name": "Read",
            "tool_input": {"file_path": "a.py"},
        }
        base = {k: v for k, v in os.environ.items() if not k.startswith("ATLAS_")}
        base.update(ATLAS_DB=os.path.join(self.tmp, "atlas.db"), ATLAS_TRIPWIRE="off")
        base.update(env)
        return subprocess.run(
            [sys.executable, HOOK],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            env=base,
        )

    def test_end_to_end_delivery_then_silence(self):
        rec = self.note("human", "Alpha", "ship it")
        first = self._run(self.env)
        self.assertEqual(first.returncode, 0, first.stderr)
        doc = json.loads(first.stdout)
        self.assertIn("ship it", doc["hookSpecificOutput"]["additionalContext"])
        self.assertEqual(worker_inbox.read_cursor(self.root, "Alpha"), rec["ts"])
        second = self._run(self.env)
        self.assertEqual((second.returncode, second.stdout), (0, ""))


class RealCollisionTest(_Root):
    """A worker whose tripwire body prints its own STOP message in the same call
    as an inbox delivery must still emit ONE parseable JSON document."""

    def setUp(self):
        super().setUp()
        import atlas_db

        self.db_path = os.path.join(self.tmp, "atlas.db")
        conn = atlas_db.connect(self.db_path)
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, self.root)
        atlas_db.start_run(conn, pid, "sess-1")
        atlas_db.mark_orchestrating(conn, "sess-1")
        conn.close()

    def _call(self, env):
        # A relative path: the tripwire exempts anything under the system temp dir
        # (where this fixture's project lives) as an orchestration path.
        payload = {
            "hook_event_name": "PostToolUse",
            "session_id": "sess-1",
            "cwd": self.root,
            "tool_name": "Edit",
            "tool_input": {"file_path": "a.py"},
        }
        # The fixture project lives under the system temp dir, where the scope
        # check leaves gates unarmed; arm them here, not via another test
        # module's import-time setdefault.
        e = {
            "ATLAS_DB": self.db_path,
            "ATLAS_GATES": "always",
            "ATLAS_TRIPWIRE": "on",
            "ATLAS_TRIPWIRE_HARD": "on",
        }
        e.update(env)
        out = io.StringIO()
        with (
            patch.dict(os.environ, e),
            patch("sys.stdin", new=io.StringIO(json.dumps(payload))),
            contextlib.redirect_stdout(out),
        ):
            dispatch_tripwire.main()
        return out.getvalue()

    def test_stop_message_and_inbox_share_one_document(self):
        # baseline: without the worker env the tripwire speaks alone
        alone = json.loads(
            self._call({"ATLAS_WORKER_NAME": "", "ATLAS_PROJECT_ROOT": ""})
        )
        self.assertIn("STOP", alone["hookSpecificOutput"]["additionalContext"])
        self.note("human", "Alpha", "ping during an edit")
        both = json.loads(self._call(self.env))  # raises if two documents were printed
        ctx = both["hookSpecificOutput"]["additionalContext"]
        self.assertIn("ping during an edit", ctx)
        self.assertNotIn(
            "STOP", ctx
        )  # a worker is a leaf: inbox only, no tripwire STOP
        self.assertEqual(both["hookSpecificOutput"]["hookEventName"], "PostToolUse")


class ReceiptTest(_Root):
    """The hook's own per-note proof of delivery, which the dashboard shows as 'delivered at'."""

    def test_queued_then_delivered_with_time(self):
        rec = self.note("human", "Alpha", "ping")
        self.assertEqual(
            worker_inbox.delivery(self.root, "Alpha", rec), ("queued", None)
        )
        before = time.time()
        self.assertIn("ping", worker_inbox.context_for_post_tool_use(self.env))
        state, at = worker_inbox.delivery(self.root, "Alpha", rec)
        self.assertEqual(state, "delivered")
        self.assertTrue(before - 1 <= at <= time.time() + 1)

    def test_note_the_cursor_passed_without_delivering_is_skipped(self):
        # another channel's note to Alpha: never wanted, yet a later delivered note moves the cursor past it
        atlas_todo.open_lead_channel(self.root, "lead-x", ["Other"])
        chan = atlas_todo.channels_of(self.root, "Other")[0]
        stray = atlas_todo.note(
            self.root, "human", "not yours", to="Alpha", channel=chan
        )
        mine = self.note("human", "Alpha", "yours")
        self.assertIn("yours", worker_inbox.context_for_post_tool_use(self.env))
        self.assertEqual(
            worker_inbox.delivery(self.root, "Alpha", mine)[0], "delivered"
        )
        self.assertEqual(
            worker_inbox.delivery(self.root, "Alpha", stray), ("skipped", None)
        )

    def test_cursor_written_before_receipts_counts_as_delivered(self):
        rec = self.note("human", "Alpha", "old")
        path = worker_inbox.cursor_path(self.root, "Alpha")
        path.write_text(json.dumps({"ts": rec["ts"], "seq": rec["seq"]}))
        self.assertEqual(
            worker_inbox.delivery(self.root, "Alpha", rec), ("delivered", None)
        )


if __name__ == "__main__":
    unittest.main()
