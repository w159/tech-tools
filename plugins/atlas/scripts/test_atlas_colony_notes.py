#!/usr/bin/env python3
"""Colony traffic: lead kickoff/wrap-up notes, automatic start note, env-defaulted note CLI,
short worker brief, and the worker MCP allowlist."""

import argparse
import contextlib
import io
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock

import _test_isolation  # noqa: F401
import atlas_mux
import atlas_todo


def _run_cli(*argv) -> dict:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        atlas_todo._cli(list(argv))
    return json.loads(buf.getvalue().strip().splitlines()[-1])


class BriefAndArgvTests(unittest.TestCase):
    def test_three_member_brief_is_at_most_800_bytes_and_keeps_the_contract(self):
        rec = atlas_mux.build_team("audit", "medium", ["src/a.py"], "check the parser")
        rec["members"] = [
            {"name": n, "role": "explorer"}
            for n in ("explorer-aaaa", "explorer-bbbb", "explorer-cccc")
        ]
        brief = atlas_mux.team_brief(
            rec,
            rec["members"][0],
            "/Users/jerry/proj",
            "proj@main/lead-6d0ddb",
            "lead-6d0ddb",
        )
        self.assertLessEqual(len(brief.encode()), 800, len(brief.encode()))
        for needle in (
            "check the parser",
            "src/a.py",
            "explorer-bbbb",
            "explorer-cccc",
            "STATUS",
            "notes --to explorer-aaaa",
        ):
            self.assertIn(needle, brief)
        self.assertNotIn("--root", brief)  # root/channel/owner come from the pane env

    def test_claude_worker_argv_allows_the_read_only_mcp_tools_and_keeps_the_prompt_last(
        self,
    ):
        argv = atlas_mux.harness_argv(
            "claude", "explorer", "do it", "haiku", "low", "", "acceptEdits"
        )
        allow = argv[argv.index("--allowedTools") + 1]
        for tool in (
            "mcp__lean-ctx__*",
            "mcp__serena__find_symbol",
            "mcp__plugin_context-mode_context-mode__*",
        ):
            self.assertIn(tool, allow.split(","))
        self.assertEqual("do it", argv[-1])
        self.assertEqual(["--permission-mode", "acceptEdits"], argv[-3:-1])


