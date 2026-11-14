#!/usr/bin/env python3
"""In-process atlas_mux tests: claude CLI wrappers (subprocess mocked), report/classify helpers,
claude-bg spawn, run-worker with a shell override, team recovery and channel release.

No tmux server, claude binary or network is touched; signal handlers are never installed."""

import argparse
import contextlib
import io
import json
import os
import pathlib
import signal
import subprocess
import tempfile
import unittest
from unittest import mock

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_mux as mux  # noqa: E402


def cp(rc=0, out="", err=""):
    return subprocess.CompletedProcess(["claude"], rc, out, err)


class TmpCase(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.addCleanup(self._t.cleanup)
        self.root = os.path.realpath(self._t.name)
        # atlas "installed": a claude worker argv carries no --plugin-dir (a bare host would add one, D4)
        cfg = os.path.join(self.root, "claude-config", "plugins")
        os.makedirs(cfg)
        with open(os.path.join(cfg, "installed_plugins.json"), "w") as fh:
            fh.write('{"version":2,"plugins":{"atlas@tech-tools":[{}]}}')
        p = mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": os.path.dirname(cfg)})
        p.start()
        self.addCleanup(p.stop)


class ClaudeWrapper(unittest.TestCase):
    def test_runs_claude_with_bounded_wait_and_clean_env(self):
        with mock.patch.object(mux.subprocess, "run", return_value=cp(0, "o")) as run, \
                mock.patch.object(mux, "clean_env", return_value={"E": "1"}):
            res = mux._claude("agents", "--json", cwd="/w")
        self.assertEqual(res.stdout, "o")
        args, kw = run.call_args
        self.assertEqual(args[0], ["claude", "agents", "--json"])
        self.assertEqual(kw, {"capture_output": True, "text": True, "env": {"E": "1"}, "cwd": "/w", "timeout": 30})

    def test_explicit_env_is_used_as_is(self):
        with mock.patch.object(mux.subprocess, "run", return_value=cp()) as run:
            mux._claude("x", env={})
        self.assertEqual(run.call_args.kwargs["env"], {})

    def test_missing_binary_is_127(self):
        with mock.patch.object(mux.subprocess, "run", side_effect=FileNotFoundError):
            res = mux._claude("agents", "--json")
        self.assertEqual((res.returncode, res.stdout, res.stderr, res.args),
                         (127, "", "claude not found on PATH", ["claude", "agents", "--json"]))

    def test_timeout_is_124(self):
        with mock.patch.object(mux.subprocess, "run", side_effect=subprocess.TimeoutExpired("claude", 30)):
            res = mux._claude("stop", "x")
        self.assertEqual((res.returncode, res.stdout, res.stderr, res.args),
                         (124, "", "claude timed out after 30s", ["claude", "stop", "x"]))


class ClaudeWorkers(TmpCase):
    def workers(self, rows, rc=0):
        with mock.patch.object(mux, "_claude", return_value=cp(rc, json.dumps(rows))) as c:
            out = mux._claude_workers(self.root)
        c.assert_called_once_with("agents", "--json")
        return out

    def test_nonzero_exit_and_garbage_are_none(self):
        self.assertIsNone(self.workers([], rc=1))
        with mock.patch.object(mux, "_claude", return_value=cp(0, "not json")):
            self.assertIsNone(mux._claude_workers(self.root))
        with mock.patch.object(mux, "_claude", return_value=cp(0, '{"a": 1}')):
            self.assertIsNone(mux._claude_workers(self.root))

    def test_filters_to_this_projects_background_agents(self):
        rows = [
            {"kind": "background", "cwd": self.root, "name": "w1", "state": "Running", "id": "abc"},
            {"kind": "background", "cwd": self.root, "name": "w2", "status": "DONE", "pid": 7},
            {"kind": "background", "cwd": self.root, "name": "w3", "state": "failed"},
            {"kind": "background", "cwd": "/elsewhere", "name": "other", "state": "running"},
            {"kind": "interactive", "cwd": self.root, "name": "chat", "state": "running"},
            {"kind": "background", "cwd": self.root, "name": "lead"},
            {"kind": "background", "cwd": self.root, "name": "Sidebar"},
            {"kind": "background", "name": "nocwd"},
            "junk",
        ]
        self.assertEqual(self.workers(rows), [
            {"name": "w1", "dead": 0, "pid": "abc", "state": "running"},
            {"name": "w2", "dead": 1, "pid": 7, "state": "done"},
            {"name": "w3", "dead": 1, "pid": "", "state": "failed"},
        ])

    def test_all_terminal_states_are_dead(self):
        rows = [{"kind": "background", "cwd": self.root, "name": s, "state": s} for s in ("done", "failed", "stopped", "error", "idle")]
        self.assertEqual([w["dead"] for w in self.workers(rows)], [1, 1, 1, 1, 0])

    def test_cwd_matched_by_realpath(self):
        link = os.path.join(self.root, "link")
        os.symlink(self.root, link)
        with mock.patch.object(mux, "_claude", return_value=cp(0, json.dumps(
                [{"kind": "background", "cwd": link, "name": "w", "state": "running"}]))):
            self.assertEqual(len(mux._claude_workers(self.root)), 1)

    def test_state_prefers_state_over_status_and_empty_default(self):
        rows = [{"kind": "background", "cwd": self.root, "name": "a", "state": "running", "status": "done"},
                {"kind": "background", "cwd": self.root, "name": "b"}]
        out = self.workers(rows)
        self.assertEqual([(w["state"], w["dead"]) for w in out], [("running", 0), ("", 0)])


class StopAndLogs(unittest.TestCase):
    def test_stop_only_live_workers_and_reports_stopped(self):
        ws = [{"name": "a", "dead": 0, "pid": "p1"}, {"name": "b", "dead": 1, "pid": "p2"},
              {"name": "c", "dead": 0, "pid": 33}, {"name": "d", "dead": 0, "pid": "p4"}]
        with mock.patch.object(mux, "_claude_workers", return_value=ws), \
                mock.patch.object(mux, "_claude", side_effect=[cp(0), cp(0), cp(1)]) as c:
            self.assertEqual(mux._stop_claude_bg("/r"), ["a", "c"])
        self.assertEqual([x.args for x in c.call_args_list], [("stop", "p1"), ("stop", "33"), ("stop", "p4")])

    def test_stop_when_claude_missing(self):
        with mock.patch.object(mux, "_claude_workers", return_value=None), mock.patch.object(mux, "_claude") as c:
            self.assertEqual(mux._stop_claude_bg("/r"), [])
        c.assert_not_called()

    def test_log_tail_failure_is_empty(self):
        with mock.patch.object(mux, "_claude", return_value=cp(1, "x")):
            self.assertEqual(mux._bg_log_tail("p"), "")

    def test_log_tail_drops_blank_and_noise(self):
        out = "one\n\n   \nWarning: MCP server foo its tools are unavailable\nExtension error x\ntwo\n"
        with mock.patch.object(mux, "_claude", return_value=cp(0, out)) as c:
            self.assertEqual(mux._bg_log_tail(12), "one\ntwo")
        c.assert_called_once_with("logs", "12")


class ReportAndClassify(unittest.TestCase):
    def test_report_from_status_line(self):
        self.assertEqual(mux._report(["chatter", "STATUS: DONE", "STEPS: 1/1"]), "STATUS: DONE\nSTEPS: 1/1")
        self.assertEqual(mux._report(["STATUS: A", "x", "STATUS: B"]), "STATUS: A\nx\nSTATUS: B")

    def test_report_without_status_is_last_20_non_noise(self):
        lines = [f"l{i}" for i in range(30)]
        lines.insert(25, "Extension error boom")
        out = mux._report(lines).splitlines()
        self.assertEqual(len(out), 20)
        self.assertEqual(out[-1], "l29")
        self.assertEqual(out[0], "l10")
        self.assertNotIn("Extension error boom", out)

    def test_report_empty(self):
        self.assertEqual(mux._report([]), "")
        self.assertEqual(mux._report(["Extension error x"]), "")

    def test_classify_signs_beat_zero_exit(self):
        c = mux._classify
        self.assertEqual(c("model gpt-x not found", 0), (1, "model not found"))
        self.assertEqual(c("HTTP 402 returned", 0), (1, "http 402"))
        self.assertEqual(c("code 4020", 0), (0, None))
        self.assertEqual(c("insufficient credit left", 0), (1, "credits exhausted"))
        self.assertEqual(c("Payment Required", 0), (1, "credits exhausted"))
        self.assertEqual(c("Unauthorized", 0), (1, "auth rejected"))
        self.assertEqual(c("error 401", 0), (1, "auth rejected"))
        self.assertEqual(c("port 14010", 0), (0, None))
        self.assertEqual(c("invalid api key", 0), (1, "auth rejected"))

    def test_classify_nonzero_and_clean(self):
        self.assertEqual(mux._classify("fine", 0), (0, None))
        self.assertEqual(mux._classify("fine", 7), (7, "nonzero exit"))
        self.assertEqual(mux._classify("", -9), (-9, "nonzero exit"))

    def test_classify_first_sign_wins(self):
        self.assertEqual(mux._classify("model x not found; 401", 3), (1, "model not found"))


class PaneEnvAndRoot(unittest.TestCase):
    def test_pane_env_pins_and_forwards_set_vars_only(self):
        fwd = mux.FORWARDED_ENV[:2]
        with mock.patch.dict(os.environ, {fwd[0]: "v0", fwd[1]: ""}):
            env = mux.pane_env("/r", "w1")
        self.assertEqual(env["ATLAS_PROJECT_ROOT"], "/r")
        self.assertEqual(env["ATLAS_WORKER_NAME"], "w1")
        self.assertEqual(env[fwd[0]], "v0")
        self.assertNotIn(fwd[1], env)

    def test_omp_config_path_env_then_home(self):
        with mock.patch.dict(os.environ, {"ATLAS_MUX_OMP_CONFIG": "/x/c.yml"}):
            self.assertEqual(mux._omp_config_path(), pathlib.Path("/x/c.yml"))
        env = {k: v for k, v in os.environ.items() if k != "ATLAS_MUX_OMP_CONFIG"}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(pathlib.Path, "home", return_value=pathlib.Path("/h")):
            self.assertEqual(mux._omp_config_path(), pathlib.Path("/h/.omp/agent/config.yml"))

    def test_root_resolution_order(self):
        a = argparse.Namespace(root="rel/dir")
        self.assertEqual(mux._root(a), os.path.abspath("rel/dir"))
        with mock.patch.dict(os.environ, {"ATLAS_PROJECT_ROOT": "/env/root"}):
            self.assertEqual(mux._root(argparse.Namespace(root=None)), "/env/root")
            self.assertEqual(mux._root(argparse.Namespace(root="")), "/env/root")
        env = {k: v for k, v in os.environ.items() if k != "ATLAS_PROJECT_ROOT"}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(mux._root(argparse.Namespace(root=None)), os.getcwd())


class SpawnClaudeBg(TmpCase):
    def args(self, **kw):
        prompt = os.path.join(self.root, "p.txt")
        pathlib.Path(prompt).write_text("do the thing")
        base = dict(prompt_file=prompt, name="W1", agent="explorer", harness="claude", cwd=None,
                    tools_profile=None, permission_mode=None)
        base.update(kw)
        return argparse.Namespace(**base)

    def run_bg(self, args, res, model=None, level=None, env=None):
        todo = mux.atlas_todo
        out = io.StringIO()
        with mock.patch.object(mux, "_claude", return_value=res) as c, \
                mock.patch.object(todo, "issue_owner_token", return_value="TOK"), \
                mock.patch.object(todo, "get_channel", return_value={"lead": "boss"}), \
                mock.patch.object(todo, "set_member_handles") as handles, \
                mock.patch.object(todo, "leave") as leave, \
                mock.patch.dict(os.environ, env or {}), contextlib.redirect_stdout(out):
            if not (env and "ATLAS_LEAD_NAME" in env):
                os.environ.pop("ATLAS_LEAD_NAME", None)   # an inherited or leaked lead name would beat the channel lead
            rc = mux._spawn_claude_bg(args, self.root, "main", model, level, "sess1")
        return rc, (json.loads(out.getvalue()) if out.getvalue() else {}), c, handles, leave

    def test_success_emits_agent_id_and_registers_handle(self):
        rc, out, c, handles, leave = self.run_bg(self.args(), cp(0, "backgrounded · ag-7 · W1\n"), model="opus", level="high")
        self.assertEqual(rc, 0)
        self.assertEqual(out, {"ok": True, "session": "sess1", "name": "W1", "harness": "claude", "agent": "explorer",
                               "model": "opus", "level": "high", "agent_id": "ag-7", "transport": "claude-bg",
                               "board": str(pathlib.Path(self.root) / mux.BOARD_REL / "W1.jsonl")})
        handles.assert_called_once_with(self.root, "W1", "main", pane_id="ag-7")
        leave.assert_not_called()

    def test_argv_and_env_contract(self):
        rc, out, c, handles, leave = self.run_bg(self.args(permission_mode="acceptEdits"), cp(0, "backgrounded · x · W1"),
                                                  model="opus", level="high")
        argv, kw = list(c.call_args.args), c.call_args.kwargs
        self.assertEqual(argv[:6], ["--bg", "--name", "W1", "--agent", "atlas:explorer", "--settings"])
        settings = json.loads(argv[6])
        self.assertEqual(settings["crossSessionInbound"], "accept")
        self.assertIn("Bash(python3 *atlas_todo.py*)", settings["permissions"]["allow"])
        self.assertEqual(argv[7:11], ["--model", "opus", "--effort", "high"])
        self.assertEqual(argv[11:13], ["--permission-mode", "acceptEdits"])
        self.assertIn("do the thing", argv[13])
        self.assertIn("boss", argv[13])
        self.assertEqual(kw["cwd"], self.root)
        self.assertEqual((kw["env"]["ATLAS_OWNER_TOKEN"], kw["env"]["ATLAS_PROJECT_ROOT"], kw["env"]["ATLAS_WORKER_NAME"]),
                         ("TOK", self.root, "W1"))
        self.assertNotIn("TOK", " ".join(argv))   # the token never reaches argv

    def test_defaults_dont_ask_and_skip_unset_model_effort(self):
        rc, out, c, *_ = self.run_bg(self.args(), cp(0, "backgrounded · x · W1"))
        argv = list(c.call_args.args)
        self.assertNotIn("--model", argv)
        self.assertNotIn("--effort", argv)
        self.assertEqual(argv[argv.index("--permission-mode") + 1], "dontAsk")

    def test_explicit_cwd_is_absolutised(self):
        rc, out, c, *_ = self.run_bg(self.args(cwd="sub"), cp(0, "backgrounded · x · W1"))
        self.assertEqual(c.call_args.kwargs["cwd"], os.path.abspath("sub"))

    def test_lead_name_env_wins_over_channel_lead(self):
        rc, out, c, *_ = self.run_bg(self.args(), cp(0, "backgrounded · x · W1"), env={"ATLAS_LEAD_NAME": "  envlead "})
        self.assertIn("envlead", list(c.call_args.args)[-1])

    def test_failure_paths_leave_channel_and_report_error(self):
        for res, expect in ((cp(2, "", "boom\n"), "boom"), (cp(2, "out text\n", ""), "out text"), (cp(3, "", ""), "claude --bg failed (3)"),
                            (cp(0, "no id line", ""), "no id line")):
            rc, out, c, handles, leave = self.run_bg(self.args(), res)
            self.assertEqual((rc, out["ok"], out["error"]), (1, False, expect))
            leave.assert_called_once_with(self.root, "main", "W1")
            handles.assert_not_called()

    def test_zero_exit_without_id_and_empty_output(self):
        rc, out, *_ = self.run_bg(self.args(), cp(0, "", ""))
        self.assertEqual(out["error"], "claude --bg failed (0)")


class LogWave(TmpCase):
    def setUp(self):
        super().setUp()
        import atlas_db
        patcher = mock.patch.dict(os.environ, {"ATLAS_DB": os.path.join(self.root, "x.db")})
        patcher.start()
        self.addCleanup(patcher.stop)
        conn = atlas_db.connect()
        try:
            atlas_db.init(conn)
            conn.commit()
        finally:
            conn.close()

    def rec(self):
        return {"team_id": "t1", "members": [{"name": "a", "role": "implementer"}, {"name": "b", "role": "implementer"},
                                             {"name": "c", "role": "verifier"}]}

    def rows(self):
        import atlas_db
        conn = atlas_db.connect()
        try:
            atlas_db.init(conn)
            return conn.execute("SELECT run_id, agent_type, model, wave_id FROM dispatches ORDER BY id").fetchall()
        finally:
            conn.close()

    def test_no_run_id_is_false_and_writes_nothing(self):
        self.assertIs(mux._log_wave(self.rec(), None), False)
        self.assertEqual(self.rows(), [])

    def test_logs_one_row_per_member_with_models(self):
        import atlas_db
        run = "run-logwave-1"
        self.assertIs(mux._log_wave(self.rec(), run, [{"name": "a", "model": "opus"}, {"name": "c", "model": "sonnet"}]), True)
        rows = [r for r in self.rows() if r[0] == run]
        self.assertEqual([(r[1], r[3]) for r in rows], [("atlas:implementer", "t1"), ("atlas:implementer", "t1"), ("atlas:verifier", "t1")])
        self.assertEqual([r[2] for r in rows], [atlas_db.normalize_model("opus"), None, atlas_db.normalize_model("sonnet")])

    def test_idempotent_per_role_slot(self):
        run = "run-logwave-2"
        mux._log_wave(self.rec(), run)
        mux._log_wave(self.rec(), run)
        self.assertEqual(len([r for r in self.rows() if r[0] == run]), 3)
        bigger = self.rec()
        bigger["members"].append({"name": "d", "role": "implementer"})
        mux._log_wave(bigger, run)
        self.assertEqual(len([r for r in self.rows() if r[0] == run and r[1] == "atlas:implementer"]), 3)

    def test_failure_is_swallowed_as_false(self):
        import atlas_db
        with mock.patch.object(atlas_db, "connect", side_effect=RuntimeError("db down")):
            self.assertIs(mux._log_wave(self.rec(), "r"), False)
        with mock.patch.object(atlas_db, "log_dispatch", side_effect=RuntimeError("x")):
            self.assertIs(mux._log_wave(self.rec(), "r-fail"), False)


class ReleaseTeamChannel(unittest.TestCase):
    def release(self, chan, rec=None):
        todo = mux.atlas_todo
        with mock.patch.object(todo, "get_channel", return_value=chan) as g, mock.patch.object(todo, "leave") as leave:
            mux._release_team_channel("/r", rec or {"channel": "main/team", "lead": "boss"})
        return g, leave

    def test_lead_leaves_once_all_others_exited(self):
        chan = {"members": [{"name": "boss"}, {"name": "a", "exit_code": 0}, {"name": "b", "exit_code": 1}]}
        g, leave = self.release(chan)
        g.assert_called_once_with("/r", "main/team")
        leave.assert_called_once_with("/r", "main/team", "boss")

    def test_running_member_keeps_lead_in(self):
        _, leave = self.release({"members": [{"name": "boss"}, {"name": "a", "exit_code": 0}, {"name": "b"}]})
        leave.assert_not_called()

    def test_no_other_members_keeps_lead(self):
        _, leave = self.release({"members": [{"name": "boss"}]})
        leave.assert_not_called()

    def test_missing_channel_or_fields(self):
        _, leave = self.release(None)
        leave.assert_not_called()
        g, leave = self.release({"members": []}, {"channel": None, "lead": "boss"})
        g.assert_not_called()
        g, leave = self.release({"members": []}, {"channel": "c", "lead": ""})
        g.assert_not_called()
        leave.assert_not_called()


class RecoverTeam(TmpCase):
    def recover(self, windows, panes, team="tm"):
        with mock.patch.object(mux, "_windows", return_value=windows) as w, \
                mock.patch.object(mux, "_team_panes", return_value=panes) as p:
            out = mux._recover_team(self.root, team)
        w.assert_called_once_with("atlas-" + team)
        p.assert_called_once_with("atlas-" + team)
        return out

    def test_none_when_no_trace(self):
        self.assertIsNone(self.recover(None, []))
        self.assertIsNone(self.recover([], []))

    def test_names_from_prompts_windows_and_panes(self):
        d = mux._team_dir(self.root)
        d.mkdir(parents=True)
        (d / "tm-implementer.prompt").write_text("x")
        (d / "tm-verifier-2.prompt").write_text("x")
        (d / "other-explorer.prompt").write_text("x")
        out = self.recover([{"name": "lead"}, {"name": "atlas-tm"}, {"name": "w-win"}, {"name": "implementer"}], [{"name": "pane-w"}])
        self.assertEqual(out, {"team_id": "tm", "transport": "tmux", "members": [
            {"name": "implementer"}, {"name": "pane-w"}, {"name": "verifier-2"}, {"name": "w-win"}]})

    def test_only_lead_window_still_counts_as_trace(self):
        out = self.recover([{"name": "lead"}], [])
        self.assertEqual(out, {"team_id": "tm", "transport": "tmux", "members": []})


class RunWorkerInProcess(TmpCase):
    def run_worker(self, override, name="W9", extra_env=None, feed_side=None, **kw):
        prompt = os.path.join(self.root, "p.txt")
        pathlib.Path(prompt).write_text("STATUS-less prompt")
        args = argparse.Namespace(root=self.root, prompt_file=prompt, command_override=override, name=name, agent="explorer",
                                  run="r1", cwd=None, harness="claude", agents_dir=None, model=None, effort=None, thinking=None,
                                  permission_mode=None, omp_extension=None, tools_profile=None)
        for k, v in kw.items():
            setattr(args, k, v)
        env = {k: v for k, v in os.environ.items() if k not in ("ATLAS_CHANNEL", "ATLAS_LEAD_NAME", "ATLAS_MUX_WORKER_CMD")}
        env.update(extra_env or {})
        out = io.StringIO()
        installed = {}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(mux.signal, "signal", lambda s, h: installed.update({s: h})), \
                contextlib.redirect_stdout(out):
            if feed_side:
                with mock.patch.object(mux, "_feed_line", side_effect=feed_side):
                    rc = mux.cmd_run_worker(args)
            else:
                rc = mux.cmd_run_worker(args)
        return rc, out.getvalue(), installed

    def notes(self, name="W9"):
        return [r for r in mux.atlas_todo.notes(self.root, to="lead") if r.get("owner") == name]

    def test_success_posts_start_and_one_report_note(self):
        rc, out, _ = self.run_worker("printf 'alpha\\nbeta\\n'")
        self.assertEqual(rc, 0)
        recs = self.notes()
        self.assertEqual([r["kind"] for r in recs], ["start", "report"])
        self.assertEqual(recs[0]["text"], "start: explorer worker W9 running")
        self.assertEqual(recs[1]["text"], "alpha\nbeta\nexit 0")
        log = (pathlib.Path(self.root) / ".atlas" / ".run" / "logs" / "W9.log").read_text()
        self.assertTrue(log.startswith("$ /bin/sh -c "))
        self.assertIn("alpha\nbeta\n", log)

    def test_nonzero_exit_and_failure_sign_recorded(self):
        rc, _, _ = self.run_worker("echo oops; exit 5")
        self.assertEqual(rc, 5)
        self.assertEqual(self.notes()[-1]["text"], "oops\nexit 5 [failed: nonzero exit]")
        rc, _, _ = self.run_worker("echo 'HTTP 402'; exit 0", name="W8")
        self.assertEqual(rc, 1)
        self.assertEqual(self.notes("W8")[-1]["text"], "HTTP 402\nexit 1 [failed: http 402]")

    def test_status_block_is_not_classified(self):
        rc, _, _ = self.run_worker("echo harness-ok; echo 'STATUS: DONE'; echo 'saw foo.py:402'")
        self.assertEqual(rc, 0)
        self.assertEqual(self.notes()[-1]["text"], "STATUS: DONE\nsaw foo.py:402\nexit 0")

    def test_env_override_command_and_pins(self):
        rc, _, _ = self.run_worker(None, extra_env={"ATLAS_MUX_WORKER_CMD": "echo $ATLAS_WORKER_NAME:$ATLAS_PROJECT_ROOT"})
        self.assertEqual(rc, 0)
        self.assertEqual(self.notes()[-1]["text"], f"W9:{self.root}\nexit 0")

    def test_report_goes_to_env_lead(self):
        rc, _, _ = self.run_worker("echo hi", extra_env={"ATLAS_LEAD_NAME": "boss"})
        rows = [r for r in mux.atlas_todo.notes(self.root, to="boss") if r.get("owner") == "W9" and r.get("kind") == "report"]
        self.assertEqual([r["text"] for r in rows], ["hi\nexit 0"])

    def test_spawn_failure_is_127(self):
        with mock.patch.object(mux.subprocess, "Popen", side_effect=OSError("no sh")):
            rc, _, _ = self.run_worker("echo hi")
        self.assertEqual(rc, 127)
        self.assertEqual(self.notes()[-1]["text"], "spawn failed: no sh\nexit 127 [failed: spawn error]")

    def test_signal_handlers_installed_and_raise_system_exit(self):
        rc, _, installed = self.run_worker("true")
        self.assertEqual(set(installed), {signal.SIGTERM, signal.SIGHUP})
        with self.assertRaises(SystemExit) as cm:
            installed[signal.SIGTERM](signal.SIGTERM, None)
        self.assertEqual(cm.exception.code, 128 + signal.SIGTERM)

    def test_interrupt_terminates_worker_and_records_signal(self):
        rc, _, _ = self.run_worker("echo x; sleep 30", feed_side=SystemExit(143))
        self.assertEqual(rc, 143)
        self.assertEqual(self.notes()[-1]["text"], "exit 143 [failed: killed by signal 15]")

    def test_keyboard_interrupt_defaults_to_130(self):
        rc, _, _ = self.run_worker("echo x; sleep 30", feed_side=KeyboardInterrupt())
        self.assertEqual(rc, 130)
        self.assertEqual(self.notes()[-1]["text"], "exit 130 [failed: killed by signal 2]")

    def test_non_int_exit_code_defaults_to_130(self):
        rc, _, _ = self.run_worker("echo x; sleep 30", feed_side=SystemExit("bye"))
        self.assertEqual(rc, 130)

    def test_tier_error_returns_2_without_running(self):
        with mock.patch.object(mux, "_tier", return_value=(None, None, "", "bad tier")), mock.patch.object(mux.subprocess, "Popen") as popen:
            rc, out, _ = self.run_worker(None)
        self.assertEqual(rc, 2)
        self.assertEqual(json.loads(out), {"ok": False, "error": "bad tier"})
        popen.assert_not_called()

    def test_cwd_is_used_for_the_worker(self):
        sub = os.path.join(self.root, "sub")
        os.makedirs(sub)
        rc, _, _ = self.run_worker("pwd", cwd=sub)
        self.assertEqual(self.notes()[-1]["text"], f"{os.path.realpath(sub)}\nexit 0")


class ExitedIgnoresPreviousRun(unittest.TestCase):
    def test_old_exit_note_does_not_count_after_respawn(self):
        with tempfile.TemporaryDirectory() as root:
            mux.atlas_todo.note(root, "implementer-bde8", "exit 1 [failed]", to="all")
            spawned = mux.atlas_todo.notes(root)[-1]["ts"] + 1
            self.assertTrue(mux._exited(root, "implementer-bde8"))  # no launch time: last note wins
            self.assertFalse(mux._exited(root, "implementer-bde8", spawned))
            with mock.patch.object(mux.time, "time", return_value=spawned + 1):
                mux.atlas_todo.note(root, "implementer-bde8", "exit 0", to="all")
            self.assertTrue(mux._exited(root, "implementer-bde8", spawned))



class KillNotesSinceTests(TmpCase):
    def test_exit_note_of_an_earlier_run_does_not_suppress_the_kill_note(self):
        import time as _t

        import atlas_todo

        root = str(self.root)
        atlas_todo.note(root, "w1", "exit 0 [ok: previous run]", to="lead", kind="report")
        _t.sleep(0.02)
        since = _t.time()
        with mock.patch.object(mux.time, "sleep"):
            mux._kill_notes(root, ["w1"], since)
        texts = [r["text"] for r in atlas_todo.notes(root, since=since) if r.get("owner") == "w1"]
        self.assertEqual(["exit 137 [failed: killed by atlas_mux kill]"], texts)


if __name__ == "__main__":
    unittest.main()