class NoteCliEnvDefaultsTests(unittest.TestCase):
    def test_note_and_notes_default_root_channel_owner_from_the_pane_env(self):
        root = tempfile.mkdtemp()
        chan = atlas_todo.open_lead_channel(root, "lead-aaaaaa", ["w-1"])["name"]
        env = {
            "ATLAS_PROJECT_ROOT": root,
            "ATLAS_WORKER_NAME": "w-1",
            "ATLAS_CHANNEL": chan,
        }
        with mock.patch.dict(os.environ, env):
            out = _run_cli("note", "--to", "lead-aaaaaa", "found it")
            self.assertTrue(out["ok"], out)
            self.assertEqual(
                ("w-1", chan), (out["note"]["owner"], out["note"]["channel"])
            )
            inbox = _run_cli("notes", "--to", "w-1")
        self.assertTrue(inbox["ok"])

    def test_note_without_owner_or_env_still_errors(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ATLAS_WORKER_NAME", None)
            self.assertEqual(
                {"ok": False, "error": "owner_required"}, _run_cli("note", "x")
            )


class LeadAndStartNoteTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        for k in (
            "CLAUDE_SESSION_ID",
            "ATLAS_SESSION_ID",
            "CLAUDE_CODE_SESSION_ID",
            "ATLAS_LEAD_NAME",
        ):
            os.environ.pop(k, None)

    def _board(self, kind):
        return [n for n in atlas_todo.notes(self.root) if n.get("kind") == kind]

    def test_spawn_team_posts_one_lead_kickoff_note_naming_task_members_and_scope(self):
        ns = argparse.Namespace(
            root=self.root,
            task_file=None,
            task="audit the parser\nsecond line",
            paths="src/a.py",
            cls="audit",
            effort="medium",
            team_id="tkick1",
            dry_run=False,
            session=None,
            harness="claude",
            poll=0,
        )

        def fake_spawn(n):
            print(json.dumps({"ok": True, "name": n.name}))
            return 0

        with (
            mock.patch.object(atlas_mux, "cmd_spawn", fake_spawn),
            mock.patch.object(atlas_mux, "_exited", return_value=True),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(0, atlas_mux.cmd_spawn_team(ns))
        kick = self._board("kickoff")
        self.assertEqual(1, len(kick), kick)
        self.assertEqual("lead-tkick1", kick[0]["owner"])
        self.assertEqual("all", kick[0]["to"])
        for needle in ("audit the parser", "src/a.py", "explorer"):
            self.assertIn(needle, kick[0]["text"])
        self.assertNotIn("second line", kick[0]["text"])

    def test_reap_posts_one_wrapup_note_with_exit_codes_and_note_counts(self):
        lead, names = "lead-aaaaaa", ["explorer-aaaa", "explorer-bbbb"]
        chan = atlas_todo.open_lead_channel(self.root, lead, names)["name"]
        rec = atlas_mux.build_team("audit", "medium", None, "r", team_id="twrap1")
        rec.update(
            created=0.0,
            transport="tmux",
            channel=chan,
            lead=lead,
            members=[{"name": n, "role": "explorer"} for n in names],
        )
        d = pathlib.Path(self.root) / atlas_mux.TEAMS_REL
        d.mkdir(parents=True)
        (d / "twrap1.json").write_text(json.dumps(rec))
        atlas_todo.note(self.root, names[0], "peer sync", to=names[1], channel=chan)
        atlas_todo.note(
            self.root,
            names[0],
            "STATUS: DONE\nexit 0",
            to=lead,
            channel=chan,
            kind="report",
        )
        atlas_todo.note(
            self.root,
            names[1],
            "STATUS: FAILED\nexit 3",
            to=lead,
            channel=chan,
            kind="report",
        )
        for n, code in zip(names, (0, 3)):
            atlas_todo.mark_finished(self.root, n, code)
        ns = argparse.Namespace(root=self.root, team="twrap1", timeout=1, poll=0.1)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(0, atlas_mux.cmd_reap(ns))
            self.assertEqual(0, atlas_mux.cmd_reap(ns))  # idempotent: no second wrap-up
        wrap = self._board("wrapup")
        self.assertEqual(1, len(wrap), wrap)
        self.assertEqual(lead, wrap[0]["owner"])
        text = wrap[0]["text"]
        self.assertIn("explorer-aaaa exit 0", text)
        self.assertIn("explorer-bbbb exit 3", text)
        self.assertIn("2 notes", text)  # explorer-aaaa posted a peer note and a report

    def test_run_worker_posts_a_start_note_to_the_lead_without_the_model(self):
        pf = pathlib.Path(self.root) / "p.prompt"
        pf.write_text("task", encoding="utf-8")
        ns = argparse.Namespace(
            root=self.root,
            prompt_file=str(pf),
            command_override="true",
            name="w-1",
            agent="explorer",
            run="r1",
            harness="claude",
            model=None,
            effort=None,
            thinking=None,
            agents_dir=None,
            permission_mode="acceptEdits",
            omp_extension=None,
            cwd=None,
        )
        with (
            mock.patch.dict(os.environ, {"ATLAS_LEAD_NAME": "lead-zzzzzz"}),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            atlas_mux.cmd_run_worker(ns)
        start = self._board("start")
        self.assertEqual(1, len(start), start)
        self.assertEqual(("w-1", "lead-zzzzzz"), (start[0]["owner"], start[0]["to"]))
        self.assertIn("explorer", start[0]["text"])


if __name__ == "__main__":
    unittest.main()
